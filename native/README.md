# Motion-only test — Experiment 005

This iPhone app records **raw accelerometer and gyroscope** streams through Core Motion, independently of screen redraws. It never requests or accesses the camera or microphone. `AVAudioSession` is configured for playback only: generated sounds go to the speaker, with no audio recording. No accessibility settings or network service is used. The only privacy usage description is Motion & Fitness.

The first experiment compares two known sounds against a muted control. This app does **not** reconstruct speech, transcribe words, or promise that a native app will solve the sensor sensitivity or bandwidth limit. A native capture is a different delivery path, not proof of a higher hardware sampling rate.

## Install on your iPhone

This is an Xcode source project, not a signed IPA or an App Store download. You need a Mac with full Xcode and its iOS platform installed. Command Line Tools alone cannot compile or install an iPhone app.

1. Install **Xcode** from the Mac App Store. Open it, accept its setup prompts, and install the iOS platform if requested. Use a version that supports your phone's installed iOS.
2. Open `TableSignalNative.xcodeproj` in this directory.
3. In **Xcode → Settings → Apple Accounts**, add your Apple Account. Select the **TableSignal** target → **Signing & Capabilities**, enable **Automatically manage signing**, and choose your **Personal Team** (or your developer team). If the bundle identifier is unavailable, replace `com.canq0.micwithoutmic.SensorLab` with a unique identifier.
4. Connect and unlock your iPhone with USB. Trust the Mac when prompted. Select your physical iPhone as the run destination.
5. Follow Xcode's Developer Mode prompt. On iPhone this is **Settings → Privacy & Security → Developer Mode**; restart and confirm if requested. The option may appear after pairing with Xcode.
6. Press **Run** (⌘R). If iOS asks you to trust the developer, follow the device's profile prompt. A simulator can check the interface but cannot validate physical sensor capture.

Apple references: [running on a device](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices), [signing and Personal Teams](https://help.apple.com/xcode/mac/current/en.lproj/dev60b6fbbc7.html), [Developer Mode](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device).

## First test: three runs, no audio files needed

1. Open **Table Signal** on your physical iPhone. Disconnect Bluetooth/headphones. Choose **Two-sound test**, **This phone's speaker**, and **200 Hz probe**. Set a comfortable fixed system volume (around 70% is a starting point). Tap **Check speaker output**, confirm the phone speaker plays, and tap **Stop output check**.
2. Choose **Sound on** and **Order A**. Put the phone flat on a solid table, screen facing up. Tap **Start sensor test** and leave it untouched. The first 5 seconds allow settling. Do not open another app, change volume, or lock the screen. Allow motion access if iOS asks; raw Core Motion may not show a prompt. No camera or microphone permission is needed.
3. Wait **68 seconds** for **Complete sequence**. The app records 10 seconds quiet, plays 48 seconds of known tones, and records 10 seconds quiet. Sound A is a 160 Hz tone, Sound B is 320 Hz; each plays for 2 seconds with a 2-second pause. There are six repetitions of each. Below-Nyquist interpretation is not assumed: tones can alias or be filtered in the motion stream.
4. Keeping the same phone position, requested rate, output route, and system volume, choose **Order B** and run another **Sound on** test. It has the same sounds in a different order, for a held-out sequence check.
5. Choose **Muted control** and **Order A**, then run again. Do not change system volume. The app uses the identical source and schedule with its player volume set to zero. You should hear no tones during this run.
6. Tap **Share all native runs → Save to Files** and attach `micwithoutmic-native-runs.json` here. Individual **Share this run** exports are also available. Check that all three new runs say **Complete sequence**. A partial run is retained with its reason; repeat that run using the same setup.

The display reports measured sensor rates, sample counts, gaps, and per-axis activity changes. It does not label tones or words from sensor readings. Recognition will be assessed separately on new recordings against the muted control; source labels in the export are reference ground truth only.

If 200 Hz requested delivers about 100 readings/s, that is a valid measurement, not a failure. To compare request settings, repeat the complete three-run set at 100 Hz. Keep those runs separate from the 200 Hz set.

Optional follow-ups: calibration tones (48 seconds total), or import a known 3–90 second audio file up to 20 MB. These also support Sound on and Muted control. Do not open voicemail or play another app during capture. Bluetooth same-table/separate-surface tests remain available, but start with the phone speaker to reduce timing and placement variables.

Recordings remain in the app's Documents/SensorRuns directory and are accessible in **Files → On My iPhone → Table Signal → SensorRuns**. Each run is saved as a separate JSON file; the most recent report is restored on relaunch. Delete unwanted saved runs through Files. Uninstalling the app deletes its local recordings, so export first.

## What changes from Safari

- Callback delivery through one native `CMMotionManager`, on a dedicated serial operation queue. Capture does not poll the latest reading or depend on screen redraws.
- Two separate streams with sensor timestamps and callback arrival times. The native accelerometer includes gravity in **g**, gyroscope is **rad/s**. Do not directly mix these values with the browser export's m/s² and degrees/s.
- Requested rates of 50, 100, or 200 Hz. **200 Hz is a probe, not a promised rate.** Apple says Core Motion caps requests at the hardware's supported maximum. Measurements determine what this phone actually delivers. Apple's 800 Hz batched example concerns supported Apple Watch hardware and is not a verified iPhone mode.
- The default two-sound source uses two balanced, shuffled orders and a muted role. The JSON records the role, order, exact tone events, stimulus hash, and requested playback time. Muting preserves the source identity and scheduled player start; speaker output is deliberately zero.
- Optional calibration uses 20, 30, 40, 60, 80, 120, and 160 Hz; each has a 2-second tone and a 2-second silence. Frequencies above half the measured sensor rate can alias or disappear. Digital amplitude is 0.2 with 25 ms ramps; physical loudness depends on hardware and the volume setting.
- AVAudioPlayer schedules the sound after a quiet baseline. AVAudioSession reports the output route, hardware volume, and reported output latency. These do not measure actual acoustic arrival or Bluetooth delay.
- Analysis centers each window independently and exports mean shifts separately. This prevents the previous separate-surface run's baseline shift from inflating the vibration ratio. Quiet baseline: 5 seconds to playback; playback: full clip including calibration pauses; final quiet: 2–10 seconds after playback. Ratio is an activity comparison, not calibrated signal-to-noise or recognition confidence.
- Moving to the background, an audio interruption, an output-port change, a system-volume change, or stalled accelerometer delivery stops and saves a partial run. Keeping the app open also avoids switching to voicemail mid-test.

References: [CMMotionManager](https://developer.apple.com/documentation/coremotion/cmmotionmanager), [raw accelerometer requests and hardware caps](https://developer.apple.com/documentation/coremotion/getting-raw-accelerometer-events), [Apple's batched Watch example](https://developer.apple.com/videos/play/wwdc2023/10179/).

## Verification

The signal calculations, balanced comparison orders, generated WAV frequencies/pauses, muted output gain, and camera/microphone API exclusions are in a dependency-free Swift package that can be tested on macOS:

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
