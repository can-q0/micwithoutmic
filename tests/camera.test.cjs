const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../dist/camera-core.js');

class Track {
  constructor(kind = 'video') { this.kind = kind; this.readyState = 'live'; this.label = 'Rear test camera'; }
  stop() { this.readyState = 'ended'; }
  getSettings() { return { width: 3840, height: 2160, frameRate: 60, facingMode: 'environment', deviceId: 'private-device' }; }
  getCapabilities() { return {}; }
}
class Stream {
  constructor(tracks) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
}
function harness(options = {}) {
  const elements = new Map(), documentListeners = {}, windowListeners = {}, urls = new Map();
  const calls = { requests: [], recorders: [], sources: [], gains: [], audioContexts: 0 };
  let now = 0, interval;
  const tracks = options.tracks || [new Track()];
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: ({ 'camera-source': 'phone', 'camera-role': 'sound', 'camera-quality': '4k', 'camera-note': '' })[id] || '',
      hidden: false, disabled: false, textContent: '', handlers: {},
      addEventListener(name, fn) { this.handlers[name] = fn; },
      async fire(name = 'click') { return this.handlers[name]?.(); },
      async play() {}, pause() {}, load() {}, scrollIntoView() {},
      removeAttribute(name) { delete this[name]; }
    });
    return elements.get(id);
  }
  class Recorder {
    static isTypeSupported(type) { return type === 'video/mp4'; }
    constructor(stream, options) { this.stream = stream; this.mimeType = options.mimeType; this.videoBitsPerSecond = options.videoBitsPerSecond; this.state = 'inactive'; calls.recorders.push(this); }
    start() { this.state = 'recording'; this.onstart?.(); }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['encoded video fixture'], { type: this.mimeType }) }); this.onstop?.(); }
  }
  class Audio {
    constructor() { calls.audioContexts++; this.state = 'running'; this.sampleRate = 4000; this.currentTime = 0; this.destination = {}; }
    async resume() { if (options.resume) await options.resume(); }
    createBuffer(channels, length, rate) { const data = new Float32Array(length); return { getChannelData: () => data, rate }; }
    createBufferSource() { const source = { connect() {}, disconnect() {}, start(at) { this.startedAt = at; }, stop() { this.stopped = true; } }; calls.sources.push(source); return source; }
    createGain() { const gain = { gain: { value: 1 }, connect() {}, disconnect() {} }; calls.gains.push(gain); return gain; }
  }
  const document = { hidden: false, getElementById: element, querySelector: () => null, addEventListener: (n, fn) => documentListeners[n] = fn };
  const window = { CameraTest: C, MediaRecorder: Recorder, AudioContext: Audio, addEventListener: (n, fn) => windowListeners[n] = fn };
  const navigator = { userAgent: 'fixture', mediaDevices: { getSupportedConstraints: () => ({ frameRate: true }), getUserMedia: async request => { calls.requests.push(request); if (options.getUserMedia) return options.getUserMedia(); return new Stream(tracks); } } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/camera.js'), 'utf8'), {
    window, document, navigator, MediaStream: Stream, MediaRecorder: Recorder,
    isSecureContext: true, performance: { now: () => now }, crypto: { randomUUID: () => 'fixture-run' },
    Blob, File, Date, setTimeout: fn => fn(), setInterval: fn => interval = fn,
    URL: { createObjectURL: file => { const url = 'blob:' + urls.size; urls.set(url, file); return url; }, revokeObjectURL: url => urls.delete(url) }
  });
  return { calls, tracks, element, urls,
    enable: () => element('camera-enable').fire(), start: () => element('camera-start').fire(),
    tick(ms) { now += ms; interval(); },
    hide() { document.hidden = true; documentListeners.visibilitychange(); },
    pagehide() { windowListeners.pagehide(); },
    async report() { return JSON.parse(await urls.get(element('camera-download-report').href).text()); },
    video() { return urls.get(element('camera-download-video').href); }
  };
}

