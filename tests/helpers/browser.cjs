const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
function harness(){
  let now=100,exported=null,resumeGate=null;const elements=new Map(),events={},docEvents={},intervals=[],frames=[],storage=new Map(),sources=[],contexts=[];
  const defaults={'stimulus-kind':'tones','speaker-placement':'same-table','speaker-distance':'20','speaker-volume':'50%','reference-transcript':''};
  class Element{
    constructor(id){this.id=id;this.value=defaults[id]??'';this.hidden=false;this.disabled=false;this.checked=true;this.textContent='';this.children=[];this.handlers={};}
    addEventListener(n,fn){(this.handlers[n]??=[]).push(fn);}
    async fire(n){for(const fn of this.handlers[n]??[])await fn({target:this});}
    click(){return this.fire('click');}
    setAttribute(n,v){this[n]=v;}appendChild(v){this.children.push(v);return v;}replaceChildren(...v){this.children=v;}
    scrollIntoView(){}getBoundingClientRect(){return {width:360,height:142};}getContext(){return new Proxy({},{get(){return ()=>{};},set(){return true;}});}
  }
  function element(id){if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);}
  const document={hidden:false,getElementById:element,querySelector:()=>element('instrument'),createElement:tag=>new Element(tag),addEventListener:(n,fn)=>(docEvents[n]??=[]).push(fn)};
  const db={createObjectStore(){},transaction(){const tx={};tx.objectStore=()=>({get(key){const request={};queueMicrotask(()=>{request.result=storage.get(key);request.onsuccess?.();});return request;},put(value,key){storage.set(key,structuredClone(value));queueMicrotask(()=>tx.oncomplete?.());},delete(key){storage.delete(key);queueMicrotask(()=>tx.oncomplete?.());}});return tx;}};
  class AudioContext{
    constructor(){this.state='suspended';this.sampleRate=8000;this.baseLatency=.01;contexts.push(this);}
    get currentTime(){return now/1000;}
    resume(){this.state='running';return resumeGate??Promise.resolve();}
    createBuffer(ch,length,rate){const data=Array.from({length:ch},()=>new Float32Array(length));return {numberOfChannels:ch,length,sampleRate:rate,duration:length/rate,getChannelData:c=>data[c]};}
    createBufferSource(){const node={connect(){},disconnect(){},start(...args){this.started=args;},stop(){this.stopped=true;}};sources.push(node);return node;}
    decodeAudioData(){const b=this.createBuffer(1,32000,8000);const data=b.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=.1*Math.sin(i/12)*(i%8000<4000?1:0);return Promise.resolve(b);}
  }
  const context={document,window:null,performance:{now:()=>now},navigator:{userAgent:'synthetic browser test'},DeviceMotionEvent:{requestPermission:async()=>'granted'},AudioContext,crypto:webcrypto,isSecureContext:true,devicePixelRatio:1,addEventListener:(n,fn)=>(events[n]??=[]).push(fn),removeEventListener:(n,fn)=>events[n]=(events[n]??[]).filter(f=>f!==fn),requestAnimationFrame:fn=>(frames.push(fn),frames.length),setTimeout:()=>1,clearTimeout(){},setInterval:fn=>intervals.push(fn),indexedDB:{open(){const request={result:db};queueMicrotask(()=>request.onsuccess?.());return request;}},File,URL:{createObjectURL:file=>(exported=file,'blob:test'),revokeObjectURL(){}},console};context.window=context;
  vm.createContext(context);for(const file of ['signal.js','experiment.js','app.js','speaker-ui.js'])vm.runInContext(fs.readFileSync('dist/'+file,'utf8'),context);
  function emit(t,z=0){now=t;for(const fn of events.devicemotion??[])fn({acceleration:{x:0,y:0,z},accelerationIncludingGravity:{x:0,y:0,z:9.81+z},rotationRate:{alpha:0,beta:0,gamma:0},timeStamp:t,interval:20});while(frames.length)frames.shift()();}
  function tick(t){now=t;intervals.forEach(fn=>fn());}
  async function hidden(){document.hidden=true;for(const fn of docEvents.visibilitychange??[])fn();await Promise.resolve();}
  return {context,element,emit,tick,hidden,sources,contexts,storage,exported:()=>exported,setResumeGate:p=>resumeGate=p};
}
module.exports={harness};
