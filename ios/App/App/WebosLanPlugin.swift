import Foundation
import Capacitor
import UIKit
import UserNotifications

/**
 * WebosLan — a thin native WebSocket transport for driving an LG webOS TV directly
 * over the LAN (SSAP on wss://<tv-ip>:3001). The WKWebView can't do this itself:
 * it blocks the TV's self-signed certificate and (on the plaintext port) mixed
 * content. This plugin opens the socket natively and accepts the TV's self-signed
 * cert for that LAN link; ALL protocol logic (register/pairing/pointer socket/
 * commands) stays in JS (see public/webos-client.js), so it's a dumb pipe.
 *
 * JS API (via registerPlugin('WebosLan')):
 *   connect({ id, url })  -> resolves once the socket is open
 *   send({ id, data })    -> send one text frame
 *   close({ id })
 * Events (addListener):
 *   'webosMessage' { id, data }   'webosClosed' { id }   'webosError' { id, error }
 *
 * NOTE: not compiled in this environment — build in Xcode. Requires iOS 13+
 * (URLSessionWebSocketTask) which is already the project floor.
 */
@objc(WebosLanPlugin)
public class WebosLanPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionWebSocketDelegate {
    public let identifier = "WebosLanPlugin"
    public let jsName = "WebosLan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise)
    ]

    private var tasks: [String: URLSessionWebSocketTask] = [:]
    private var connectCalls: [String: CAPPluginCall] = [:]
    private let queue = DispatchQueue(label: "webos.lan.plugin")

    // One session whose delegate (this plugin) trusts the TV's self-signed LAN cert.
    private lazy var session: URLSession =
        URLSession(configuration: .default, delegate: self, delegateQueue: nil)

    @objc func connect(_ call: CAPPluginCall) {
        guard let id = call.getString("id"),
              let urlStr = call.getString("url"),
              let url = URL(string: urlStr) else {
            call.reject("connect requires id and url")
            return
        }
        call.keepAlive = true   // resolved later, on didOpen (or rejected on failure)
        queue.sync {
            let task = session.webSocketTask(with: url)
            task.taskDescription = id
            self.tasks[id] = task
            self.connectCalls[id] = call
            self.receive(id: id, task: task)
            task.resume()
        }
    }

    @objc func send(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let data = call.getString("data") else {
            call.reject("send requires id and data")
            return
        }
        guard let task = tasks[id] else { call.reject("no open socket for id \(id)"); return }
        task.send(.string(data)) { [weak self] err in
            if let err = err {
                self?.notifyListeners("webosError", data: ["id": id, "error": err.localizedDescription])
                call.reject(err.localizedDescription)
            } else {
                call.resolve()
            }
        }
    }

    @objc func close(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("close requires id"); return }
        queue.sync {
            self.tasks[id]?.cancel(with: .goingAway, reason: nil)
            self.tasks[id] = nil
            self.connectCalls[id] = nil
        }
        call.resolve()
    }

    private func receive(id: String, task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .failure(let err):
                self.notifyListeners("webosClosed", data: ["id": id, "reason": err.localizedDescription])
                self.queue.sync { self.tasks[id] = nil }
            case .success(let message):
                switch message {
                case .string(let text):
                    self.notifyListeners("webosMessage", data: ["id": id, "data": text])
                case .data(let d):
                    self.notifyListeners("webosMessage", data: ["id": id, "data": String(decoding: d, as: UTF8.self)])
                @unknown default:
                    break
                }
                self.receive(id: id, task: task)   // keep the receive loop alive
            }
        }
    }

    // MARK: - URLSessionWebSocketDelegate

    public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                           didOpenWithProtocol proto: String?) {
        guard let id = webSocketTask.taskDescription else { return }
        connectCalls[id]?.resolve()
        connectCalls[id] = nil
    }

    public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                           didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        guard let id = webSocketTask.taskDescription else { return }
        notifyListeners("webosClosed", data: ["id": id])
        queue.sync { tasks[id] = nil }
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let id = task.taskDescription else { return }
        if let error = error, let call = connectCalls[id] {
            call.reject(error.localizedDescription)   // connect failed before opening
            connectCalls[id] = nil
        }
    }

    // Accept the TV's self-signed certificate for this LAN link (scoped to this
    // plugin's session only — the app's normal HTTPS is unaffected).
    public func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                           completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
           let trust = challenge.protectionSpace.serverTrust {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.performDefaultHandling, nil)
        }
    }
}

/**
 * AppAuth — hands the web layer a shared secret so the native app can clear the
 * Pierre chat's bot gate. Turnstile (the web bot check on POST /pierre/chat)
 * cannot run inside this WKWebview, so the app sends this token as `appToken`
 * instead; the Worker matches it against its APP_NATIVE_SECRET.
 *
 * This secret lives ONLY here in the compiled app binary — never in the web
 * bundle (public/ → www/), which is served publicly and would leak it. Rotate
 * by changing BOTH this constant and the Worker's APP_NATIVE_SECRET together.
 *
 * Lives in this file (already in the app target) so no project.pbxproj change is
 * needed; Capacitor auto-discovers it and exposes it as Capacitor.Plugins.AppAuth.
 *
 * JS: const { value } = await Capacitor.Plugins.AppAuth.token()
 *
 * NOTE: not compiled in this environment — build in Xcode.
 */
@objc(AppAuthPlugin)
public class AppAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppAuthPlugin"
    public let jsName = "AppAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "token", returnType: CAPPluginReturnPromise)
    ]

    // Must equal the Worker's APP_NATIVE_SECRET (set via `wrangler secret put`).
    private static let appToken = "ed53bbc5823a4e8e7604c5a64b3a2db268b3f2feeec6c9cb9c730b425d989714"

    @objc func token(_ call: CAPPluginCall) {
        call.resolve(["value": AppAuthPlugin.appToken])
    }
}

/**
 * AppBadge — sets the app-icon badge number natively. The WKWebView can't set the
 * iOS home-screen icon badge, so the shell calls this for an admin account to mirror
 * the admin panel's waitlist "new" count onto the app icon.
 *
 * JS: await Capacitor.registerPlugin('AppBadge').set({ count: n })
 *
 * Best-effort: displaying a badge requires the badge notification authorization the
 * app already requests via LocalNotifications; if it wasn't granted this silently
 * no-ops. count is clamped at 0 (0 clears the badge).
 */
@objc(AppBadgePlugin)
public class AppBadgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppBadgePlugin"
    public let jsName = "AppBadge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise)
    ]

    @objc func set(_ call: CAPPluginCall) {
        let count = max(0, call.getInt("count") ?? 0)
        DispatchQueue.main.async {
            if #available(iOS 16.0, *) {
                UNUserNotificationCenter.current().setBadgeCount(count)
            } else {
                UIApplication.shared.applicationIconBadgeNumber = count
            }
        }
        call.resolve()
    }
}
