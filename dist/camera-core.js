(function (root) {
  'use strict';
  const frequencies = [40, 80, 160, 320, 640, 1280];
  function toneEvents() {
    return Array.from({ length: 12 }, (_, i) => ({
      frequencyHz: frequencies[i % 6], cycle: Math.floor(i / 6) + 1,
      startSeconds: 10 + i * 5, endSeconds: 13 + i * 5
    }));
  }
  function constraints(quality) {
    return { audio: false, video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: quality === '4k' ? 3840 : 1920 },
      height: { ideal: quality === '4k' ? 2160 : 1080 },
      frameRate: { ideal: 60, max: 60 }
    } };
  }
  function videoOnly(stream, Stream) {
    if (stream.getAudioTracks().length) {
      stream.getTracks().forEach(track => track.stop());
      throw new Error('Unexpected audio track. Capture was stopped.');
    }
    const tracks = stream.getVideoTracks();
    if (tracks.length !== 1 || tracks[0].readyState !== 'live') {
      stream.getTracks().forEach(track => track.stop());
      throw new Error('A live camera video track is required.');
    }
    return new Stream(tracks);
  }
  function recorderOptions(Recorder, quality) {
    const candidates = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mimeType = candidates.find(type => Recorder.isTypeSupported?.(type));
    return { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: quality === '4k' ? 24000000 : 16000000 };
  }
  function fillTones(samples, rate) {
    for (const event of toneEvents()) {
      const start = Math.round(event.startSeconds * rate), n = Math.round(3 * rate), fade = Math.round(.02 * rate);
      for (let j = 0; j < n; j++) {
        const ramp = Math.min(1, j / fade, (n - 1 - j) / fade);
        samples[start + j] = .2 * ramp * Math.sin(2 * Math.PI * event.frequencyHz * j / rate);
      }
    }
    return samples;
  }
  function phase(seconds, mode) {
    if (mode === 'external') return seconds < 10 ? 'Quiet. At 10 seconds, start the track on the other device.' : seconds < 90 ? 'External track window. Keep the phone still.' : 'Final quiet. Keep the phone still.';
    if (seconds < 10) return 'Quiet baseline. Keep the phone still.';
    if (seconds >= 70) return 'Final quiet. Keep the phone still.';
    const event = toneEvents().find(e => seconds >= e.startSeconds && seconds < e.endSeconds);
    return event ? `${event.frequencyHz} Hz tone · cycle ${event.cycle}` : 'Pause between tones.';
  }
  const api = { frequencies, toneEvents, constraints, videoOnly, recorderOptions, fillTones, phase };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CameraTest = api;
})(globalThis);
