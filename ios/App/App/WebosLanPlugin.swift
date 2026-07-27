import Foundation
import Capacitor

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
