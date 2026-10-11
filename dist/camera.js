(() => {
  'use strict';
  const C = window.CameraTest, $ = id => document.getElementById(id);
  const preview = $('camera-preview');
  let state = 'idle', stream = null, track = null, recorder = null, context = null;
  let toneSource = null, toneGain = null, checkSource = null, wake = null;
  let report = null, chunks = [], bytes = 0, videoFile = null, jsonFile = null;
  let videoURL = null, jsonURL = null, startPerf = 0, armAt = 0, frameID = null;
  let lastFrame = 0, previousFrame = null, callbackCount = 0, settings = null, controls = [];
  let openingToken = 0, runToken = 0;
  const LIMIT = 350 * 1024 * 1024;
  const clean = value => JSON.parse(JSON.stringify(value || {}, (k, v) => ['deviceId', 'groupId'].includes(k) ? undefined : v));
  const running = () => ['arming', 'recording', 'finalizing'].includes(state);
  const message = text => { $('camera-message').textContent = text; };
  function refresh() {
    for (const id of ['camera-source', 'camera-role', 'camera-quality', 'camera-note']) $(id).disabled = running() || state === 'saved' || state === 'opening';
    $('camera-enable').disabled = state !== 'idle';
    $('camera-enable').hidden = state !== 'idle' && state !== 'opening';
    $('camera-start').hidden = running() || state === 'saved';
    $('camera-start').disabled = state !== 'preview';
    $('camera-stop').hidden = !['arming', 'recording'].includes(state);
    $('camera-disable').disabled = state !== 'preview';
    $('camera-check').disabled = state !== 'preview' || $('camera-source').value !== 'phone';
    $('camera-start').textContent = $('camera-role').value === 'muted' ? 'Start muted control ●' : 'Start sound-on test ●';
    const external = $('camera-source').value === 'external';
    $('external-help').hidden = !external;
    $('camera-plan').textContent = external
      ? '100 seconds. Start the external track at recording time 10 seconds. The app does not play sound in this mode.'
      : `80 seconds: 10s quiet → two tone cycles with pauses → 10s quiet. ${$('camera-role').value === 'muted' ? 'The app silences its tone output; keep system volume unchanged.' : 'Tones play automatically. Confirm the sound comes from the iPhone speaker.'}`;
  }
  function stopCheck() {
    if (checkSource) { try { checkSource.stop(); } catch (_) {} checkSource.disconnect(); checkSource = null; }
  }
  function stopSound() {
    stopCheck();
    if (toneSource) { try { toneSource.stop(); } catch (_) {} toneSource.disconnect(); toneSource = null; }
    toneGain?.disconnect(); toneGain = null;
  }
  function releaseCamera() {
    openingToken++;
    if (frameID !== null && preview.cancelVideoFrameCallback) preview.cancelVideoFrameCallback(frameID);
    frameID = null;
    const old = stream; stream = null; track = null;
    if (old) old.getTracks().forEach(t => { t.onended = null; t.stop(); });
    preview.srcObject = null;
    $('camera-empty').hidden = false;
  }
  async function releaseWake() { if (wake) { const old = wake; wake = null; try { await old.release(); } catch (_) {} } }
  function frames(now, meta) {
    if (!stream) return;
    lastFrame = performance.now();
    if (state === 'recording') {
      callbackCount++;
      report.previewFrameCallbacks.push({
        elapsedMs: lastFrame - startPerf, callbackTimeMs: now,
        mediaTimeSeconds: meta.mediaTime, presentedFrames: meta.presentedFrames,
        presentationTimeMs: meta.presentationTime, expectedDisplayTimeMs: meta.expectedDisplayTime,
        width: meta.width, height: meta.height, processingDurationSeconds: meta.processingDuration
      });
      if (previousFrame !== null) $('camera-fps').textContent = `${(1000 / (lastFrame - previousFrame)).toFixed(0)} fps`;
      previousFrame = lastFrame;
    }
    frameID = preview.requestVideoFrameCallback(frames);
  }
  async function requestControls(t) {
    const caps = t.getCapabilities?.() || {}, initial = t.getSettings?.() || {}, attempts = [];
    const candidates = [];
    if (Array.isArray(caps.focusMode) && caps.focusMode.includes('manual') && Number.isFinite(initial.focusDistance)) candidates.push({ focusMode: 'manual', focusDistance: initial.focusDistance });
    if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes('manual') && Number.isFinite(initial.exposureTime)) candidates.push({ exposureMode: 'manual', exposureTime: initial.exposureTime, ...(Number.isFinite(initial.iso) ? { iso: initial.iso } : {}) });
    if (caps.imageStabilization === true || (Array.isArray(caps.imageStabilization) && caps.imageStabilization.includes(false))) candidates.push({ imageStabilization: false });
    for (const values of candidates) {
      const attempt = { requested: values };
      try { await t.applyConstraints({ advanced: [values] }); attempt.settingsAfter = clean(t.getSettings()); attempt.acceptedWithoutError = true; }
      catch (error) { attempt.error = error.name + ': ' + error.message; }
      attempts.push(attempt);
    }
    return { capabilities: clean(caps), supportedConstraints: clean(navigator.mediaDevices.getSupportedConstraints?.()), attempts,
      limitation: 'Acceptance does not guarantee a control took effect. Optical stabilization and rolling-shutter row timing are not verified.' };
  }
  async function enable() {
    if (state !== 'idle') return;
    if (!isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      message('Camera recording needs a supported browser on HTTPS. Open this page in iPhone Safari.'); return;
    }
    state = 'opening'; refresh(); message('Requesting camera only…');
    const token = ++openingToken;
    let acquired = null;
    try {
      acquired = await navigator.mediaDevices.getUserMedia(C.constraints($('camera-quality').value));
      if (token !== openingToken || document.hidden) { acquired.getTracks().forEach(t => t.stop()); throw new Error('Camera opening was interrupted. Keep Safari visible.'); }
      stream = C.videoOnly(acquired, MediaStream); track = stream.getVideoTracks()[0];
      preview.srcObject = stream; await preview.play();
      await new Promise(resolve => setTimeout(resolve, 500));
      if (token !== openingToken || !stream) throw new Error('Camera opening was interrupted.');
      const acquiredControls = await requestControls(track);
      if (token !== openingToken || !stream || document.hidden) return;
      controls = acquiredControls;
      settings = clean(track.getSettings());
      $('camera-format').textContent = `${settings.width || preview.videoWidth}×${settings.height || preview.videoHeight} · ${settings.frameRate ? settings.frameRate.toFixed(0) : '?'} fps`;
      $('camera-audio').textContent = String(stream.getAudioTracks().length);
      $('camera-empty').hidden = true;
      $('camera-status').textContent = '● CAMERA READY'; $('camera-status').className = 'status live';
      $('camera-phase').textContent = 'Position the phone. Keep clear edges in the preview.';
      state = 'preview'; lastFrame = performance.now();
      if (preview.requestVideoFrameCallback) frameID = preview.requestVideoFrameCallback(frames);
      track.onended = () => {
        if (running()) stop('camera-ended');
        else { releaseCamera(); state = 'idle'; refresh(); message('The camera stopped. Enable it again.'); }
      };
      const facing = settings.facingMode;
      message(`${track.label || 'Camera ready'}. ${facing && facing !== 'environment' ? 'The browser selected a front-facing camera; reopen this page in Safari on your iPhone for the rear camera test. ' : ''}Reported settings may differ from your preference. ${controls.attempts.length ? 'Available manual controls were requested.' : 'Manual focus/exposure/stabilization controls were not exposed by this browser.'}`);
    } catch (error) {
      acquired?.getTracks().forEach(t => t.stop());
      if (token !== openingToken) return;
      releaseCamera(); state = 'idle';
      $('camera-status').textContent = '● CAMERA OFF';
      message(error.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access for this site in Safari, then retry. Microphone access is not needed.' : error.message);
    }
    refresh();
  }
  async function audioContext() {
    const Constructor = window.AudioContext || window.webkitAudioContext;
    if (!Constructor) throw new Error('Audio playback is unavailable. Use External speaker mode.');
    if (!context || context.state === 'closed') context = new Constructor();
    await context.resume();
    if (context.state !== 'running') throw new Error('Audio playback did not start. Tap Start again.');
    return context;
  }
  async function checkOutput() {
    try {
      stopCheck(); const ctx = await audioContext();
      if (state !== 'preview') return;
      const oscillator = ctx.createOscillator(), gain = ctx.createGain();
      oscillator.frequency.value = 320; gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(.15, ctx.currentTime + .02);
      gain.gain.setValueAtTime(.15, ctx.currentTime + .8); gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1);
      oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(); oscillator.stop(ctx.currentTime + 1);
      checkSource = oscillator;
      oscillator.onended = () => { gain.disconnect(); if (checkSource === oscillator) checkSource = null; };
      message('A short tone is playing. Confirm it comes from the iPhone speaker, then let it stop before recording.');
    } catch (error) { message(error.message); }
  }
  async function start() {
    if (state !== 'preview' || document.hidden) return;
    const token = ++runToken;
    state = 'arming'; refresh(); stopCheck();
    try {
      C.videoOnly(stream, MediaStream); // Verify the invariant again at the recording boundary.
      const source = $('camera-source').value, role = $('camera-role').value;
      const duration = source === 'phone' ? 80 : 100;
      const sessionID = (crypto.randomUUID?.() || Date.now().toString(36));
      report = { schemaVersion: 1, kind: 'micwithoutmic-camera-test', build: 'camera-004-v1', sessionID,
        role, source, note: $('camera-note').value.trim(), userAgent: navigator.userAgent,
        requestedCameraConstraints: C.constraints($('camera-quality').value), cameraLabel: track.label,
        settingsAtStart: clean(track.getSettings()), cameraControls: controls,
        microphoneRequested: false, inputAudioTracks: 0, recorderAudioTracks: 0,
        plannedDurationSeconds: duration, requestedRecorderOptions: C.recorderOptions(MediaRecorder, $('camera-quality').value),
        stimulus: { frequenciesHz: C.frequencies, events: C.toneEvents(), sourceFileDurationSeconds: 80,
          digitalPeakAmplitude: .2, audible: role === 'sound',
          timingReference: source === 'phone' ? 'AudioContext schedule relative to recorder start event; acoustic output delay is not measured.' : 'Source-file time. User starts external playback near recording time 10s; actual offset/output delay is unknown.',
          nominalPlaybackStartSeconds: source === 'phone' ? 0 : 10 },
        previewFrameCallbacks: [], warnings: [
          'This is compressed camera video. No audio or words have been recovered.',
          'Reported camera format and preview callbacks are not a verification of encoded frame rate or rolling-shutter row timing.',
          'Browser APIs may hide or reject controls; optical stabilization is not guaranteed off.',
          'The audio output route and physical volume are not verified by Safari.'
        ] };
      chunks = []; bytes = 0; callbackCount = 0; previousFrame = null;
      if (source === 'phone') {
        const ctx = await audioContext();
        if (state !== 'arming' || token !== runToken) return;
        const buffer = ctx.createBuffer(1, Math.round(ctx.sampleRate * 80), ctx.sampleRate);
        C.fillTones(buffer.getChannelData(0), ctx.sampleRate);
        toneSource = ctx.createBufferSource(); toneSource.buffer = buffer;
        toneGain = ctx.createGain(); toneGain.gain.value = role === 'muted' ? 0 : 1;
        toneSource.connect(toneGain); toneGain.connect(ctx.destination);
        report.stimulus.audioSampleRateHz = ctx.sampleRate;
      }
      if (document.hidden || state !== 'arming' || token !== runToken) return;
      let acquiredWake;
      try { acquiredWake = await navigator.wakeLock?.request('screen'); }
      catch (_) { if (token === runToken) report?.warnings.push('Screen wake lock was unavailable. Keep the screen awake.'); }
      if (state !== 'arming' || token !== runToken) { await acquiredWake?.release(); return; }
      wake = acquiredWake;
      armAt = performance.now() + 5000;
      $('camera-status').textContent = '● STARTING IN 5s';
      $('camera-phase').textContent = 'Set the phone down. Recording begins after the countdown.';
      message('Hands off after positioning. Keep Safari visible; no microphone track will be recorded.');
    } catch (error) {
      if (token !== runToken || state !== 'arming') return;
      stopSound(); await releaseWake(); report = null;
      if (!track || track.readyState !== 'live') { releaseCamera(); state = 'idle'; }
      else state = 'preview';
      refresh(); message(error.message);
    }
  }
  function begin() {
    if (state !== 'arming' || !armAt || document.hidden) return;
    armAt = 0;
    try {
      const recorderStream = C.videoOnly(stream, MediaStream);
      recorder = new MediaRecorder(recorderStream, report.requestedRecorderOptions);
      recorder.ondataavailable = event => {
        if (!event.data?.size) return;
        chunks.push(event.data); bytes += event.data.size;
        if (bytes >= LIMIT && state === 'recording') stop('350mib-file-limit');
      };
      recorder.onstart = () => {
        if (state !== 'arming') return;
        state = 'recording'; startPerf = performance.now(); lastFrame = startPerf; previousFrame = null;
        report.startedAt = new Date().toISOString(); report.recorderStartPerformanceMs = startPerf;
        report.actualRecorder = { mimeType: recorder.mimeType, videoBitsPerSecond: recorder.videoBitsPerSecond };
        if (toneSource) {
          try {
            const audioStart = context.currentTime + .05;
            toneSource.start(audioStart);
            report.stimulus.audioContextStartSeconds = audioStart;
            report.stimulus.nominalAudioStartAfterRecorderSeconds = .05;
            report.stimulus.baseLatencySeconds = context.baseLatency;
            report.stimulus.outputLatencySeconds = context.outputLatency;
          } catch (error) { report.warnings.push(error.message); stop('audio-output-error'); return; }
        }
        $('camera-status').textContent = '● RECORDING VIDEO ONLY'; $('camera-status').className = 'status recording'; refresh();
      };
      recorder.onerror = event => { report.warnings.push(event.error?.message || 'MediaRecorder error'); stop('recorder-error'); };
      recorder.onstop = finish;
      recorder.start(1000);
    } catch (error) {
      stopSound(); releaseWake(); report = null;
      if (!track || track.readyState !== 'live') { releaseCamera(); state = 'idle'; }
      else state = 'preview';
      refresh(); message('Recording could not start: ' + error.message);
    }
  }
  function stop(reason) {
    if (state === 'arming') {
      runToken++;
      state = 'preview'; armAt = 0; stopSound(); releaseWake();
      if (recorder && recorder.state !== 'inactive') { recorder.onstart = null; recorder.onstop = null; recorder.stop(); }
      recorder = null; report = null; refresh(); message('Countdown cancelled. No recording was saved.'); return;
    }
    if (state !== 'recording') return;
    state = 'finalizing'; report.stopReason = reason;
    report.durationSeconds = (performance.now() - startPerf) / 1000;
    report.settingsAtStop = clean(track?.getSettings());
    stopSound(); releaseWake(); refresh();
    $('camera-status').textContent = '● FINALIZING';
    try { if (recorder.state !== 'inactive') recorder.stop(); else finish(); }
    catch (error) { report.warnings.push(error.message); finish(); }
  }
  function finish() {
    if (!report || state === 'saved') return;
    stopSound(); releaseWake(); releaseCamera();
    const type = recorder?.mimeType || report.actualRecorder?.mimeType || chunks[0]?.type || 'video/mp4';
    const ext = type.includes('webm') ? 'webm' : 'mp4';
    const basename = `camera-${report.source}-${report.role}-${report.sessionID}`;
    const blob = new Blob(chunks, { type }); chunks = [];
    videoFile = new File([blob], `${basename}.${ext}`, { type });
    report.video = { filename: videoFile.name, bytes: videoFile.size, mimeType: type, audioTracksSuppliedToRecorder: 0 };
    const times = report.previewFrameCallbacks.map(f => f.elapsedMs);
    report.previewDelivery = { callbackCount, meanCallbacksPerSecond: times.length > 1 ? (times.length - 1) * 1000 / (times.at(-1) - times[0]) : null,
      callbackGapsOver100ms: times.slice(1).filter((t, i) => t - times[i] > 100).length,
      maximumCallbackGapMs: times.length > 1 ? times.slice(1).reduce((m, t, i) => Math.max(m, t - times[i]), 0) : null,
      note: 'Displayed preview callbacks only. Missing callbacks can reflect compositor scheduling, not missing encoded frames.' };
    if (!videoFile.size) report.warnings.push('No encoded video bytes were produced. Export the report to diagnose.');
    if (report.stopReason !== 'completed') report.warnings.push('Partial/interrupted run. Do not treat it as a completed comparison.');
    report.finishedAt = new Date().toISOString();
    jsonFile = new File([JSON.stringify(report, null, 2)], `${basename}.json`, { type: 'application/json' });
    videoURL = URL.createObjectURL(videoFile); jsonURL = URL.createObjectURL(jsonFile);
    $('camera-playback').src = videoURL;
    $('camera-download-video').href = videoURL; $('camera-download-video').download = videoFile.name;
    $('camera-download-report').href = jsonURL; $('camera-download-report').download = jsonFile.name;
    $('camera-share-video').disabled = videoFile.size === 0;
    $('camera-summary').textContent = `${report.role === 'muted' ? 'Muted control' : 'Sound-on test'} · ${(report.durationSeconds || 0).toFixed(1)}s · ${(videoFile.size / 1048576).toFixed(1)} MB · ${report.stopReason === 'completed' ? 'Completed' : 'Partial: ' + report.stopReason}. Recorded with zero audio tracks. Save the original video and its paired settings JSON.`;
    $('camera-result').hidden = false; $('camera-status').textContent = '● RECORDING READY'; $('camera-status').className = 'status live';
    $('camera-phase').textContent = 'Camera is off. Save both files, then record the comparison.';
    state = 'saved'; recorder = null; refresh(); message('Capture has stopped. This tab holds one run; save both files before reloading or starting another run.');
    $('camera-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function share(file) {
    if (!file) return;
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); $('camera-export-message').textContent = 'Share completed. Save or share the other file too.'; }
      else $('camera-export-message').textContent = 'File sharing is unavailable in this browser. Use the Save links below, then save to Files.';
    } catch (error) { $('camera-export-message').textContent = error.name === 'AbortError' ? 'Sharing cancelled. Both files are still available here.' : 'Sharing failed. Use the Save links below.'; }
  }
  function reset() {
    if (state !== 'saved') return;
    $('camera-playback').pause(); $('camera-playback').removeAttribute('src'); $('camera-playback').load();
    URL.revokeObjectURL(videoURL); URL.revokeObjectURL(jsonURL);
    videoURL = jsonURL = videoFile = jsonFile = report = null;
    $('camera-download-video').removeAttribute('href'); $('camera-download-report').removeAttribute('href');
    $('camera-result').hidden = true; $('camera-clock').textContent = '00:00'; $('camera-fps').textContent = '— fps';
    $('camera-export-message').textContent = 'Save both files before starting another run. The video is held in this tab only; reloading will lose it.';
    $('camera-status').textContent = '● CAMERA OFF'; state = 'idle'; refresh(); message('Choose the recording role, then enable the camera again.');
    document.querySelector('.camera-setup')?.scrollIntoView?.({ behavior: 'smooth' });
  }
  setInterval(() => {
    if (state === 'arming' && armAt) {
      const left = Math.ceil((armAt - performance.now()) / 1000);
      if (left <= 0) begin(); else $('camera-status').textContent = `● STARTING IN ${left}s`;
    }
    if (state !== 'recording') return;
    const elapsed = (performance.now() - startPerf) / 1000;
    $('camera-clock').textContent = `${Math.floor(elapsed / 60).toString().padStart(2, '0')}:${Math.floor(elapsed % 60).toString().padStart(2, '0')}`;
    const actual = elapsed - (report.stimulus.nominalAudioStartAfterRecorderSeconds || 0);
    $('camera-phase').textContent = (report.role === 'muted' ? 'Muted control · ' : '') + C.phase(actual, report.source);
    if (report.source === 'phone' && context?.state !== 'running') stop('audio-context-interrupted');
    else if (elapsed >= report.plannedDurationSeconds + (report.source === 'phone' ? .05 : 0)) stop('completed');
    else if (preview.requestVideoFrameCallback && performance.now() - lastFrame > 4000) stop('preview-stalled');
  }, 100);
  $('camera-enable').addEventListener('click', enable);
  $('camera-start').addEventListener('click', start);
  $('camera-stop').addEventListener('click', () => stop('manual-stop'));
  $('camera-check').addEventListener('click', checkOutput);
  $('camera-disable').addEventListener('click', () => { stopCheck(); releaseCamera(); state = 'idle'; refresh(); $('camera-status').textContent = '● CAMERA OFF'; message('Camera is off.'); });
  $('camera-share-video').addEventListener('click', () => share(videoFile));
  $('camera-share-report').addEventListener('click', () => share(jsonFile));
  $('camera-new').addEventListener('click', reset);
  for (const id of ['camera-source', 'camera-role']) $(id).addEventListener('change', refresh);
  $('camera-quality').addEventListener('change', () => { if (state === 'preview') { releaseCamera(); state = 'idle'; $('camera-status').textContent = '● CAMERA OFF'; message('Quality changed. Enable the camera again to request the new format.'); refresh(); } });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    if (running()) stop('page-hidden');
    if (state === 'preview' || state === 'opening') { releaseCamera(); state = 'idle'; refresh(); message('Camera stopped because the page was hidden. Enable it again.'); }
  });
  window.addEventListener('pagehide', () => { if (running()) stop('page-hidden'); stopSound(); releaseCamera(); });
  window.addEventListener('beforeunload', event => {
    if (running() || state === 'saved') { event.preventDefault(); event.returnValue = ''; }
  });
  refresh();
})();
