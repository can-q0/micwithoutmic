import SwiftUI
import UniformTypeIdentifiers
import UIKit

private struct ExportItem: Identifiable {
    let id = UUID()
    let url: URL
}

struct RecorderView: View {
    @StateObject private var recorder = NativeRecorder()
    @Environment(\.scenePhase) private var scenePhase
    @State private var importing = false
    @State private var share: ExportItem?
    @State private var placement = "phone-speaker"
    @State private var distance = 5.0
    @State private var rate = 200.0
    @State private var transcript = ""
    private let ink = Color(red: 0.10, green: 0.19, blue: 0.16)
    private let paper = Color(red: 0.96, green: 0.95, blue: 0.91)

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("EXPERIMENT 003 · NATIVE SENSORS")
                            .font(.system(.caption, design: .monospaced)).tracking(1)
                        Text("Follow the signal.")
                            .font(.system(size: 36, weight: .bold, design: .rounded))
                        Text("Raw motion + magnetic field. Playback stays inside this app. No microphone.")
                            .font(.subheadline)
                    }
                    VStack(alignment: .leading, spacing: 12) {
                        Text("1 · Choose your sound").font(.headline)
                        Text(recorder.stimulusName).font(.subheadline)
                        HStack {
                            Button("Calibration tones") { recorder.useTones() }
                            Button("Import speech") { importing = true }
                        }.buttonStyle(.bordered).disabled(recorder.recording)
                        if recorder.previewing {
                            Button("Stop output check") { recorder.stopPreview() }.buttonStyle(.borderedProminent)
                        } else {
                            Button("Check speaker output") { recorder.preview() }.buttonStyle(.bordered)
                                .disabled(recorder.recording)
                        }
                        Text(recorder.routeDescription).font(.caption).textSelection(.enabled)
                        Text("Use the phone's speaker first. For Bluetooth, connect before starting and confirm the named output. Set volume with the phone buttons.")
                            .font(.caption)
                    }.panel()
                    VStack(alignment: .leading, spacing: 12) {
                        Text("2 · Describe the setup").font(.headline)
                        Picker("Placement", selection: $placement) {
                            Text("This phone's speaker").tag("phone-speaker")
                            Text("External speaker · same table").tag("same-table")
                            Text("External speaker · separate surface").tag("separate-surface")
                        }.pickerStyle(.menu)
                        if placement != "phone-speaker" {
                            HStack {
                                Text("Distance (cm)")
                                TextField("Distance", value: $distance, format: .number)
                                    .keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                            }
                        }
                        Picker("Requested sensor rate", selection: $rate) {
                            Text("50 Hz").tag(50.0)
                            Text("100 Hz").tag(100.0)
                            Text("200 Hz probe").tag(200.0)
                        }.pickerStyle(.segmented)
                        Text("This requests a rate; iOS may deliver less. The export measures each sensor's actual timestamps.")
                            .font(.caption)
                        TextField("Known words (optional reference)", text: $transcript, axis: .vertical)
                            .lineLimit(2...5).textFieldStyle(.roundedBorder)
                    }.panel().disabled(recorder.recording)
                    VStack(alignment: .leading, spacing: 14) {
                        Text("3 · Capture").font(.headline)
                        Text(recorder.phase).font(.title2.bold())
                        Text("\(Int(recorder.elapsed)) / \(Int(recorder.finishTime.rounded(.up))) seconds")
                            .font(.system(.title, design: .monospaced))
                        if recorder.recording {
                            ProgressView(value: min(recorder.elapsed, recorder.finishTime), total: recorder.finishTime)
                            Button("Stop and save partial run", role: .destructive) { recorder.stop() }
                                .buttonStyle(.bordered)
                        } else {
                            Button {
                                recorder.placement = placement; recorder.distanceCM = distance
                                recorder.requestedRateHz = rate; recorder.referenceTranscript = transcript
                                recorder.start()
                            } label: {
                                Label("Start sensor test", systemImage: "waveform.path")
                                    .frame(maxWidth: .infinity).padding(.vertical, 8)
                            }.buttonStyle(.borderedProminent)
                        }
                        ForEach(["accelerometer", "gyroscope", "magnetometer"], id: \.self) { name in
                            HStack {
                                Text(name.capitalized)
                                Spacer()
                                Text(recorder.available[name] == true ? "\(recorder.liveCounts[name] ?? 0) samples" : "Unavailable")
                                    .monospacedDigit()
                            }.font(.caption)
                        }
                        Text("10 s quiet → \(Int(recorder.stimulusDuration.rounded())) s playback → 10 s quiet. Keep the phone untouched and this app open.")
                            .font(.caption)
                        Text(recorder.message).font(.subheadline).textSelection(.enabled)
                    }.panel()
                    if !recorder.reports.isEmpty {
                        VStack(alignment: .leading, spacing: 14) {
                            Text("Sensor report").font(.title2.bold())
                            Text(recorder.latestComplete ? "Complete sequence" : "Partial sequence")
                                .font(.subheadline.bold())
                            ForEach(recorder.reports, id: \.sensor) { report in
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(report.sensor.capitalized).font(.headline)
                                    Text("\(report.measuredRateHz.map { String(format: "%.1f", $0) } ?? "—") readings/s · \(report.sampleCount) samples · \(report.gapCount) gaps")
                                        .font(.caption).monospacedDigit()
                                    if report.axes.isEmpty { Text("Not enough readings to compare.").font(.caption) }
                                    ForEach(report.axes, id: \.axis) { axis in
                                        VStack(alignment: .leading, spacing: 3) {
                                            HStack {
                                                Text(axis.axis.uppercased())
                                                Spacer()
                                                Text(axis.playbackToQuietDB.map { String(format: "%+.2f dB", $0) } ?? "Below measurable quiet floor")
                                            }.font(.system(.subheadline, design: .monospaced))
                                            Text("Mean shift: \(String(format: "%.5g", axis.playbackMeanShift)) \(report.unit)")
                                                .font(.caption)
                                        }
                                    }
                                    Divider()
                                }
                            }
                            Text("The ratio compares changing activity after removing each window's average. It is not speech confidence. Magnetic changes can come from magnets or movement; no words have been recovered.")
                                .font(.caption)
                            if let url = recorder.exportURL {
                                Button("Share this run") { share = ExportItem(url: url) }.buttonStyle(.borderedProminent)
                            }
                            Button("Share all native runs") {
                                if let url = recorder.shareAll() { share = ExportItem(url: url) }
                            }.buttonStyle(.bordered)
                        }.panel()
                    }
                    Text("All captures stay on your phone. Saved JSON is available in Files → On My iPhone → Table Signal → SensorRuns. This is a sensor feasibility test, not a working speech decoder.")
                        .font(.caption).padding(.bottom, 16)
                }.padding(20)
            }
            .background(paper).foregroundStyle(ink).tint(ink)
            .navigationTitle("Table Signal").navigationBarTitleDisplayMode(.inline)
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.audio]) { result in
            if case .success(let url) = result { recorder.loadClip(url) }
        }
        .sheet(item: $share) { item in ShareSheet(url: item.url) }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { recorder.interrupt("App moved to background") }
        }
    }
}

private extension View {
    func panel() -> some View {
        self.frame(maxWidth: .infinity, alignment: .leading).padding(16)
            .background(.white.opacity(0.6), in: RoundedRectangle(cornerRadius: 14))
    }
}

private struct ShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
