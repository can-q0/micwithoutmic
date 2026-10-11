import Foundation
import Combine
import CoreMotion
import AVFoundation
import CryptoKit
import UIKit

struct AudioRoute: Codable {
    let capturedAtSeconds: Double
    let ports: [String]
    let outputVolume: Float
    let sampleRate: Double
    let outputLatency: Double
    let ioBufferDuration: Double
}

struct NativeSession: Codable {
    let schemaVersion = 4
    let kind = "native-sensor-session"
    let startedAt: String
    let durationSeconds: Double
    let complete: Bool
    let stopReason: String
    let placement: String
    let distanceCM: Double
    let requestedRateHz: Double
    let sensorAvailable: [String: Bool]
    let device: String
    let systemVersion: String
    let stimulusName: String
    let stimulusSHA256: String
    let stimulusDurationSeconds: Double
    let referenceTranscript: String
    let role: RunRole?
    let comparisonOrder: ComparisonOrder?
    let comparisonEvents: [ComparisonEvent]?
    let microphoneRequested = false
    let cameraRequested = false
    let toneSegments: [ToneSegment]?
    let playbackStartSeconds: Double
    let scheduledAudioDeviceTime: Double
    let routes: [AudioRoute]
    let errors: [String]
    let reports: [SensorReport]
    let samples: [String: [SensorSample]]
    let notes = [
        "Camera and microphone are never requested or accessed. Audio is playback only; no sensor data is uploaded.",
        "Accelerometer includes gravity in g; gyro is rad/s.",
        "Each sensor has its own timestamped stream. Streams are not assumed simultaneous.",
        "Sensor and callback times are seconds since capture start, using the boot clock.",
        "Requested rate is a probe, not a guaranteed hardware rate. Inspect measuredRateHz.",
        "Playback timing is scheduled, not measured acoustic arrival at an external speaker.",
        "RMS is centered within each window; DC shifts are exported separately.",
        "Tone frequencies can alias at the measured motion sampling rate; a motion peak does not identify the original acoustic frequency.",
        "No speech recognition or reconstructed audio is produced. Reference text is supplied by the user."
    ]
}

// The capture queue writes here; the main thread reads snapshots at 4 Hz.
// A run token prevents delayed callbacks from leaking into a later recording.
private final class CaptureStore {
    private let lock = NSLock()
    private var token: UUID?
    private var startTime: Double = 0
    private var rows: [String: [SensorSample]] = [:]
    private var errors: [String] = []

    func begin(_ token: UUID, at time: Double) {
        lock.lock(); defer { lock.unlock() }
        self.token = token; startTime = time
        rows = ["accelerometer": [], "gyroscope": []]; errors = []
    }

    func add(_ name: String, token: UUID, timestamp: Double, x: Double, y: Double, z: Double) {
        let arrival = ProcessInfo.processInfo.systemUptime
        lock.lock(); defer { lock.unlock() }
        guard self.token == token, timestamp >= startTime,
              [timestamp, arrival, x, y, z].allSatisfy({ $0.isFinite }) else { return }
        guard (rows[name]?.count ?? 0) < 100_000 else {
            let message = "\(name): sample limit reached"
            if !errors.contains(message) { errors.append(message) }
            return
        }
        rows[name, default: []].append(SensorSample(sensorTime: timestamp - startTime,
            arrivalTime: arrival - startTime, x: x, y: y, z: z))
    }

    func error(_ message: String, token: UUID) {
        lock.lock(); defer { lock.unlock() }
        if self.token == token && !errors.contains(message) { errors.append(message) }
    }

    func snapshot(ending: Bool = false) -> (rows: [String: [SensorSample]], errors: [String]) {
        lock.lock(); defer { lock.unlock() }
        if ending { token = nil }
        return (rows, errors)
    }
}

@MainActor
final class NativeRecorder: ObservableObject {
    @Published private(set) var recording = false
    @Published private(set) var elapsed: Double = 0
    @Published private(set) var message = "Run Sound on / Order A, Sound on / Order B, then Muted control / Order A."
    @Published private(set) var routeDescription = "Output route appears when playback starts."
    @Published private(set) var liveCounts: [String: Int] = [:]
    @Published private(set) var reports: [SensorReport] = []
    @Published private(set) var exportURL: URL?
    @Published private(set) var stimulusName = "Two-sound comparison · Order A · 48 seconds"
    @Published private(set) var stimulusDuration = ComparisonAudio.duration
    @Published private(set) var comparisonOrder: ComparisonOrder = .a
    @Published private(set) var isComparison = true
    @Published private(set) var latestRunLabel = ""
    @Published private(set) var previewing = false
    @Published private(set) var latestComplete = false

