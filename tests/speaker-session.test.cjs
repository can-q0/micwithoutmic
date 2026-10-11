const {test}=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./helpers/browser.cjs');
async function ready(h){await h.element('connect').click();h.emit(100);}
test('speaker run schedules known sound, records all phases, analyzes, and exports raw samples',async()=>{
  const h=harness();await ready(h);await h.element('speaker-start').click();assert.equal(h.sources[0].started[0],10.1);assert.equal(h.element('speaker-placement').disabled,true);
  for(let t=120;t<=40100;t+=20){h.emit(t,.001*Math.sin(t/31));h.tick(t);}await Promise.resolve();
  const session=h.context.TableRecorder.getLatest();assert.equal(session.stop_reason,'Speaker test complete.');assert.equal(session.samples.length,2000);assert.equal(session.analysis.complete,true);assert.ok(session.samples.some(s=>s.phase==='speaker-playback'));assert.ok(session.samples.some(s=>s.phase==='speaker-quiet-after'));assert.equal(h.sources[0].stopped,true);
  await h.element('export-json').click();const data=JSON.parse(await h.exported().text());assert.equal(data.experiment.stimulus.id,'calibration-tones-v1');assert.equal(data.samples.length,2000);assert.equal(data.experiment.distance_cm,20);assert.equal(h.element('speaker-report').hidden,false);
});
test('page hiding stops scheduled audio and marks the run incomplete',async()=>{
  const h=harness();await ready(h);await h.element('speaker-start').click();h.emit(120);await h.hidden();assert.equal(h.sources[0].stopped,true);assert.equal(h.context.TableRecorder.getLatest().analysis.complete,false);
});
test('an interrupted audio context stops recording even while motion readings arrive',async()=>{
  const h=harness();await ready(h);await h.element('speaker-start').click();h.contexts[0].state='suspended';h.emit(120);h.tick(120);assert.match(h.context.TableRecorder.getLatest().stop_reason,/audio playback was interrupted/);assert.equal(h.sources[0].stopped,true);
});
test('a pending preview cannot start after Safari becomes hidden',async()=>{
  const h=harness();let resolve;h.setResumeGate(new Promise(r=>resolve=r));const pending=h.element('check-output').click();await h.hidden();resolve();await pending;assert.equal(h.sources.length,0);
});
test('local speech file metadata and reference transcript are saved without including the audio bytes',async()=>{
  const h=harness();await ready(h);h.element('stimulus-kind').value='file';await h.element('stimulus-kind').fire('change');h.element('speech-file').files=[{name:'known-speech.wav',size:100,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer}];await h.element('speech-file').fire('change');h.element('reference-transcript').value='A known test phrase.';await h.element('speaker-start').click();const s=h.context.TableRecorder.getCurrent();assert.equal(s.experiment.stimulus.duration_s,4);assert.match(s.experiment.stimulus.id,/^[a-f0-9]{64}$/);assert.equal(s.experiment.reference_transcript,'A known test phrase.');assert.equal(s.experiment.stimulus.buffer,undefined);h.context.TableRecorder.stop();
});
test('clearing speaker runs also removes the latest speaker recording',async()=>{
  const h=harness();await ready(h);await h.element('speaker-start').click();h.emit(120);h.context.TableRecorder.stop();await h.element('clear-runs').click();await new Promise(r=>setImmediate(r));assert.equal(h.context.TableRecorder.getLatest(),null);assert.equal(h.element('speaker-history').hidden,true);assert.equal(h.storage.get('latest'),undefined);assert.equal(h.storage.get('speaker-history').length,0);
});
