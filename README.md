# Table Signal — standalone

A standalone, buildless web app for iPhone Safari. Plain HTML, CSS, and JavaScript; no ChatGPT Sites SDK, login, API, or hosting requirement. Host the `dist/` folder on any HTTPS static host. Vercel configuration is included.

## On your iPhone

1. Open the deployed HTTPS link directly in Safari.
2. Tap **Enable motion**, then **Allow**. This is a new website origin, so Safari may ask again.
3. Place your phone screen-up on a stable table. Tap **Start recording** and follow the 45-second guided test.
4. Keep Safari visible and your screen unlocked. The page tries to keep the screen awake when supported.
5. When recording stops, tap **Share / save JSON**, then **Save to Files**, or use **Save CSV**.

Recordings stay in this browser. There is no sensor upload, telemetry, microphone, camera, or accessibility access. The latest completed session is retained in IndexedDB when browser storage is available. Export it for permanent retention. Recordings from a different domain stay with that domain; open and export them there if needed.

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
