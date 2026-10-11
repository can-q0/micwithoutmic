const {test}=require('node:test');
const assert=require('node:assert/strict');
const E=require('../dist/experiment.js');
const S=require('../dist/signal.js');
function recording({partial=false,zero=false,gap=false}={}){
  const samples=[];for(let ms=0;ms<=40000;ms+=20){if(gap&&ms>=18000&&ms<18500)continue;const time=ms/1000,slot=Math.floor((ms-10000)/4000),on=ms>=10000&&ms<30000&&(ms-10000)%4000<2000;
    const z=zero?0:.001*Math.sin(2*Math.PI*7*time)+(on?.03*Math.sin(2*Math.PI*10*time):0);
    const s=S.normalize({acceleration:{x:0,y:0,z},accelerationIncludingGravity:{x:0,y:0,z:9.81+z},rotationRate:{alpha:0,beta:0,gamma:0},interval:20,timeStamp:ms},ms,ms);samples.push(s);
  }
  const experiment={placement:'same-table',distance_cm:20,volume_note:'50%',stimulus:{id:'fixture',kind:'tones',name:'fixture',duration_s:20,envelope:{bin_ms:200,rms:Array.from({length:100},(_,i)=>i%20<10?.1:0)}}};
  const out={experiment,duration_ms:partial?20000:40000,stop_reason:partial?'Stopped by you.':'Speaker test complete.',samples:partial?samples.filter(s=>s.elapsed_ms<=20000):samples};out.statistics=S.statistics(out.samples);return out;
}
test('a repeatable synthetic vibration follows playback timing and reveals a sensor frequency',()=>{
  const a=E.analyze(recording());assert.equal(a.complete,true);assert.equal(a.median_delivery_rate_hz,50);assert.equal(a.estimated_unaliased_band_hz,25);
  assert.ok(a.channels.find(c=>c.key==='acceleration.z').ratio_db>20);assert.ok(a.envelope_match.coefficient>.95);assert.equal(a.envelope_match.lag_ms,0);
  const peak=a.spectrum.bins.reduce((a,b)=>b.relative_power>a.relative_power?b:a);assert.ok(Math.abs(peak.hz-10)<.3);assert.match(a.interpretation,/do not establish/);
});
test('zero variation produces no invented correlation or signal-to-noise ratio',()=>{
  const a=E.analyze(recording({zero:true}));assert.equal(a.strongest_channel,null);assert.equal(a.envelope_match,null);assert.ok(a.channels.every(c=>c.ratio_db===null));
});
test('partial and interrupted runs cannot qualify as complete comparison runs',()=>{
  assert.equal(E.analyze(recording({partial:true})).complete,false);const r=recording();r.stop_reason='Stopped because audio playback was interrupted.';assert.equal(E.analyze(r).complete,false);
});
test('a delivery gap is reported and never bridged in the spectrum',()=>{
  const a=E.analyze(recording({gap:true}));assert.ok(a.warnings.some(w=>w.includes('gaps')));assert.ok(a.spectrum.segment_duration_ms<20000);
});
test('surface comparison requires matching stimulus, distance, and volume note',()=>{
  const same=recording();same.analysis=E.analyze(same);const different=structuredClone(same);different.experiment.placement='separate-surface';assert.ok(E.compare([same,different]));different.experiment.stimulus.id='another-file';assert.equal(E.compare([same,different]),null);different.experiment.stimulus.id='fixture';different.experiment.distance_cm=50;assert.equal(E.compare([same,different]),null);
});
test('audio reference envelopes preserve silence versus an active passage',()=>{
  const data=new Float32Array(1000);for(let i=400;i<800;i++)data[i]=.5;const ref=E.envelope({sampleRate:1000,length:1000,numberOfChannels:1,getChannelData:()=>data});assert.deepEqual(ref.rms,[0,0,.5,.5,0]);
});
