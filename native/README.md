# Native sensor lab — Experiment 003

This iPhone app tests a different capture path after Safari recordings delivered about 60 samples/second and only weak tone-related activity. It captures **raw accelerometer, raw gyroscope, and raw magnetometer** independently, and plays the reference sound inside the app. No microphone, camera, accessibility settings, or network service is used.

The magnetometer is an additional experimental channel for nearby magnetic changes. Speaker magnets, electronics, phone movement, and static fields can affect it; a magnetic change is not evidence of intelligible audio. This app does **not** reconstruct speech, transcribe words, or promise that a native app will solve the sensor sensitivity or bandwidth limit.

## Install on your iPhone

This is an Xcode source project, not a signed IPA or an App Store download. You need a Mac with full Xcode and its iOS platform installed. Command Line Tools alone cannot compile or install an iPhone app.

1. Install **Xcode** from the Mac App Store. Open it, accept its setup prompts, and install the iOS platform if requested. Use a version that supports your phone's installed iOS.
2. Open `TableSignalNative.xcodeproj` in this directory.
3. In **Xcode → Settings → Apple Accounts**, add your Apple Account. Select the **TableSignal** target → **Signing & Capabilities**, enable **Automatically manage signing**, and choose your **Personal Team** (or your developer team). If the bundle identifier is unavailable, replace `com.canq0.micwithoutmic.SensorLab` with a unique identifier.
4. Connect and unlock your iPhone with USB. Trust the Mac when prompted. Select your physical iPhone as the run destination.
5. Follow Xcode's Developer Mode prompt. On iPhone this is **Settings → Privacy & Security → Developer Mode**; restart and confirm if requested. The option may appear after pairing with Xcode.
6. Press **Run** (⌘R). If iOS asks you to trust the developer, follow the device's profile prompt. A simulator can check the interface but cannot validate physical sensor capture.

Apple references: [running on a device](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices), [signing and Personal Teams](https://help.apple.com/xcode/mac/current/en.lproj/dev60b6fbbc7.html), [Developer Mode](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device).

## First tests

1. Start with **This phone's speaker**, **Calibration tones**, and the **200 Hz probe**. Disconnect external audio devices if the route still names Bluetooth or headphones. Press **Check speaker output** and confirm the named output and audible sound. Stop the preview.
2. Put the phone down and press **Start sensor test**. Allow motion access if prompted. Keep this app in the foreground and do not touch the phone during the 48-second sequence: 10 seconds quiet, 28 seconds calibration, 10 seconds quiet. The first 5 seconds are settling and are excluded from the quiet baseline.
3. Inspect the **actual rate** for all three sensors, not the requested rate. Compare the per-axis activity changes. Missing sensors, gaps, partial runs, or changed output routes are exported; an incomplete run is not a successful experiment.
4. Import the same known speech file (3–90 seconds, up to 20 MB), choose the same speaker setup, and repeat. Playback happens here: do not open voicemail or switch to another app during capture.
5. For an external speaker, connect it before the test, select **same table** or **separate surface**, enter the actual distance, and confirm the output route with the preview. Match clip, volume, requested rate, and distance across paired runs.
6. Use **Share all native runs** and send the JSON along with the original speech clip. Exports include the source SHA-256, duration, optional known reference words, measured audio output routes/volume/latency, independent sensor samples, and analysis. They do not embed the source audio.

Recordings remain in the app's Documents/SensorRuns directory and are accessible in **Files → On My iPhone → Table Signal → SensorRuns**. Each run is saved as a separate JSON file; the most recent report is restored on relaunch. Delete unwanted saved runs through Files. Uninstalling the app deletes its local recordings, so export first.

## What changes from Safari

- Callback delivery through one native `CMMotionManager`, on a dedicated serial operation queue. Capture does not poll the latest reading or depend on screen redraws.
- Three separate streams with sensor timestamps and callback arrival times. The native accelerometer includes gravity in **g**, gyroscope is **rad/s**, magnetometer is **µT**. Do not directly mix these values with the browser export's m/s² and degrees/s.
- Requested rates of 50, 100, or 200 Hz. **200 Hz is a probe, not a promised rate.** Apple says Core Motion caps requests at the hardware's supported maximum. Measurements determine what this phone actually delivers. Apple's 800 Hz batched example concerns supported Apple Watch hardware and is not a verified iPhone mode.
- Calibration uses 20, 30, 40, 60, 80, 120, and 160 Hz; each has a 2-second tone and a 2-second silence. Frequencies above half the measured sensor rate can alias or disappear. Digital amplitude is 0.2 with 25 ms ramps; physical loudness depends on hardware and the volume setting.
- AVAudioPlayer schedules the sound after a quiet baseline. AVAudioSession reports the output route, hardware volume, and reported output latency. These do not measure actual acoustic arrival or Bluetooth delay.
- Analysis centers each window independently and exports mean shifts separately. This prevents the previous separate-surface run's baseline shift from inflating the vibration ratio. Quiet baseline: 5 seconds to playback; playback: full clip including calibration pauses; final quiet: 2–10 seconds after playback. Ratio is an activity comparison, not calibrated signal-to-noise or recognition confidence.
- Moving to the background, an audio interruption, or an output-port change stops and saves a partial run. Keeping the app open also avoids switching to voicemail mid-test.

References: [CMMotionManager](https://developer.apple.com/documentation/coremotion/cmmotionmanager), [raw accelerometer requests and hardware caps](https://developer.apple.com/documentation/coremotion/getting-raw-accelerometer-events), [magnetometer intervals](https://developer.apple.com/documentation/coremotion/cmmotionmanager/magnetometerupdateinterval), [Apple's batched Watch example](https://developer.apple.com/videos/play/wwdc2023/10179/).

## Verification

The signal calculations and generated WAV are in a dependency-free Swift package that can be tested on macOS:

```sh
swift test --package-path native
```

From the repository root, compile the iPhone target with full Xcode:

```sh
xcodebuild -project native/TableSignalNative.xcodeproj \
  -scheme TableSignal -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO build
```

The GitHub workflow runs both checks. These validate source and numerical behavior; physical sensor rates, microphone-free speech recoverability, and playback on your iPhone require actual device testing. A successful build does not establish recovered speech.
