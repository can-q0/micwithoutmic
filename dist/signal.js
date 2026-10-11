/* Browser-independent recording helpers. Missing sensor values stay null. */
(function (root) {
  const phases = [
    {start:0,end:5,key:'settle',title:'Hands off. Let it settle.',copy:'Leave the phone still. These first 5 seconds set the graph baseline.'},
    {start:5,end:15,key:'still',title:'Keep the table still.',copy:'No touching. This is your quiet reference.'},
    {start:15,end:25,key:'light-taps',title:'Make a few light taps.',copy:'Tap the table about 20 cm away. Leave 1–2 seconds between taps.'},
    {start:25,end:35,key:'firm-taps',title:'Try a few firmer taps.',copy:'Use the same spot, about 20 cm away. Keep the phone in place.'},
    {start:35,end:45,key:'slow-press',title:'Gently press, then release.',copy:'Press the phone slowly downward. Steady pressure may show little signal.'}
  ];
  const finite = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
  const vector = (v, keys) => Object.fromEntries(keys.map(k => [k,finite(v?.[k])]));
  const valid = v => v && ['x','y','z'].every(k => finite(v[k]) !== null);
  const phase = (seconds,guided) => !guided ? 'free' : (phases.find(p=>seconds>=p.start && seconds<p.end)?.key ?? 'complete');
  function normalize(e, elapsed, received) {
    const acceleration = vector(e.acceleration,['x','y','z']);
    const gravity = vector(e.accelerationIncludingGravity,['x','y','z']);
    if (!valid(acceleration) && !valid(gravity)) return null;
    return {elapsed_ms:elapsed,received_at_ms:received,event_timestamp_ms:finite(e.timeStamp),reported_interval_ms:finite(e.interval),acceleration,acceleration_including_gravity:gravity,rotation_rate:vector(e.rotationRate,['alpha','beta','gamma'])};
  }
  function source(s) { return valid(s.acceleration) ? {v:s.acceleration,method:'linear-acceleration'} : {v:s.acceleration_including_gravity,method:'gravity-included-baseline'}; }
  function magnitude(v,b) {return Math.hypot(v.x-b.x,v.y-b.y,v.z-b.z);}
  function statistics(samples) {
    if(samples.length<2) return {rate_hz:null,gaps:[],span_ms:0};
    const span=samples.at(-1).received_at_ms-samples[0].received_at_ms;
    const intervals=samples.slice(1).map((s,i)=>s.received_at_ms-samples[i].received_at_ms);
    const sorted=[...intervals].sort((a,b)=>a-b), median=sorted[Math.floor(sorted.length/2)];
    const gaps=intervals.flatMap((dt,i)=>dt>Math.max(150,median*4)?[{after_elapsed_ms:samples[i].elapsed_ms,duration_ms:dt}]:[]);
    return {rate_hz:span>0?(samples.length-1)*1000/span:null,gaps,span_ms:span};
  }
  const columns=['elapsed_ms','phase','event_timestamp_ms','reported_interval_ms','ax_m_s2','ay_m_s2','az_m_s2','gx_m_s2','gy_m_s2','gz_m_s2','alpha_deg_s','beta_deg_s','gamma_deg_s','movement_m_s2','graph_method'];
  function csv(session) {return [columns.join(','),...session.samples.map(s=>[s.elapsed_ms,s.phase,s.event_timestamp_ms,s.reported_interval_ms,s.acceleration.x,s.acceleration.y,s.acceleration.z,s.acceleration_including_gravity.x,s.acceleration_including_gravity.y,s.acceleration_including_gravity.z,s.rotation_rate.alpha,s.rotation_rate.beta,s.rotation_rate.gamma,s.movement_m_s2,s.graph_method].map(v=>v??'').join(','))].join('\r\n');}
  root.TableSignal={phases,phase,normalize,source,magnitude,statistics,csv};
  if(typeof module!=='undefined') module.exports=root.TableSignal;
})(typeof window!=='undefined'?window:globalThis);