test('camera request explicitly denies audio and asks for rear camera', () => {
  for (const quality of ['4k', '1080']) {
    assert.equal(C.constraints(quality).audio, false);
    assert.equal(C.constraints(quality).video.facingMode.ideal, 'environment');
    assert.equal(C.constraints(quality).video.frameRate.max, 60);
  }
  const config = JSON.parse(fs.readFileSync(require.resolve('../vercel.json')));
  assert.ok(config.headers.some(rule => rule.headers.some(h => h.key === 'Permissions-Policy' && h.value.includes('microphone=()'))));
});
test('unexpected audio fails closed and stops every acquired track', () => {
  const tracks = [new Track(), new Track('audio')];
  assert.throws(() => C.videoOnly(new Stream(tracks), Stream), /Unexpected audio/);
  assert.ok(tracks.every(t => t.readyState === 'ended'));
  assert.throws(() => C.videoOnly(new Stream([]), Stream), /live camera/);
});
test('tone source has known quiet intervals and two identical cycles', () => {
  const rate = 4000, data = C.fillTones(new Float32Array(80 * rate), rate);
  assert.ok(data.slice(0, 10 * rate).every(v => v === 0));
  assert.ok(data.slice(70 * rate).every(v => v === 0));
  assert.deepEqual(data.slice(10 * rate, 38 * rate), data.slice(40 * rate, 68 * rate));
  assert.ok(data.slice(13 * rate, 15 * rate).every(v => v === 0));
  assert.ok(data.some(v => Math.abs(v) > .19));
  assert.ok(data.every(v => Math.abs(v) <= .200001));
});
test('completed sound run supplies zero audio tracks and exports paired files', async () => {
  const h = harness(); await h.enable(); await h.start();
  assert.equal(h.calls.requests[0].audio, false);
  assert.equal(h.calls.recorders.length, 0);
  h.tick(5000);
  assert.equal(h.calls.recorders[0].stream.getAudioTracks().length, 0);
  assert.equal(h.calls.recorders[0].stream.getVideoTracks().length, 1);
  assert.equal(h.calls.sources[0].startedAt, .05);
  h.tick(80100);
  const report = await h.report();
  assert.equal(report.stopReason, 'completed');
  assert.equal(report.microphoneRequested, false);
  assert.equal(report.video.audioTracksSuppliedToRecorder, 0);
  assert.equal(report.video.filename, h.video().name);
  assert.ok(h.video().size > 0);
  assert.equal(report.settingsAtStart.deviceId, undefined);
  assert.equal(h.tracks[0].readyState, 'ended');
});
test('muted run keeps identical schedule with zero output gain', async () => {
  const h = harness(); h.element('camera-role').value = 'muted'; await h.enable(); await h.start(); h.tick(5000); h.tick(80100);
  assert.equal(h.calls.gains[0].gain.value, 0);
  const report = await h.report();
  assert.equal(report.role, 'muted'); assert.equal(report.stimulus.audible, false);
  assert.deepEqual(report.stimulus.events, C.toneEvents());
});
test('external mode records camera without creating an audio context', async () => {
  const h = harness(); h.element('camera-source').value = 'external'; await h.enable(); await h.start(); h.tick(5000); h.tick(100100);
  assert.equal(h.calls.audioContexts, 0);
  assert.equal((await h.report()).plannedDurationSeconds, 100);
  assert.equal((await h.report()).stopReason, 'completed');
});
test('hiding recording finalizes a labeled partial video and turns camera off', async () => {
  const h = harness(); await h.enable(); await h.start(); h.tick(5000); h.tick(12000); h.hide();
  const report = await h.report();
  assert.equal(report.stopReason, 'page-hidden'); assert.equal(report.durationSeconds, 12);
  assert.ok(report.warnings.some(w => w.startsWith('Partial/')));
  assert.ok(h.video().size); assert.equal(h.tracks[0].readyState, 'ended');
});
test('cancelled countdown never starts recorder or exports a video', async () => {
  const h = harness(); await h.enable(); await h.start(); await h.element('camera-stop').fire(); h.tick(6000);
  assert.equal(h.calls.recorders.length, 0); assert.equal(h.urls.size, 0);
  assert.equal(h.calls.sources[0].stopped, true);
});
test('late camera permission response after hiding stops its tracks', async () => {
  let resolve; const permission = new Promise(r => resolve = r), tracks = [new Track()];
  const h = harness({ getUserMedia: () => permission }); const opening = h.enable(); h.hide(); resolve(new Stream(tracks)); await opening;
  assert.equal(tracks[0].readyState, 'ended'); assert.equal(h.element('camera-enable').disabled, false);
});
test('cancelled async start cannot arm a later run', async () => {
  let resolve; const pending = new Promise(r => resolve = r);
  const h = harness({ resume: () => pending }); await h.enable(); const starting = h.start();
  await h.element('camera-stop').fire(); resolve(); await starting; h.tick(6000);
  assert.equal(h.calls.sources.length, 0); assert.equal(h.calls.recorders.length, 0);
  await h.start(); h.tick(5000); assert.equal(h.calls.recorders.length, 1);
});
test('unexpected microphone track from browser is rejected before preview', async () => {
  const h = harness({ tracks: [new Track(), new Track('audio')] }); await h.enable();
  assert.ok(h.tracks.every(t => t.readyState === 'ended'));
  assert.match(h.element('camera-message').textContent, /Unexpected audio/);
  assert.equal(h.element('camera-start').disabled, true);
});