    var placement = "phone-speaker"
    var distanceCM = 5.0
    var requestedRateHz = 200.0
    var referenceTranscript = ""
    var role: RunRole = .sound
    private let motion = CMMotionManager()
    private let queue: OperationQueue = {
        let queue = OperationQueue(); queue.name = "TableSignal.capture"
        queue.maxConcurrentOperationCount = 1; queue.qualityOfService = .userInitiated
        return queue
    }()
    private let store = CaptureStore()
    private var timer: Timer?
    private var player: AVAudioPlayer?
    private var audioBytes: Data?
    private var toneSegments: [ToneSegment]? = ComparisonAudio.events(order: .a).map(\.tone)
    private var comparisonEvents: [ComparisonEvent]? = ComparisonAudio.events(order: .a)
    private var startTime = 0.0
    private var startedAt = ""
    private var playbackStart = 10.0
    private var scheduledAudioTime = 0.0
    private var routes: [AudioRoute] = []
    private var observers: [NSObjectProtocol] = []

    var available: [String: Bool] {
        ["accelerometer": motion.isAccelerometerAvailable,
         "gyroscope": motion.isGyroAvailable]
    }
    var finishTime: Double { playbackStart + stimulusDuration + 10 }
    var phase: String {
        if !recording { return latestComplete ? "Run saved" : "Ready" }
        if elapsed < 5 { return "Hands off · settling" }
        if elapsed < playbackStart { return "Quiet baseline" }
        if elapsed < playbackStart + stimulusDuration {
            if let segments = toneSegments {
                let t = elapsed - playbackStart
                if let segment = segments.first(where: { t >= $0.startSeconds && t < $0.startSeconds + $0.durationSeconds }) {
                    return role == .muted ? "Muted control · scheduled \(Int(segment.frequencyHz)) Hz" : "Playing \(Int(segment.frequencyHz)) Hz"
                }
                return "Pause between tones"
            }
            return "Speech clip playing"
        }
        return "Final quiet baseline"
    }

