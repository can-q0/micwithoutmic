import Foundation

struct SensorSample: Codable {
    let sensorTime: Double
    let arrivalTime: Double
    let x: Double
    let y: Double
    let z: Double
}

struct AxisReport: Codable {
    let axis: String
    let quietRMS: Double
    let playbackRMS: Double
    let finalQuietRMS: Double?
    let playbackToQuietDB: Double?
    let playbackMeanShift: Double
    let finalMeanShift: Double?
}

struct SensorReport: Codable {
    let sensor: String
    let unit: String
    let sampleCount: Int
    let measuredRateHz: Double?
    let maxIntervalSeconds: Double?
    let nonIncreasingTimestamps: Int
    let gapCount: Int
    let quietCount: Int
    let playbackCount: Int
    let finalQuietCount: Int
    let axes: [AxisReport]
}

enum SignalAnalysis {
    static func mean(_ values: [Double]) -> Double {
        values.isEmpty ? 0 : values.reduce(0, +) / Double(values.count)
    }

    // Remove each window's DC offset. Export shifts separately so tilt or drift
    // cannot masquerade as extra AC vibration, as it did in the browser test.
    static func centeredRMS(_ values: [Double]) -> Double {
        let center = mean(values)
        let result = sqrt(mean(values.map { ($0 - center) * ($0 - center) }))
        return result < 1e-12 ? 0 : result
    }

    static func report(sensor: String, unit: String, samples: [SensorSample],
                       playbackStart: Double, playbackEnd: Double) -> SensorReport {
        let quiet = samples.filter { $0.sensorTime >= 5 && $0.sensorTime < playbackStart }
        let playback = samples.filter { $0.sensorTime >= playbackStart && $0.sensorTime < playbackEnd }
        let tail = samples.filter { $0.sensorTime >= playbackEnd + 2 && $0.sensorTime < playbackEnd + 10 }
        let intervals = zip(samples, samples.dropFirst()).map { $1.sensorTime - $0.sensorTime }
        let positive = intervals.filter { $0 > 0 }.sorted()
        let median = positive.isEmpty ? nil : positive[positive.count / 2]
        let gapLimit = max(0.15, (median ?? 0) * 4)
        // Average timestamp intervals avoid the browser's 16/17 ms rounding bias.
        let rate = !intervals.isEmpty && intervals.allSatisfy({ $0 > 0 })
            ? Double(intervals.count) / intervals.reduce(0, +) : nil
        let axes: [AxisReport] = ["x", "y", "z"].compactMap { axis in
            func values(_ rows: [SensorSample]) -> [Double] {
                rows.map { axis == "x" ? $0.x : axis == "y" ? $0.y : $0.z }
            }
            guard quiet.count >= 20 && playback.count >= 20 else { return nil }
            let a = values(quiet), b = values(playback), c = values(tail)
            let qr = centeredRMS(a), pr = centeredRMS(b)
            return AxisReport(axis: axis, quietRMS: qr, playbackRMS: pr,
                finalQuietRMS: c.count >= 20 ? centeredRMS(c) : nil,
                playbackToQuietDB: qr > 0 && pr > 0 ? 20 * log10(pr / qr) : nil,
                playbackMeanShift: mean(b) - mean(a),
                finalMeanShift: c.count >= 20 ? mean(c) - mean(a) : nil)
        }
        return SensorReport(sensor: sensor, unit: unit, sampleCount: samples.count,
            measuredRateHz: rate, maxIntervalSeconds: intervals.max(),
            nonIncreasingTimestamps: intervals.filter { $0 <= 0 }.count,
            gapCount: positive.filter { $0 > gapLimit }.count,
            quietCount: quiet.count, playbackCount: playback.count,
            finalQuietCount: tail.count, axes: axes)
    }
}

struct ToneSegment: Codable {
    let frequencyHz: Double
    let startSeconds: Double
    let durationSeconds: Double
}

enum RunRole: String, CaseIterable, Codable {
    case sound, muted
    var title: String { self == .sound ? "Sound on" : "Muted control" }
    var playbackVolume: Float { self == .sound ? 1 : 0 }
}

enum ComparisonOrder: String, CaseIterable, Codable {
    case a, b
    var title: String { self == .a ? "Order A" : "Order B" }
}

struct ComparisonEvent: Codable {
    let label: String
    let tone: ToneSegment
}

enum ComparisonAudio {
    static let duration: Double = 48
    static func events(order: ComparisonOrder) -> [ComparisonEvent] {
        let labels = order == .a
            ? ["A", "B", "B", "A", "B", "A", "A", "B", "A", "B", "B", "A"]
            : ["B", "A", "B", "A", "A", "B", "B", "A", "B", "A", "A", "B"]
        return labels.enumerated().map { index, label in
            ComparisonEvent(label: label, tone: ToneSegment(frequencyHz: label == "A" ? 160 : 320,
                startSeconds: Double(index) * 4, durationSeconds: 2))
        }
    }
    static func wav(order: ComparisonOrder, sampleRate: Int = 44100) -> Data {
        ToneAudio.wav(segments: events(order: order).map(\.tone), duration: duration, sampleRate: sampleRate)
    }
}

enum CalibrationAudio {
    static let frequencies: [Double] = [20, 30, 40, 60, 80, 120, 160]
    static var segments: [ToneSegment] {
        frequencies.enumerated().map { ToneSegment(frequencyHz: $0.element,
            startSeconds: Double($0.offset) * 4, durationSeconds: 2) }
    }
    static let duration: Double = 28

    static func wav(sampleRate: Int = 44100) -> Data {
        ToneAudio.wav(segments: segments, duration: duration, sampleRate: sampleRate)
    }
}

enum ToneAudio {
    static func wav(segments: [ToneSegment], duration: Double, sampleRate: Int) -> Data {
        precondition(sampleRate > 0 && duration > 0)
        let count = sampleRate * Int(duration), byteCount = count * 2
        var data = Data()
        func ascii(_ text: String) { data.append(contentsOf: text.utf8) }
        func u16(_ value: UInt16) {
            data.append(UInt8(value & 255)); data.append(UInt8(value >> 8))
        }
        func u32(_ value: UInt32) {
            for shift in stride(from: 0, to: 32, by: 8) { data.append(UInt8((value >> shift) & 255)) }
        }
        ascii("RIFF"); u32(UInt32(36 + byteCount)); ascii("WAVEfmt ")
        u32(16); u16(1); u16(1); u32(UInt32(sampleRate)); u32(UInt32(sampleRate * 2))
        u16(2); u16(16); ascii("data"); u32(UInt32(byteCount))
        var index = 0
        for i in 0..<count {
            let time = Double(i) / Double(sampleRate)
            while index < segments.count && time >= segments[index].startSeconds + segments[index].durationSeconds { index += 1 }
            var sample = 0.0
            if index < segments.count {
                let segment = segments[index], local = time - segment.startSeconds
                if local >= 0 {
                    let ramp = max(0, min(1, min(local / 0.025, (segment.durationSeconds - local) / 0.025)))
                    sample = 0.2 * ramp * sin(2 * .pi * segment.frequencyHz * local)
                }
            }
            u16(UInt16(bitPattern: Int16(sample * Double(Int16.max))))
        }
        return data
    }
}
