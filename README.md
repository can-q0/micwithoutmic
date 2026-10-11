# micwithoutmic

Record table and loudspeaker vibrations using your iPhone's motion sensors.

**[Try the live demo](https://table-signal.vercel.app)**

The demo interface is called **Table Signal**. It is a standalone, buildless web app for iPhone Safari, made with plain HTML, CSS, and JavaScript. Host the `dist/` folder on any HTTPS static host. Vercel configuration is included.

## On your iPhone

1. Connect a Bluetooth speaker to your iPhone, then open the demo in Safari. Keep the screen unlocked.
2. Choose **Speaker experiment**. Start with calibration tones, or select **My speech recording** and load a known audio clip between 3 and 90 seconds (up to 20 MB). Optionally enter its known words as a reference.
3. Choose **Bluetooth speaker · same table**, enter the distance and speaker volume note, and use **Check speaker output** to verify the intended speaker is playing. Safari cannot verify the audio route.
4. Tap **Enable motion**, then **Allow**. Put the phone down and tap **Start speaker test**. Keep your hands off: the page records 10 seconds of quiet, plays the selected sound automatically, then records 10 more seconds of quiet.
5. Repeat with **Bluetooth speaker · separate surface**, using the same sound, distance, and volume. A phone-speaker control run is also available.
6. Review the signal report, then use **Share all runs** to export a JSON bundle. Attach it along with the original speech clip for further analysis.

The original 45-second tapping experiment is available under **Table taps**.

Recordings and loaded audio stay in this browser. There is no sensor upload, telemetry, microphone, camera, or accessibility access. The latest session and the most recent 8 speaker runs are retained in IndexedDB when storage is available. The original audio bytes are not included in exports or retained after reloading; exports include a SHA-256 file identity, duration, reference loudness envelope, and optional reference transcript. Export for permanent retention. Recordings from a different domain stay with that domain.

## Speaker signal report

This is a feasibility experiment for speech reconstruction. It does **not** output recovered words or intelligible reconstructed speech. Entered reference words describe the source clip only.

The report measures each signed acceleration/rotation channel against the quiet baseline: baseline mean, quiet RMS, playback RMS, final quiet RMS, unique playback values, and playback-to-quiet change in dB when the quiet floor is measurable. A ratio compares activity, not laboratory SNR. A baseline shift is flagged because touching or tilting can create a signal.

The strongest measurable channel is compared with the reference amplitude envelope in 200 ms bins, searching delays from -1000 to +1500 ms. The maximum correlation is exploratory and is not recognition confidence. Model selection and the delay search can inflate apparent matching; repeat runs and held-out tests are required.

A Hann-windowed, averaged frequency spectrum uses the longest contiguous playback segment, resampled at the median delivered interval. It does not bridge delivery gaps. Observed frequencies may be aliases and cannot identify the original speaker frequencies reliably. The displayed frequency band is estimated from browser delivery intervals, not a verified hardware bandwidth.

Audio is scheduled with Web Audio after the user taps Start. The export preserves scheduled audio-clock timing and reported output latency when available. Bluetooth output delay is not directly measured. Only automatically completed runs qualify for surface comparison; interrupted/partial runs are retained and labeled.

Calibration plays 20, 40, 80, 160, and 320 Hz at a modest digital amplitude for 2 seconds each, separated by 2-second pauses. The output-check preview uses the 160 Hz passage. Speaker response, Bluetooth processing, browser rounding, low sampling rate, and movements can limit the results.

## What gets recorded

Every usable `devicemotion` event delivered during the session is saved, including settling. Exports contain raw acceleration, acceleration including gravity, rotation, arrival times, browser event timestamps, reported intervals, test phase, baseline, average delivery rate, and gaps. Unavailable values remain null.

The graph is movement magnitude relative to a baseline estimated during the first 5 seconds. It uses linear acceleration where available, otherwise acceleration including gravity. Tilt also produces signal. Peak excludes settling. Browser sampling and sensor precision limit capture; a flat graph does not prove absence of vibration.

Hiding the page or locking the screen stops recording. Three seconds without usable events, ten minutes total, or 50,000 samples also stop the session. Detected gaps exceed 150 ms or four times the median arrival interval, whichever is larger.

## Development

No dependency installation or build is needed. Node.js 22+ can run the checks:

```sh
npm run check
npm test
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
```

Desktop localhost is for layout and simulated-event testing. iPhone motion access requires HTTPS; an ordinary LAN HTTP URL will not work.

Vercel: link this directory to the intended project, verify the project and team, then deploy production with `vercel deploy --prod`. Other static hosts: upload the contents of `dist/` as the website root.

Web fonts load from Google Fonts and fall back to locally available fonts if unavailable. Sensor recording does not depend on the font service.

## License

[MIT](LICENSE) — Copyright (c) 2026 can-q0.