    init() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            let began = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue
            if began { Task { @MainActor in self?.interrupt("Audio interrupted") } }
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                let oldPorts = self.routes.last?.ports
                self.updateRoute()
                if self.recording, let oldPorts, oldPorts != self.routes.last?.ports {
                    self.stop("Audio output route changed")
                }
            }
        })
        restoreLatest()
    }

    func useTones() {
        guard !recording else { return }
        stopPreview(); audioBytes = nil; toneSegments = CalibrationAudio.segments
        comparisonEvents = nil; isComparison = false
        stimulusName = "Calibration tones · 28 seconds"; stimulusDuration = CalibrationAudio.duration
        message = "Seven tones with silent pauses. Speaker response may be weak at the lowest frequencies."
    }

    func useComparison(_ order: ComparisonOrder) {
        guard !recording else { return }
        stopPreview(); comparisonOrder = order; isComparison = true
        comparisonEvents = ComparisonAudio.events(order: order)
        toneSegments = comparisonEvents?.map(\.tone); audioBytes = nil
        stimulusName = "Two-sound comparison · \(order.title) · 48 seconds"
        stimulusDuration = ComparisonAudio.duration
        message = "Sound A = 160 Hz; Sound B = 320 Hz. Six repetitions of each, separated by silence. This tests distinguishable motion, not words."
    }

    private func sourceBytes() -> Data {
        audioBytes ?? (isComparison ? ComparisonAudio.wav(order: comparisonOrder) : CalibrationAudio.wav())
    }

    func loadClip(_ url: URL) {
        guard !recording else { return }
        stopPreview()
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard size > 0 && size <= 20_000_000 else { throw CaptureError.invalidClip }
            let bytes = try Data(contentsOf: url)
            guard bytes.count <= 20_000_000 else { throw CaptureError.invalidClip }
            let probe = try AVAudioPlayer(data: bytes)
            guard probe.duration >= 3 && probe.duration <= 90 else { throw CaptureError.invalidClip }
            audioBytes = bytes; toneSegments = nil; stimulusName = url.lastPathComponent
            comparisonEvents = nil; isComparison = false
            stimulusDuration = probe.duration; message = "Clip loaded locally. Playback and capture happen in this app."
        } catch { message = "Could not load clip: use a supported 3–90 second audio file, up to 20 MB." }
    }

    func preview() {
        guard !recording else { return }
        do {
            stopPreview(); try configureAudio()
            let p = try AVAudioPlayer(data: sourceBytes())
            // Start at the 80 Hz passage for a more audible calibration preview.
            if toneSegments != nil && !isComparison { p.currentTime = 16 }
            p.prepareToPlay(); player = p; previewing = p.play(); updateRoute()
            if !previewing { throw CaptureError.playbackFailed }
            message = "Check the named output route and speaker volume, then stop preview."
        } catch { message = "Output check failed: \(error.localizedDescription)"; stopPreview() }
    }

    func stopPreview() {
        guard !recording else { return }
        player?.stop(); player = nil; previewing = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    func start() {
        guard !recording else { return }
        stopPreview()
        guard motion.isAccelerometerAvailable else { message = "An accelerometer is required. Use your physical iPhone, not the simulator."; return }
        guard [50.0, 100.0, 200.0].contains(requestedRateHz), distanceCM.isFinite, distanceCM >= 0 else {
            message = "Choose a valid rate and distance."; return
        }
        do {
            try configureAudio()
            let bytes = sourceBytes()
            let p = try AVAudioPlayer(data: bytes); p.volume = role.playbackVolume; p.prepareToPlay()
            player = p; startTime = ProcessInfo.processInfo.systemUptime
            startedAt = ISO8601DateFormatter().string(from: Date())
            playbackStart = ProcessInfo.processInfo.systemUptime - startTime + 10
            scheduledAudioTime = p.deviceCurrentTime + 10
            guard p.play(atTime: scheduledAudioTime) else { throw CaptureError.playbackFailed }
            let token = UUID(); store.begin(token, at: startTime)
            elapsed = 0; liveCounts = [:]; reports = []; exportURL = nil; latestComplete = false
            routes = []; recording = true; updateRoute()
            UIApplication.shared.isIdleTimerDisabled = true
            let interval = 1 / requestedRateHz
            motion.accelerometerUpdateInterval = interval; motion.gyroUpdateInterval = interval
            let capture = store
            if motion.isAccelerometerAvailable {
                motion.startAccelerometerUpdates(to: queue) { data, error in
                    if let error { capture.error("accelerometer: \(error.localizedDescription)", token: token) }
                    if let data { capture.add("accelerometer", token: token, timestamp: data.timestamp,
                        x: data.acceleration.x, y: data.acceleration.y, z: data.acceleration.z) }
                }
            }
            if motion.isGyroAvailable {
                motion.startGyroUpdates(to: queue) { data, error in
                    if let error { capture.error("gyroscope: \(error.localizedDescription)", token: token) }
                    if let data { capture.add("gyroscope", token: token, timestamp: data.timestamp,
                        x: data.rotationRate.x, y: data.rotationRate.y, z: data.rotationRate.z) }
                }
            }
            message = "Keep this app open and the phone still. Do not switch to voicemail."
            timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.tick() }
            }
        } catch {
            message = "Could not start: \(error.localizedDescription)"
            if recording { stop("Capture start failed") } else { stopPreview() }
        }
    }

    private func tick() {
        guard recording else { return }
        elapsed = ProcessInfo.processInfo.systemUptime - startTime
        let snapshot = store.snapshot(); liveCounts = snapshot.rows.mapValues(\.count)
        if let initial = routes.first?.outputVolume, abs(AVAudioSession.sharedInstance().outputVolume - initial) > 0.005 {
            stop("System output volume changed; keep it fixed for the comparison"); return
        }
        if elapsed >= finishTime { stop("Sequence complete"); return }
        if elapsed > 8 && elapsed - (snapshot.rows["accelerometer"]?.last?.sensorTime ?? 0) > 3 {
            stop("Accelerometer delivery stopped; check Motion & Fitness access and keep the app open"); return
        }
        if snapshot.errors.contains(where: { $0.contains("sample limit") }) { stop("Sample limit reached"); return }
        if elapsed > playbackStart + 1 && elapsed < playbackStart + stimulusDuration - 0.5,
           player?.isPlaying != true { stop("Scheduled playback did not continue"); return }
    }

    func stop(_ reason: String = "Stopped by you") {
        guard recording else { return }
        let duration = ProcessInfo.processInfo.systemUptime - startTime
        timer?.invalidate(); timer = nil
        let snapshot = store.snapshot(ending: true)
        motion.stopAccelerometerUpdates(); motion.stopGyroUpdates()
        recording = false; elapsed = duration; player?.stop(); player = nil
        UIApplication.shared.isIdleTimerDisabled = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        let end = playbackStart + stimulusDuration
        reports = ["accelerometer", "gyroscope"].map { name in
            SignalAnalysis.report(sensor: name, unit: name == "accelerometer" ? "g" : "rad/s",
                samples: snapshot.rows[name] ?? [], playbackStart: playbackStart, playbackEnd: end)
        }
        latestComplete = reason == "Sequence complete" && duration >= finishTime - 0.5
            && snapshot.errors.isEmpty && reports.contains { $0.sensor == "accelerometer" && !$0.axes.isEmpty
                && $0.finalQuietCount >= 20 && $0.gapCount == 0 && $0.nonIncreasingTimestamps == 0 }
        let savedReason = reason == "Sequence complete" && !latestComplete
            ? "Sequence ended with incomplete or gapped accelerometer data; inspect sensor reports and errors" : reason
        let bytes = sourceBytes()
        latestRunLabel = "\(role.title) · \(isComparison ? comparisonOrder.title : stimulusName) · \(Int(requestedRateHz)) Hz requested"
        let session = NativeSession(startedAt: startedAt, durationSeconds: duration,
            complete: latestComplete, stopReason: savedReason, placement: placement, distanceCM: distanceCM,
            requestedRateHz: requestedRateHz, sensorAvailable: available,
            device: UIDevice.current.model, systemVersion: UIDevice.current.systemVersion,
            stimulusName: stimulusName, stimulusSHA256: SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined(),
            stimulusDurationSeconds: stimulusDuration, referenceTranscript: String(referenceTranscript.prefix(3000)),
            role: role, comparisonOrder: isComparison ? comparisonOrder : nil, comparisonEvents: comparisonEvents,
            toneSegments: toneSegments, playbackStartSeconds: playbackStart,
            scheduledAudioDeviceTime: scheduledAudioTime, routes: routes, errors: snapshot.errors,
            reports: reports, samples: snapshot.rows)
        do {
            let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
            let name = "native-signal-\(startedAt.replacingOccurrences(of: ":", with: "-"))-\(role.rawValue)-\(isComparison ? comparisonOrder.rawValue : "clip")-\(UUID().uuidString.prefix(6)).json"
            let url = try recordingsDirectory().appendingPathComponent(name)
            try encoder.encode(session).write(to: url, options: .atomic); exportURL = url
            message = latestComplete ? "Saved locally. Compare each sensor's actual rate and activity; no words have been decoded."
                : "Partial run saved: \(savedReason). \(snapshot.errors.joined(separator: "; "))"
        } catch { message = "Export failed: \(error.localizedDescription). Keep this screen open; measurements remain visible." }
    }

    func interrupt(_ reason: String) {
        if recording { stop(reason) } else { stopPreview() }
    }

    func shareAll() -> URL? {
        guard !recording else { return nil }
        do {
            let folder = try recordingsDirectory()
            let files = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
                .filter { $0.lastPathComponent.hasPrefix("native-signal-") && $0.pathExtension == "json" }
            let runs = try files.sorted { $0.lastPathComponent < $1.lastPathComponent }.map {
                try JSONSerialization.jsonObject(with: Data(contentsOf: $0))
            }
            guard !runs.isEmpty else { return nil }
            let bundle: [String: Any] = ["kind": "native-sensor-bundle", "schemaVersion": 1, "runs": runs]
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("micwithoutmic-native-runs.json")
            try JSONSerialization.data(withJSONObject: bundle, options: [.sortedKeys]).write(to: url, options: .atomic)
            return url
        } catch { message = "Bundle export failed: \(error.localizedDescription)"; return nil }
    }

    private func configureAudio() throws {
        // Playback-only category: never playAndRecord, microphone permission, or audio input taps.
        let audio = AVAudioSession.sharedInstance()
        try audio.setCategory(.playback, mode: .default, options: [])
        try audio.setActive(true)
    }

    private func updateRoute() {
        let audio = AVAudioSession.sharedInstance()
        let ports = audio.currentRoute.outputs.map { "\($0.portType.rawValue): \($0.portName)" }
        routeDescription = ports.isEmpty ? "No output route reported" : ports.joined(separator: ", ")
        if recording {
            routes.append(AudioRoute(capturedAtSeconds: ProcessInfo.processInfo.systemUptime - startTime,
                ports: ports, outputVolume: audio.outputVolume, sampleRate: audio.sampleRate,
                outputLatency: audio.outputLatency, ioBufferDuration: audio.ioBufferDuration))
        }
    }

    private func recordingsDirectory() throws -> URL {
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("SensorRuns", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func restoreLatest() {
        do {
            let files = try FileManager.default.contentsOfDirectory(at: recordingsDirectory(), includingPropertiesForKeys: nil)
                .filter { $0.lastPathComponent.hasPrefix("native-signal-") && $0.pathExtension == "json" }
            if let url = files.sorted(by: { $0.lastPathComponent > $1.lastPathComponent }).first {
                let session = try JSONDecoder().decode(NativeSession.self, from: Data(contentsOf: url))
                reports = session.reports; exportURL = url; latestComplete = session.complete
                latestRunLabel = "\(session.role?.title ?? "Earlier run") · \(session.comparisonOrder?.title ?? session.stimulusName)"
                message = session.complete ? "Last run restored. Raw recordings are in Files → On My iPhone → Table Signal."
                    : "Last partial run restored: \(session.stopReason)"
            }
        } catch { message = "Could not restore previous run: \(error.localizedDescription)" }
    }
}

private enum CaptureError: LocalizedError {
    case invalidClip, playbackFailed
    var errorDescription: String? {
        switch self {
        case .invalidClip: return "Unsupported clip size or duration"
        case .playbackFailed: return "Audio playback could not start"
        }
    }
}
