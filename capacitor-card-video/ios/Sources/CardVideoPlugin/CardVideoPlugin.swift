import Foundation
import Capacitor
import AVFoundation
import UIKit

// CardVideo — composes a still image (the pre-rendered 9:16 story frame) + an audio clip
// (the reflection) into an mp4, so the share card can post to Instagram Stories as a video.
// JS composes the frame; this plugin just does image + audio -> mp4 and returns a file URI.
//
// compose({ image: <base64 PNG>, audio: <base64>, audioExt: "m4a"|"mp4"|"wav"|"mp3" }) -> { uri }
@objc(CardVideoPlugin)
public class CardVideoPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CardVideoPlugin"
    public let jsName = "CardVideo"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "compose", returnType: CAPPluginReturnPromise)
    ]

    @objc func compose(_ call: CAPPluginCall) {
        guard let imageB64 = call.getString("image"),
              let imgData = Data(base64Encoded: imageB64),
              let image = UIImage(data: imgData) else {
            call.reject("valid base64 image required"); return
        }
        guard let audioB64 = call.getString("audio"),
              let audioData = Data(base64Encoded: audioB64) else {
            call.reject("valid base64 audio required"); return
        }
        let audioExt = call.getString("audioExt") ?? "m4a"

        let tmp = FileManager.default.temporaryDirectory
        let stamp = Int(Date().timeIntervalSince1970 * 1000)
        let audioURL = tmp.appendingPathComponent("cardvideo-\(stamp).\(audioExt)")
        let stillURL = tmp.appendingPathComponent("cardvideo-still-\(stamp).mp4")
        let outURL = tmp.appendingPathComponent("pangolinrc-card-\(stamp).mp4")
        try? FileManager.default.removeItem(at: outURL)
        try? FileManager.default.removeItem(at: stillURL)

        do { try audioData.write(to: audioURL) }
        catch { call.reject("could not write audio"); return }

        let audioAsset = AVURLAsset(url: audioURL)
        let duration = audioAsset.duration
        if !duration.isNumeric || duration.seconds.isNaN || duration.seconds <= 0 {
            call.reject("audio has no readable duration (unsupported format?)"); return
        }

        // The canvas PNG has scale 1, so size is the pixel size (expected 1080x1920).
        var vidSize = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        if vidSize.width < 2 || vidSize.height < 2 { vidSize = CGSize(width: 1080, height: 1920) }
        // H.264 needs even dimensions.
        vidSize.width = (vidSize.width.rounded()).truncatingRemainder(dividingBy: 2) == 0 ? vidSize.width.rounded() : vidSize.width.rounded() - 1
        vidSize.height = (vidSize.height.rounded()).truncatingRemainder(dividingBy: 2) == 0 ? vidSize.height.rounded() : vidSize.height.rounded() - 1

        writeStillVideo(image: image, duration: duration, size: vidSize, to: stillURL) { [weak self] ok in
            guard let self = self else { return }
            if !ok { call.reject("could not render the still video"); return }
            self.merge(videoURL: stillURL, audioAsset: audioAsset, to: outURL) { success in
                if success {
                    call.resolve(["uri": outURL.absoluteString])
                } else {
                    call.reject("mp4 export failed")
                }
            }
        }
    }

    // Write the still image as a video of `duration` (one frame held start→end).
    private func writeStillVideo(image: UIImage, duration: CMTime, size: CGSize, to url: URL, completion: @escaping (Bool) -> Void) {
        try? FileManager.default.removeItem(at: url)
        guard let writer = try? AVAssetWriter(outputURL: url, fileType: .mp4) else { completion(false); return }
        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: size.width,
            AVVideoHeightKey: size.height
        ]
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.expectsMediaDataInRealTime = false
        let attrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32ARGB),
            kCVPixelBufferWidthKey as String: Int(size.width),
            kCVPixelBufferHeightKey as String: Int(size.height)
        ]
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: attrs)
        guard writer.canAdd(input) else { completion(false); return }
        writer.add(input)
        guard writer.startWriting() else { completion(false); return }
        writer.startSession(atSourceTime: .zero)

        guard let buffer = pixelBuffer(from: image, size: size) else {
            writer.cancelWriting(); completion(false); return
        }
        let queue = DispatchQueue(label: "com.pangolinrc.cardvideo")
        var appended = false
        input.requestMediaDataWhenReady(on: queue) {
            // Run exactly once, when the input can take data. Two identical frames (start + end)
            // plus an explicit endSession make the still hold for the whole audio length — a lone
            // sample at .zero collapses the track to ~0 length, which reads back as a blank video.
            guard !appended, input.isReadyForMoreMediaData else { return }
            appended = true
            adaptor.append(buffer, withPresentationTime: .zero)
            if input.isReadyForMoreMediaData { adaptor.append(buffer, withPresentationTime: duration) }
            input.markAsFinished()
            writer.endSession(atSourceTime: duration)
            writer.finishWriting { completion(writer.status == .completed) }
        }
    }

    private func pixelBuffer(from image: UIImage, size: CGSize) -> CVPixelBuffer? {
        let attrs: [String: Any] = [
            kCVPixelBufferCGImageCompatibilityKey as String: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
        ]
        var pb: CVPixelBuffer?
        let status = CVPixelBufferCreate(kCFAllocatorDefault, Int(size.width), Int(size.height),
                                         kCVPixelFormatType_32ARGB, attrs as CFDictionary, &pb)
        guard status == kCVReturnSuccess, let buffer = pb else { return nil }
        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
        guard let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buffer),
                                  width: Int(size.width), height: Int(size.height),
                                  bitsPerComponent: 8,
                                  bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue) else { return nil }
        ctx.clear(CGRect(origin: .zero, size: size))
        if let cg = image.cgImage {
            // No flip. Verified across two builds: a vertical flip → upside-down, a horizontal
            // flip → mirrored — each showed ONLY the transform applied, so this pipeline adds no
            // orientation of its own. Drawing straight lands the card correct. (The real fix for
            // the earlier blank video was endSession in writeStillVideo, not any flip here.)
            ctx.draw(cg, in: CGRect(origin: .zero, size: size))
        }
        return buffer
    }

    // Mux the still video track + the audio track into the final mp4.
    private func merge(videoURL: URL, audioAsset: AVAsset, to outURL: URL, completion: @escaping (Bool) -> Void) {
        let comp = AVMutableComposition()
        let videoAsset = AVURLAsset(url: videoURL)
        if let vTrack = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
           let srcV = videoAsset.tracks(withMediaType: .video).first {
            try? vTrack.insertTimeRange(CMTimeRange(start: .zero, duration: videoAsset.duration), of: srcV, at: .zero)
        }
        if let aTrack = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid),
           let srcA = audioAsset.tracks(withMediaType: .audio).first {
            let dur = CMTimeMinimum(audioAsset.duration, videoAsset.duration)
            try? aTrack.insertTimeRange(CMTimeRange(start: .zero, duration: dur), of: srcA, at: .zero)
        }
        guard let export = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetHighestQuality) else {
            completion(false); return
        }
        export.outputURL = outURL
        export.outputFileType = .mp4
        export.exportAsynchronously {
            completion(export.status == .completed)
        }
    }
}
