(() => {
  'use strict';
  const $=id=>document.getElementById(id), S=window.TableSignal;
  const ui=Object.fromEntries(['connect','record','stop','status','clock','amplitude','rate','count','peak','message','guided','graph','empty-graph','scale','step-number','step-title','step-copy','step-time','guide-live','guide-title','guide-copy','guide-time','saved-panel','saved-summary','saved-note','export-json','export-csv','export-message','download-fallback','discard'].map(id=>[id,$(id)]));
  let enabled=false,connecting=false,lastArrival=0,latest=null,live=[],current=null,saved=null,baseline=null,baselineMethod=null,calibration=[],peak=0,wakeLock=null,startTimer=null,downloadURL=null,db=null,chartFrame=0;
  const MAX_MS=600000,MAX_SAMPLES=50000;
  function status(text,kind=''){ui.status.textContent='● '+text;ui.status.className='status '+kind;}
  function message(text){ui.message.textContent=text;}
  function clock(ms){const s=ms/1000;return `${String(Math.floor(s/60)).padStart(2,'0')}:${(s%60).toFixed(1).padStart(4,'0')}`;}
  function resetBaseline(){baseline=null;baselineMethod=null;calibration=[];peak=0;}
  function zero(v){return {x:0,y:0,z:0};}
  function movement(sample,calibrating){
    const {v,method}=S.source(sample);
    if(baselineMethod!==method){baseline={...v};baselineMethod=method;calibration=[];}
    if(calibrating){calibration.push(v);if(calibration.length>2000)calibration.shift();const total=calibration.reduce((b,p)=>({x:b.x+p.x,y:b.y+p.y,z:b.z+p.z}),zero());baseline={x:total.x/calibration.length,y:total.y/calibration.length,z:total.z/calibration.length};}
    sample.graph_method=method;sample.movement_m_s2=S.magnitude(v,baseline);return sample.movement_m_s2;
  }
  function onMotion(e){
    const now=performance.now(),elapsed=current?now-current.start_monotonic_ms:0;
    const sample=S.normalize(e,elapsed,now);if(!sample)return;
    clearTimeout(startTimer);lastArrival=now;latest=sample;
    if(!enabled){enabled=true;connecting=false;ui.connect.hidden=true;ui.record.disabled=false;status('LIVE SENSOR','live');message('Motion is connected. Set the phone down, then start recording.');}
    const value=movement(sample,current?elapsed<5000:!baseline);
    if(current){sample.phase=S.phase(elapsed/1000,current.guided);current.samples.push(sample);if(elapsed>=5000)peak=Math.max(peak,value);}
    live.push(sample);while(live.length&&live[0].received_at_ms<now-8000)live.shift();
    if(current&&(elapsed>=MAX_MS||current.samples.length>=MAX_SAMPLES))stop('Recording limit reached.');
    if(!chartFrame)chartFrame=requestAnimationFrame(()=>{chartFrame=0;render();});
  }
  async function connect(){
    if(connecting)return;connecting=true;ui.connect.disabled=true;
    try{
      if(!window.isSecureContext)throw Error('Motion access needs HTTPS. Open the hosted link in Safari.');
      if(typeof DeviceMotionEvent==='undefined')throw Error('Motion sensors are unavailable here. Open this link in Safari on your iPhone.');
      // Permission is requested directly inside the user gesture, before any other async work.
      if(typeof DeviceMotionEvent.requestPermission==='function'){
        const result=await DeviceMotionEvent.requestPermission();
        if(result!=='granted')throw Error('Motion permission was denied. Reload this page in Safari and allow motion when prompted. If it stays blocked, check this website’s Safari permissions.');
      }
      window.removeEventListener('devicemotion',onMotion);window.addEventListener('devicemotion',onMotion);
      status('WAITING FOR SENSOR');message('Waiting for motion readings…');
      startTimer=setTimeout(()=>{if(!enabled){connecting=false;ui.connect.disabled=false;status('NO SENSOR DATA','error');message('No usable readings arrived. Use Safari on your iPhone, keep this page visible, and retry Enable motion. A desktop usually has no motion sensor.');}},6000);
    }catch(error){connecting=false;ui.connect.disabled=false;status('PERMISSION NEEDED','error');message(error.message);}
  }
  async function requestWake(){try{if(navigator.wakeLock&&!document.hidden)wakeLock=await navigator.wakeLock.request('screen');}catch{}if(!current&&wakeLock){wakeLock.release().catch(()=>{});wakeLock=null;}}
  function start(){
    if(!enabled||performance.now()-lastArrival>2000){message('No fresh sensor readings. Enable motion again before recording.');return;}
    if(current)return;resetBaseline();live=[];
    current={schema_version:1,started_at:new Date().toISOString(),start_monotonic_ms:performance.now(),guided:ui.guided.checked,user_agent:navigator.userAgent,units:{acceleration:'m/s²',rotation_rate:'degrees/second',time:'milliseconds'},samples:[]};
    ui.record.hidden=true;ui.stop.hidden=false;ui.guided.disabled=true;ui.count.textContent='0';ui.peak.textContent='—';ui['saved-panel'].hidden=true;
    ui['guide-live'].hidden=false;status('RECORDING','recording');message('All delivered readings are being saved. Leave the phone still for 5 seconds.');requestWake();render();document.querySelector('.instrument').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function stop(reason='Stopped by you.'){
    if(!current)return;
    const session=current;current=null;
    session.duration_ms=performance.now()-session.start_monotonic_ms;session.ended_at=new Date().toISOString();session.stop_reason=reason;session.baseline={...baseline};session.baseline_method=baselineMethod;session.peak_after_settling_m_s2=peak;session.statistics=S.statistics(session.samples);
    session.notes=['Browser-delivered motion events only; not a complete measurement of every physical vibration.','Graph magnitude is relative to a baseline estimated during the first 5 seconds. Tilt also changes the signal.','Every usable delivered event is saved without a movement threshold. Missing sensor components are null.','Peak excludes settling. Graph baseline and peak are not calibrated laboratory measurements.'];
    saved=session;ui['guide-live'].hidden=true;ui.stop.hidden=true;ui.record.hidden=false;ui.record.textContent='Record again ↗';ui.guided.disabled=false;status(enabled?'LIVE SENSOR':'SENSOR PAUSED',enabled?'live':'');message(reason+' Your recording is ready to export.');
    ui.clock.textContent=clock(session.duration_ms);ui['step-title'].textContent='Recording finished.';ui['step-copy'].textContent='Export the readings below, or run another test.';ui['step-time'].textContent='';
    if(wakeLock){wakeLock.release().catch(()=>{});wakeLock=null;}showSaved();persist(session);
  }
  function showSaved(){
    if(!saved)return;ui['saved-panel'].hidden=false;const stats=saved.statistics;
    ui['saved-summary'].textContent=`${saved.samples.length.toLocaleString()} readings · ${(saved.duration_ms/1000).toFixed(1)} seconds · ${stats.rate_hz?.toFixed(1)??'—'} Hz average`;
    ui['saved-note'].textContent=`${saved.stop_reason} ${stats.gaps.length?`${stats.gaps.length} delivery gap(s) detected; see JSON for timing.`:'No large delivery gaps detected.'} Raw readings are included in both exports.`;
    ui['export-message'].textContent='';ui['download-fallback'].hidden=true;
  }
  function render(){
    if(latest)ui.amplitude.textContent=latest.movement_m_s2.toFixed(3);
    const stats=S.statistics(live);ui.rate.textContent=stats.rate_hz?stats.rate_hz.toFixed(1)+' Hz':'— Hz';
    if(current){const elapsed=performance.now()-current.start_monotonic_ms;ui.clock.textContent=clock(elapsed);ui.count.textContent=current.samples.length.toLocaleString();ui.peak.textContent=elapsed<5000?'—':peak.toFixed(3);
      if(current.guided){const idx=S.phases.findIndex(p=>elapsed/1000>=p.start&&elapsed/1000<p.end);if(idx>=0){const p=S.phases[idx];ui['step-number'].textContent=String(idx+1).padStart(2,'0');ui['step-title'].textContent=p.title;ui['step-copy'].textContent=p.copy;ui['step-time'].textContent=Math.ceil(p.end-elapsed/1000)+'s';}}
      else{ui['step-number'].textContent='↟';ui['step-title'].textContent=elapsed<5000?'Hands off. Let it settle.':'Free recording.';ui['step-copy'].textContent=elapsed<5000?'The first 5 seconds set the graph baseline.':'Try different taps and distances. Stop when you’re done.';ui['step-time'].textContent='';}
      ui['guide-title'].textContent=ui['step-title'].textContent;ui['guide-copy'].textContent=ui['step-copy'].textContent;ui['guide-time'].textContent=ui['step-time'].textContent;
      if(elapsed>=5000)message('Recording every delivered reading. Keep Safari visible and the phone in place.');
    }draw();
  }
  function draw(){
    const canvas=ui.graph,rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
    if(canvas.width!==Math.round(rect.width*dpr)||canvas.height!==Math.round(rect.height*dpr)){canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);}
    const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);const w=rect.width,h=rect.height;ctx.clearRect(0,0,w,h);
    ctx.strokeStyle='#2c382e';ctx.lineWidth=1;for(let i=0;i<=4;i++){ctx.beginPath();ctx.moveTo(0,10+i*(h-20)/4);ctx.lineTo(w,10+i*(h-20)/4);ctx.stroke();}for(let i=0;i<=8;i++){ctx.beginPath();ctx.moveTo(i*w/8,10);ctx.lineTo(i*w/8,h-10);ctx.stroke();}
    ui['empty-graph'].hidden=live.length>0;if(!live.length)return;
    const ceiling=Math.max(.02,...live.map(s=>s.movement_m_s2))*1.15;ui.scale.textContent=ceiling.toFixed(3)+' m/s²';
    const end=performance.now(),x=s=>w*(1-(end-s.received_at_ms)/8000),y=s=>h-10-(s.movement_m_s2/ceiling)*(h-20);
    ctx.strokeStyle='#d0f56c';ctx.lineWidth=1.7;ctx.beginPath();live.forEach((s,i)=>{if(!i||s.received_at_ms-live[i-1].received_at_ms>150)ctx.moveTo(x(s),y(s));else ctx.lineTo(x(s),y(s));});ctx.stroke();
    const last=live.at(-1);ctx.fillStyle='#d0f56c';ctx.beginPath();ctx.arc(x(last),y(last),3,0,Math.PI*2);ctx.fill();
  }
  async function openDB(){return new Promise((resolve,reject)=>{const request=indexedDB.open('table-signal',1);request.onupgradeneeded=()=>request.result.createObjectStore('sessions');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
  async function persist(session){try{db=db||await openDB();if(saved!==session)return;await new Promise((resolve,reject)=>{const tx=db.transaction('sessions','readwrite');tx.objectStore('sessions').put(session,'latest');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});if(saved===session)ui['saved-note'].textContent+=' Saved in this browser.';}catch{if(saved===session)ui['saved-note'].textContent+=' Browser storage was unavailable. Export now to keep this recording.';}}
  async function restore(){try{db=await openDB();const session=await new Promise((resolve,reject)=>{const request=db.transaction('sessions').objectStore('sessions').get('latest');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});if(session&&!current&&!saved){saved=session;showSaved();ui['saved-note'].textContent+=' Restored from this browser.';}}catch{}}
  function download(file){if(downloadURL)URL.revokeObjectURL(downloadURL);downloadURL=URL.createObjectURL(file);const link=ui['download-fallback'];link.href=downloadURL;link.download=file.name;link.textContent='Download '+file.name;link.hidden=false;link.click();ui['export-message'].textContent='If a preview opens, use Safari’s Share button → Save to Files. The download link above is also available.';}
  async function exportFile(format){
    if(!saved)return;const name='table-signal-'+saved.started_at.replace(/[:.]/g,'-')+'.'+format;
    const content=format==='json'?JSON.stringify(saved,null,2):S.csv(saved);const file=new File([content],name,{type:format==='json'?'application/json':'text/csv'});
    if(format==='json'&&navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:'Table Signal recording'});ui['export-message'].textContent='Share sheet completed.';return;}catch(e){if(e.name==='AbortError'){ui['export-message'].textContent='Sharing cancelled. Your recording is still here.';return;}}}download(file);
  }
  ui.connect.addEventListener('click',connect);ui.record.addEventListener('click',start);ui.stop.addEventListener('click',()=>stop());ui['export-json'].addEventListener('click',()=>exportFile('json'));ui['export-csv'].addEventListener('click',()=>exportFile('csv'));
  ui.discard.addEventListener('click',async()=>{saved=null;ui['saved-panel'].hidden=true;if(db){try{const tx=db.transaction('sessions','readwrite');tx.objectStore('sessions').delete('latest');}catch{}}if(downloadURL)URL.revokeObjectURL(downloadURL);downloadURL=null;});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop('Stopped because Safari was hidden or the screen was locked.');});
  window.addEventListener('pagehide',()=>stop('Stopped because the page was left.'));
  window.addEventListener('resize',draw);
  setInterval(()=>{
    const now=performance.now();if(current&&now-lastArrival>3000)stop('Stopped because motion readings paused for more than 3 seconds.');
    if(enabled&&now-lastArrival>3000){enabled=false;ui.record.disabled=true;ui.connect.hidden=false;ui.connect.disabled=false;connecting=false;status('SENSOR PAUSED','error');message('Motion readings paused. Your finished recording is preserved. Tap Enable motion to reconnect.');}
    if(current&&current.guided&&now-current.start_monotonic_ms>=45000)stop('Guided test complete.');
    if(current&&now-current.start_monotonic_ms>=MAX_MS)stop('10-minute recording limit reached.');
    if(current)render();
  },200);
  restore();draw();
})();
