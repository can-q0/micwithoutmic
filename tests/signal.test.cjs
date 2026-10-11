const {test}=require('node:test');
const assert=require('node:assert/strict');
const S=require('../dist/signal.js');
test('preserves missing channels and accepts a gravity-only device',()=>{
  const sample=S.normalize({acceleration:null,accelerationIncludingGravity:{x:0,y:0,z:9.81},rotationRate:{alpha:null,beta:1,gamma:0},interval:16.7,timeStamp:22},12,200);
  assert.deepEqual(sample.acceleration,{x:null,y:null,z:null});assert.equal(sample.rotation_rate.alpha,null);assert.equal(S.source(sample).method,'gravity-included-baseline');
  assert.equal(S.normalize({acceleration:{x:NaN,y:0,z:0}},0,0),null);
});
test('phase boundaries label settling, quiet, taps, and press without overlap',()=>{
  assert.equal(S.phase(4.999,true),'settle');assert.equal(S.phase(5,true),'still');assert.equal(S.phase(15,true),'light-taps');assert.equal(S.phase(25,true),'firm-taps');assert.equal(S.phase(35,true),'slow-press');assert.equal(S.phase(45,true),'complete');assert.equal(S.phase(20,false),'free');
});
test('calculates arrival rate and identifies a delivery interruption',()=>{
  const samples=[0,20,40,400,420].map(t=>({received_at_ms:t,elapsed_ms:t}));const stats=S.statistics(samples);
  assert.equal(stats.gaps.length,1);assert.equal(stats.gaps[0].duration_ms,360);assert.ok(Math.abs(stats.rate_hz-4000/420)<1e-8);assert.equal(S.statistics([]).rate_hz,null);
});
test('CSV preserves zero versus unavailable readings and the measured impulse',()=>{
  const sample=S.normalize({acceleration:{x:0,y:0,z:.5},accelerationIncludingGravity:{x:0,y:0,z:10.31},rotationRate:null,interval:20,timeStamp:120},100,200);
  sample.phase='light-taps';sample.graph_method=S.source(sample).method;sample.movement_m_s2=S.magnitude(sample.acceleration,{x:0,y:0,z:0});
  const rows=S.csv({samples:[sample]}).split('\r\n');assert.equal(sample.movement_m_s2,.5);assert.match(rows[1],/100,light-taps,120,20,0,0,0.5,0,0,10.31,,,,0.5,linear-acceleration/);
});
