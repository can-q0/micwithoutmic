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
}
