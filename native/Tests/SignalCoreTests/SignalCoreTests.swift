import XCTest
@testable import SignalCore

final class SignalCoreTests: XCTestCase {
    func rows(rate: Int = 100, signal: (Double) -> Double) -> [SensorSample] {
        (0..<(rate * 40)).map { index in
            let t = Double(index) / Double(rate), v = signal(t)
            return SensorSample(sensorTime: t, arrivalTime: t + 0.03, x: v, y: 0, z: -1)
        }
    }

    func testBaselineShiftDoesNotBecomeVibration() {
        let samples = rows { t in 0.001 * sin(2 * .pi * 10 * t) + (t >= 10 ? 0.1 : 0) }
        let r = SignalAnalysis.report(sensor: "accelerometer", unit: "g", samples: samples, playbackStart: 10, playbackEnd: 30)
        XCTAssertEqual(r.measuredRateHz!, 100, accuracy: 1e-8)
        XCTAssertEqual(r.axes[0].playbackToQuietDB!, 0, accuracy: 1e-8)
        XCTAssertEqual(r.axes[0].playbackMeanShift, 0.1, accuracy: 1e-8)
        XCTAssertEqual(r.axes[0].finalMeanShift!, 0.1, accuracy: 1e-8)
    }

    func testActualACChangeIsMeasured() {
        let samples = rows { t in (t >= 10 && t < 30 ? 0.002 : 0.001) * sin(2 * .pi * 10 * t) }
        let r = SignalAnalysis.report(sensor: "gyro", unit: "rad/s", samples: samples, playbackStart: 10, playbackEnd: 30)
        XCTAssertEqual(r.axes[0].playbackToQuietDB!, 6.020599913, accuracy: 1e-6)
        XCTAssertEqual(r.gapCount, 0)
        XCTAssertEqual(r.quietCount, 500)
        XCTAssertEqual(r.playbackCount, 2000)
    }

    func testMissingStreamAndZeroFloorProduceNoInventedRatio() {
        let empty = SignalAnalysis.report(sensor: "magnetometer", unit: "µT", samples: [], playbackStart: 10, playbackEnd: 30)
        XCTAssertNil(empty.measuredRateHz); XCTAssertTrue(empty.axes.isEmpty)
        let zero = SignalAnalysis.report(sensor: "accelerometer", unit: "g", samples: rows { _ in 1 }, playbackStart: 10, playbackEnd: 30)
        XCTAssertNil(zero.axes[0].playbackToQuietDB)
        XCTAssertEqual(zero.axes[0].quietRMS, 0)
        XCTAssertNoThrow(try JSONEncoder().encode(zero))
    }

    func testGapsAndDuplicateSamplesAreVisible() {
        var samples = rows { _ in 0 }.filter { $0.sensorTime < 15 || $0.sensorTime >= 16 }
        samples.insert(samples[100], at: 101)
        let r = SignalAnalysis.report(sensor: "gyro", unit: "rad/s", samples: samples, playbackStart: 10, playbackEnd: 30)
        XCTAssertEqual(r.gapCount, 1)
        XCTAssertEqual(r.nonIncreasingTimestamps, 1)
        XCTAssertNil(r.measuredRateHz)
    }

    func testInterruptedCaptureCannotSupplyFinalQuiet() {
        let samples = Array(rows { t in sin(t) }.prefix(1200))
        let r = SignalAnalysis.report(sensor: "accelerometer", unit: "g", samples: samples, playbackStart: 10, playbackEnd: 30)
        XCTAssertEqual(r.finalQuietCount, 0)
        XCTAssertNil(r.axes[0].finalQuietRMS)
    }

    func testWavHeaderAndSilentGaps() {
        let rate = 1000, data = CalibrationAudio.wav(sampleRate: rate)
        XCTAssertEqual(String(data: data.prefix(4), encoding: .ascii), "RIFF")
        XCTAssertEqual(String(data: data[8..<12], encoding: .ascii), "WAVE")
        XCTAssertEqual(data.count, 44 + 28 * rate * 2)
        XCTAssertTrue(data[(44 + 2200 * 2)..<(44 + 3800 * 2)].allSatisfy { $0 == 0 })
        XCTAssertTrue(data[(44 + 200 * 2)..<(44 + 1800 * 2)].contains { $0 != 0 })
        XCTAssertEqual(CalibrationAudio.segments.count, 7)
    }

