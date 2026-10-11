(() => {
  'use strict';
  const $=id=>document.getElementById(id), E=window.TableExperiment, R=window.TableRecorder;
  let mode='speaker',context=null,clip=null,loaded=false,loading=false,arming=false,node=null,audioOperation=0,history=[],historyDB=null,revision=0,persistQueue=Promise.resolve();
  const fields=['stimulus-kind','speaker-placement','speaker-distance','speaker-volume','speech-file','reference-transcript','mode-speaker','mode-taps','check-output','clear-runs','export-bundle'];
  function audioContext(){if(!context){const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw Error('Web Audio is unavailable. Open this page in Safari.');context=new Audio();}return context;}
  function tones(){const ctx=audioContext(),buffer=ctx.createBuffer(1,Math.round(ctx.sampleRate*20),ctx.sampleRate),data=buffer.getChannelData(0);const frequencies=[20,40,80,160,320];
    for(let i=0;i<data.length;i++){const seconds=i/ctx.sampleRate,slot=Math.floor(seconds/4),local=seconds-slot*4;if(local<2){const fade=Math.min(1,local/.025,(2-local)/.025);data[i]=.15*Math.max(0,fade)*Math.sin(2*Math.PI*frequencies[slot]*local);}}return buffer;
  }
  function sync(){
    const active=!!R.getCurrent();$('speaker-setup').hidden=mode!=='speaker';$('tap-panel').hidden=mode!=='taps';$('record').hidden=mode!=='taps'||active;$('speaker-start').hidden=mode!=='speaker'||active;
    $('speaker-start').disabled=!R.isReady()||loading||arming||($('stimulus-kind').value==='file'&&!loaded);
    fields.forEach(id=>$(id).disabled=active||arming||loading);$('mode-speaker').setAttribute('aria-pressed',String(mode==='speaker'));$('mode-taps').setAttribute('aria-pressed',String(mode==='taps'));
    $('speech-file-panel').hidden=$('stimulus-kind').value!=='file';
  }
  function cancelPlayback(){audioOperation++;if(node){node.onended=null;try{node.stop();}catch{}try{node.disconnect();}catch{}node=null;}$('stop-preview').hidden=true;if($('speaker-message').textContent.startsWith('Preview playing.'))$('speaker-message').textContent='Preview stopped. Confirm it came from the intended speaker before recording.';}
  async function loadFile(){
    const file=$('speech-file').files?.[0];loaded=false;clip=null;if(!file){sync();return;}loading=true;sync();$('stimulus-info').textContent='Reading your audio locally…';
    try{
      if(file.size>20*1024*1024)throw Error('Choose an audio file smaller than 20 MB.');
      const bytes=await file.arrayBuffer();const digest=await crypto.subtle.digest('SHA-256',bytes);const id=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
      const buffer=await audioContext().decodeAudioData(bytes.slice(0));
      if(buffer.duration<3||buffer.duration>90)throw Error('Choose a speech clip between 3 and 90 seconds long.');
      clip={buffer,id,name:file.name,kind:'speech',duration_s:buffer.duration,sample_rate_hz:buffer.sampleRate,envelope:E.envelope(buffer)};loaded=true;
      $('stimulus-info').textContent=`${file.name} · ${buffer.duration.toFixed(1)} seconds. The file stays in this browser. Reloading requires selecting it again.`;
    }catch(error){$('stimulus-info').textContent='Could not load this clip. '+error.message;}finally{loading=false;sync();}
  }
  function selected(){if($('stimulus-kind').value==='file'){if(!loaded||!clip)throw Error('Choose a speech recording first.');return clip;}const buffer=tones();return {buffer,id:'calibration-tones-v1',name:'Calibration tones',kind:'tones',duration_s:20,sample_rate_hz:buffer.sampleRate,envelope:E.envelope(buffer)};}
  async function preview(){
    if(R.getCurrent()||loading)return;
    try{cancelPlayback();const token=audioOperation,ctx=audioContext();const resume=ctx.resume();const sound=selected();await resume;if(token!==audioOperation||R.getCurrent()||document.hidden)return;
      if(ctx.state!=='running')throw Error('Audio did not start. Check Safari and try again.');
      node=ctx.createBufferSource();node.buffer=sound.buffer;node.connect(ctx.destination);node.start(0,sound.kind==='tones'?12:0,Math.min(sound.kind==='tones'?2:4,sound.duration_s));
      node.onended=cancelPlayback;$('stop-preview').hidden=false;$('speaker-message').textContent='Preview playing. Confirm the intended speaker is producing the sound before recording.';
    }catch(error){cancelPlayback();$('speaker-message').textContent=error.message;}
  }
  async function start(){
    if(arming||R.getCurrent())return;if(!R.isReady()){$('speaker-message').textContent='Enable motion and wait for fresh sensor readings first.';return;}
    arming=true;sync();
    try{
      cancelPlayback();const token=audioOperation,ctx=audioContext();const resumed=ctx.resume();const sound=selected();await resumed;if(token!==audioOperation||document.hidden)throw Error('The page was hidden before playback could start. Try again with Safari visible.');
      if(ctx.state!=='running')throw Error('Audio is paused. Try Start speaker test again.');
      const distance=Number($('speaker-distance').value);if(!$('speaker-distance').value.trim()||!Number.isFinite(distance)||distance<0||distance>500)throw Error('Enter a distance between 0 and 500 cm.');
      const experiment={protocol:'quiet-playback-quiet-v1',placement:$('speaker-placement').value,distance_cm:distance,volume_note:$('speaker-volume').value.trim(),reference_transcript:$('reference-transcript').value.trim(),output_route:'User selected; not verified by Safari',stimulus:{id:sound.id,name:sound.name,kind:sound.kind,duration_s:sound.duration_s,sample_rate_hz:sound.sample_rate_hz,envelope:sound.envelope},playback_start_ms:10000};
      const session=R.start({experiment});if(!session)throw Error('Sensor readings paused. Re-enable motion and try again.');
      node=ctx.createBufferSource();node.buffer=sound.buffer;node.connect(ctx.destination);
      const scheduled=ctx.currentTime+10;experiment.playback_start_ms=performance.now()-session.start_monotonic_ms+10000;
      experiment.audio_clock_scheduled_start_s=scheduled;experiment.audio_context_base_latency_s=ctx.baseLatency??null;experiment.audio_context_output_latency_s=ctx.outputLatency??null;
      experiment.timing_note='Scheduled browser playback. Bluetooth/output arrival delay is not directly measured. Envelope analysis searches -1000 to +1500 ms.';
      node.start(scheduled);node.onended=()=>{try{node?.disconnect();}catch{}node=null;};
      $('speaker-message').textContent='Recording started. Playback will begin automatically after 10 seconds of quiet.';
    }catch(error){cancelPlayback();if(R.getCurrent()?.experiment)R.stop('Audio playback failed: '+error.message);$('speaker-message').textContent=error.message;}finally{arming=false;sync();}
  }
  function checkPlayback(){if(R.getCurrent()?.experiment&&context&&context.state!=='running')R.stop('Stopped because audio playback was interrupted.');}
  function number(v,unit=''){return typeof v==='number'&&Number.isFinite(v)?v.toFixed(1)+(unit?' '+unit:''):'—';}
  function strongest(session){return session.analysis?.channels.find(c=>c.key===session.analysis.strongest_channel);}
  function drawSpectrum(analysis){
    const canvas=$('spectrum'),rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;canvas.width=Math.max(1,Math.round(rect.width*dpr));canvas.height=Math.max(1,Math.round(rect.height*dpr));const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);const w=rect.width,h=rect.height;ctx.clearRect(0,0,w,h);
    const spectrum=analysis.spectrum;if(!spectrum){$('spectrum-caption').textContent='No sufficiently long, uninterrupted playback segment for a spectrum.';return;}
    ctx.strokeStyle='#c3cbb7';ctx.lineWidth=1;for(let i=0;i<=4;i++){ctx.beginPath();ctx.moveTo(0,i*(h-22)/4);ctx.lineTo(w,i*(h-22)/4);ctx.stroke();}
    ctx.fillStyle='#718352';const width=w/spectrum.bins.length;spectrum.bins.forEach((b,i)=>ctx.fillRect(i*width,h-22-b.relative_power*(h-28),Math.max(1,width-1),b.relative_power*(h-28)));
    ctx.fillStyle='#677063';ctx.font='9px monospace';ctx.fillText('0 Hz',0,h-3);ctx.fillText(spectrum.nyquist_hz.toFixed(1)+' Hz',Math.max(0,w-60),h-3);
    const c=analysis.channels.find(c=>c.key===analysis.strongest_channel);$('spectrum-caption').textContent=`Relative sensor frequency power · ${c?.label??''}. ${spectrum.windows} averaged windows. Peaks can be aliases of higher speaker frequencies.`;
  }
  function cellRow(values){const tr=document.createElement('tr');values.forEach(value=>{const td=document.createElement('td');td.textContent=value;tr.appendChild(td);});return tr;}
  function showReport(session){
    const a=session?.analysis;$('speaker-report').hidden=!a;if(!a)return;const best=strongest(session);
    $('report-title').textContent=a.complete?'Speaker signal report':'Partial speaker recording';
    $('report-ratio').textContent=number(best?.ratio_db,'dB');$('report-match').textContent=a.envelope_match?a.envelope_match.coefficient.toFixed(2):'—';$('report-band').textContent=number(a.estimated_unaliased_band_hz,'Hz');
    let verdict=!a.complete?'Complete the full sequence before comparing runs.':best?.ratio_db>6?'A sensor channel changed during playback. Repeat the test to check whether it follows the sound.':'No clear increase above quiet was measured. Try the control run and repeat.';
    if(a.complete&&best&&best.ratio_db===null)verdict='Quiet is below the observed resolution; inspect the raw readings and repeat.';
    $('report-verdict').textContent=verdict+(best?' Channel: '+best.label+'.':'')+' Spoken words have not been recovered.';
    $('report-warnings').textContent=a.warnings.join(' ')+(a.envelope_match?` Best envelope match at ${a.envelope_match.lag_ms} ms delay, over ${a.envelope_match.bins} bins.`:'');
    $('channel-rows').replaceChildren(...a.channels.map(c=>cellRow([c.label+' ('+c.unit+')',c.quiet_rms.toPrecision(3),c.playback_rms.toPrecision(3),number(c.ratio_db,'dB')])));drawSpectrum(a);
  }
  function label(placement){return {'same-table':'Same table','separate-surface':'Separate surface','phone-speaker':'Phone speaker'}[placement]??placement;}
  function showHistory(){
    $('speaker-history').hidden=!history.length;
    const pair=E.compare(history);$('comparison-note').textContent=pair?'Matched same-table and separate-surface runs found for the same sound, distance, and volume note. Export the bundle for analysis.':'Run the same sound on the same table and on a separate surface. Keep distance and volume note identical to make a pair.';
    $('history-rows').replaceChildren(...history.map(s=>{const tr=cellRow([label(s.experiment.placement),s.experiment.stimulus.name,number(s.statistics.rate_hz,'Hz'),s.analysis.complete?number(strongest(s)?.ratio_db,'dB'):'Partial']);const button=document.createElement('button');button.type='button';button.className='text-button';button.textContent='View';button.addEventListener('click',()=>{if(R.getCurrent())return;R.showSession(s);$('saved-panel').scrollIntoView({behavior:'smooth',block:'start'});});tr.children[0].appendChild(button);return tr;}));
  }
  function openHistoryDB(){return new Promise((resolve,reject)=>{const request=indexedDB.open('table-signal',1);request.onupgradeneeded=()=>request.result.createObjectStore('sessions');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
  function persistHistory(){const snapshot=[...history];persistQueue=persistQueue.then(async()=>{try{historyDB=historyDB||await openHistoryDB();await new Promise((resolve,reject)=>{const tx=historyDB.transaction('sessions','readwrite');tx.objectStore('sessions').put(snapshot,'speaker-history');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}catch{$('comparison-note').textContent+=' Browser storage is unavailable. Export all runs before leaving.';}});}
  async function restoreHistory(){const initialRevision=revision;try{historyDB=await openHistoryDB();const stored=await new Promise((resolve,reject)=>{const request=historyDB.transaction('sessions').objectStore('sessions').get('speaker-history');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});if(initialRevision===revision&&Array.isArray(stored)){history=stored.filter(s=>s.experiment&&s.analysis).slice(0,8);showHistory();}}catch{}}
  function stopped(session){if(!session.experiment)return;revision++;history=[session,...history.filter(s=>s.started_at!==session.started_at)].slice(0,8);showHistory();persistHistory();}
  function discard(session){if(!session?.experiment)return;revision++;history=history.filter(s=>s.started_at!==session.started_at);showHistory();persistHistory();}
  async function exportBundle(){if(!history.length)return;const file=new File([JSON.stringify({schema_version:1,kind:'speaker-experiment-bundle',exported_at:new Date().toISOString(),runs:history},null,2)],'micwithoutmic-speaker-runs.json',{type:'application/json'});
    if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:'Speaker experiment runs'});return;}catch(e){if(e.name==='AbortError')return;}}R.downloadFile(file);
  }
  $('stimulus-kind').addEventListener('change',()=>{cancelPlayback();if($('stimulus-kind').value==='tones')$('stimulus-info').textContent='Five tones: 20, 40, 80, 160, and 320 Hz, with pauses.';else $('stimulus-info').textContent=loaded?`${clip.name} · ${clip.duration_s.toFixed(1)} seconds.`:'Choose a known speech clip to compare with its vibration trace.';sync();});
  $('speech-file').addEventListener('change',loadFile);$('check-output').addEventListener('click',preview);$('stop-preview').addEventListener('click',cancelPlayback);$('speaker-start').addEventListener('click',start);
  $('mode-speaker').addEventListener('click',()=>{if(R.getCurrent())return;cancelPlayback();mode='speaker';sync();});$('mode-taps').addEventListener('click',()=>{if(R.getCurrent())return;cancelPlayback();mode='taps';sync();});
  $('export-bundle').addEventListener('click',exportBundle);$('clear-runs').addEventListener('click',()=>{if(R.getCurrent())return;revision++;history=[];if(R.getLatest()?.experiment)R.clearLatest();showHistory();persistHistory();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelPlayback();});window.addEventListener('pagehide',cancelPlayback);window.addEventListener('resize',()=>{if(R.getLatest()?.analysis)drawSpectrum(R.getLatest().analysis);});
  window.SpeakerUI={sync,cancelPlayback,checkPlayback,stopped,discard,showReport};sync();showReport(R.getLatest());restoreHistory();
})();
