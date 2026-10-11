const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function harness(permission='granted'){
  let now=100,exported=null;const elements=new Map(),events={},docEvents={},intervals=[],frames=[];
  function element(id){if(!elements.has(id))elements.set(id,{id,hidden:false,disabled:false,checked:true,textContent:'',addEventListener(name,fn){this[name]=fn;},click(){return this.clickHandler?.();},scrollIntoView(){},getBoundingClientRect(){return {width:360,height:142};},getContext(){return new Proxy({},{get(){return ()=>{};},set(){return true;}});}});return elements.get(id);}
  const document={hidden:false,getElementById:element,querySelector:()=>element('instrument'),addEventListener:(n,fn)=>docEvents[n]=fn};
  const context={document,window:null,performance:{now:()=>now},navigator:{userAgent:'simulated iPhone'},DeviceMotionEvent:{requestPermission:async()=>permission},isSecureContext:true,devicePixelRatio:1,addEventListener:(n,fn)=>events[n]=fn,removeEventListener:n=>delete events[n],requestAnimationFrame:fn=>(frames.push(fn),frames.length),setTimeout:()=>1,clearTimeout(){},setInterval:fn=>intervals.push(fn),indexedDB:{open(){throw Error('storage unavailable in simulation');}},File,URL:{createObjectURL:file=>(exported=file,'blob:test'),revokeObjectURL(){}},console};context.window=context;
  vm.createContext(context);vm.runInContext(fs.readFileSync('dist/signal.js','utf8'),context);vm.runInContext(fs.readFileSync('dist/app.js','utf8'),context);
  const emit=(t,z=0)=>{now=t;events.devicemotion({acceleration:{x:0,y:0,z},accelerationIncludingGravity:{x:0,y:0,z:9.81+z},rotationRate:{alpha:0,beta:0,gamma:0},timeStamp:t,interval:20});while(frames.length)frames.shift()();};
  return {element,document,emit,intervals,docEvents,setTime:t=>now=t,exported:()=>exported};
}
test('full guided recording keeps every event and exports a real impulse after settling',async()=>{
  const h=harness();await h.element('connect').click();h.emit(100);h.element('record').click();
  for(let t=120;t<=45100;t+=20){h.emit(t,t===20100?.7:0);h.intervals.forEach(fn=>fn());}
  assert.equal(h.element('stop').hidden,true);assert.equal(h.element('saved-panel').hidden,false);assert.match(h.element('saved-summary').textContent,/2,250 readings/);
  await h.element('export-json').click();const session=JSON.parse(await h.exported().text());
  assert.equal(session.samples.length,2250);assert.equal(session.stop_reason,'Guided test complete.');assert.equal(session.samples.find(s=>s.elapsed_ms===20000).acceleration.z,.7);assert.equal(session.peak_after_settling_m_s2,.7);assert.equal(session.statistics.rate_hz,50);assert.equal(session.statistics.gaps.length,0);assert.equal(session.samples.find(s=>s.elapsed_ms===35000).phase,'slow-press');
});
test('hiding the page stops a recording and retains the delivered samples',async()=>{
  const h=harness();await h.element('connect').click();h.emit(100);h.element('record').click();h.emit(120);h.emit(140);
  h.document.hidden=true;h.docEvents.visibilitychange();await h.element('export-json').click();const session=JSON.parse(await h.exported().text());assert.equal(session.samples.length,2);assert.match(session.stop_reason,/hidden/);
});
test('denied permission cannot start recording',async()=>{
  const h=harness('denied');h.element('record').disabled=true;await h.element('connect').click();assert.match(h.element('message').textContent,/denied/);assert.equal(h.element('record').disabled,true);assert.equal(h.element('connect').disabled,false);
});
test('sensor silence ends recording rather than falsely recording continuously',async()=>{
  const h=harness();await h.element('connect').click();h.emit(100);h.element('record').click();h.emit(120);h.setTime(4000);h.intervals.forEach(fn=>fn());await h.element('export-json').click();const session=JSON.parse(await h.exported().text());assert.equal(session.samples.length,1);assert.match(session.stop_reason,/paused/);assert.equal(h.element('record').disabled,true);
});