    func testComparisonOrdersHaveBalancedLabelsAndDifferentSequences() throws {
        let a = ComparisonAudio.events(order: .a), b = ComparisonAudio.events(order: .b)
        XCTAssertNotEqual(a.map(\.label), b.map(\.label))
        for events in [a, b] {
            XCTAssertEqual(events.count, 12)
            XCTAssertEqual(events.filter { $0.label == "A" }.count, 6)
            XCTAssertEqual(events.filter { $0.label == "B" }.count, 6)
            XCTAssertEqual(events.map { $0.tone.startSeconds }, (0..<12).map { Double($0) * 4 })
            XCTAssertTrue(events.allSatisfy { $0.tone.durationSeconds == 2 })
            XCTAssertTrue(events.allSatisfy { $0.tone.frequencyHz == ($0.label == "A" ? 160 : 320) })
            XCTAssertNoThrow(try JSONEncoder().encode(events))
        }
    }

    func testComparisonAudioCarriesKnownFrequenciesAndExactSilentPauses() {
        let rate = 4000
        func pcm(_ data: Data, _ index: Int) -> Double {
            let i = 44 + index * 2
            return Double(Int16(bitPattern: UInt16(data[i]) | UInt16(data[i + 1]) << 8))
        }
        let a = ComparisonAudio.wav(order: .a, sampleRate: rate)
        let b = ComparisonAudio.wav(order: .b, sampleRate: rate)
        XCTAssertEqual(a.count, 44 + 48 * rate * 2)
        XCTAssertNotEqual(a, b)
        for event in ComparisonAudio.events(order: .a) {
            let start = Int(event.tone.startSeconds * Double(rate))
            let quietStart = 44 + (start + 2 * rate) * 2
            let quietEnd = 44 + (start + 4 * rate) * 2
            XCTAssertTrue(a[quietStart..<quietEnd].allSatisfy { $0 == 0 })
            let first = Int(0.1 * Double(rate)), count = Int(0.5 * Double(rate))
            let measured = (first..<(first + count)).reduce(0.0) { result, i in
                result + pcm(a, start + i) * sin(2 * .pi * event.tone.frequencyHz * Double(i) / Double(rate))
            } / Double(count)
            XCTAssertGreaterThan(measured, 3200) // A 0.2-amplitude tone, projected onto its known carrier.
        }
    }

    func testMutedControlChangesOnlyOutputGain() throws {
        XCTAssertEqual(RunRole.sound.playbackVolume, 1)
        XCTAssertEqual(RunRole.muted.playbackVolume, 0)
        XCTAssertEqual(try JSONDecoder().decode(RunRole.self, from: JSONEncoder().encode(RunRole.muted)), .muted)
    }

    func testNativeTargetIsMotionOnlyWithPlaybackOnlyAudio() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let info = try Data(contentsOf: root.appendingPathComponent("App/Info.plist"))
        let plist = try XCTUnwrap(PropertyListSerialization.propertyList(from: info, format: nil) as? [String: Any])
        XCTAssertEqual(plist.keys.filter { $0.hasSuffix("UsageDescription") }.sorted(), ["NSMotionUsageDescription"])
        let appFolder = root.appendingPathComponent("App")
        let files = try FileManager.default.contentsOfDirectory(at: appFolder, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "swift" }
        let source = try files.map { try String(contentsOf: $0, encoding: .utf8) }.joined(separator: "\n")
        for forbidden in ["AVCapture", "AVAudioRecorder", "requestRecordPermission", "requestAccess(for:", "installTap(", "inputNode", "SFSpeechRecognizer", "URLSession", "WKWebView"] {
            XCTAssertFalse(source.contains(forbidden), "Forbidden capture/network API: \(forbidden)")
        }
        XCTAssertTrue(source.contains("setCategory(.playback"))
        XCTAssertFalse(source.contains("setCategory(.playAndRecord"))
        XCTAssertFalse(source.contains("setCategory(.record"))
        XCTAssertFalse(source.contains("startMagnetometerUpdates"))
    }
}
