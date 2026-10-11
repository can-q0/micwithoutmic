/* Signal measurements only. No speech model or invented transcription. */
(function (root) {
  'use strict';
  const channels = [
    ...['x','y','z'].map(k=>({key:'acceleration.'+k,label:'Acceleration '+k.toUpperCase(),unit:'m/s²'})),
    ...['alpha','beta','gamma'].map(k=>({key:'rotation_rate.'+k,label:'Rotation '+k,unit:'deg/s'})),
    ...['x','y','z'].map(k=>({key:'acceleration_including_gravity.'+k,label:'Gravity-included '+k.toUpperCase(),unit:'m/s²'}))
  ];
  const value = (s,key) => {const [a,b]=key.split('.');const v=s[a]?.[b];return typeof v==='number'&&Number.isFinite(v)?v:null;};
  const mean = a => a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
  const rms = (a,center) => {if(!a.length)return null;const result=Math.sqrt(a.reduce((s,v)=>s+(v-center)**2,0)/a.length);return result<1e-12?0:result;};
  const median = a => {if(!a.length)return null;const b=[...a].sort((x,y)=>x-y);return b[Math.floor(b.length/2)];};
  function timing(experiment) {const start=experiment.playback_start_ms??10000;const end=start+experiment.stimulus.duration_s*1000;return {start,end,finish:end+10000};}
  function stage(experiment,elapsed) {
    const t=timing(experiment);
    if(elapsed<5000)return {key:'settle',title:'Hands off. Let it settle.',copy:'The speaker stays quiet while the phone settles.',ends:5000};
    if(elapsed<t.start)return {key:'speaker-quiet-before',title:'Listen to the quiet.',copy:'Keep the phone and table untouched. Playback starts automatically.',ends:t.start};
    if(elapsed<t.end){
      let title='Speech clip is playing.';
      if(experiment.stimulus.kind==='tones'){const index=Math.floor((elapsed-t.start)/4000);const f=[20,40,80,160,320][index];title=(elapsed-t.start)%4000<2000?`${f} Hz tone is playing.`:'Pause between tones.';}
      return {key:'speaker-playback',title,copy:'Keep your hands off. Confirm the sound is coming from the intended speaker.',ends:t.end};
    }
    return {key:'speaker-quiet-after',title:'Back to quiet.',copy:'Leave everything still for the final reference period.',ends:t.finish};
  }
  function envelope(buffer,binMs=200){
    const count=buffer.numberOfChannels,step=Math.max(1,Math.round(buffer.sampleRate*binMs/1000)),data=Array.from({length:count},(_,c)=>buffer.getChannelData(c));
    const bins=[];for(let i=0;i<buffer.length;i+=step){const end=Math.min(buffer.length,i+step);let power=0;for(let j=i;j<end;j++)for(let c=0;c<count;c++)power+=data[c][j]**2;bins.push(Math.sqrt(power/((end-i)*count)));}
    return {bin_ms:binMs,rms:bins};
  }
  function correlation(a,b){if(a.length<15)return null;const ma=mean(a),mb=mean(b);let cross=0,va=0,vb=0;for(let i=0;i<a.length;i++){const x=a[i]-ma,y=b[i]-mb;cross+=x*y;va+=x*x;vb+=y*y;}return va>1e-20&&vb>1e-20?cross/Math.sqrt(va*vb):null;}
  function matchEnvelope(samples,key,center,experiment){
    const ref=experiment.stimulus.envelope;if(!ref?.rms?.length)return null;
    const t=timing(experiment),bins=ref.rms.length,step=ref.bin_ms;
    let best=null;
    // This exploratory maximum is not a confidence score. The search is exported.
    for(let lag=-1000;lag<=1500;lag+=step){
      const sums=Array(bins).fill(0),counts=Array(bins).fill(0);
      for(const s of samples){const i=Math.floor((s.elapsed_ms-t.start-lag)/step),v=value(s,key);if(i>=0&&i<bins&&v!==null){sums[i]+=(v-center)**2;counts[i]++;}}
      const a=[],b=[];for(let i=0;i<bins;i++)if(counts[i]>=2){a.push(Math.sqrt(sums[i]/counts[i]));b.push(ref.rms[i]);}
      const coefficient=correlation(a,b);if(coefficient!==null&&(!best||coefficient>best.coefficient))best={coefficient,lag_ms:lag,bins:a.length};
    }
    return best?{...best,search_ms:[-1000,1500],meaning:'Exploratory correlation of amplitude envelopes, not words or recognition confidence.'}:null;
  }
  function spectrum(samples,key,start,end){
    const points=samples.filter(s=>s.elapsed_ms>=start&&s.elapsed_ms<end&&value(s,key)!==null).map(s=>({t:s.elapsed_ms,v:value(s,key)})).filter((p,i,a)=>!i||p.t>a[i-1].t);
    const dt=median(points.slice(1).map((p,i)=>p.t-points[i].t).filter(v=>v>0));if(!dt)return null;
    // Never interpolate across a substantial missing-data interval.
    const maxGap=Math.min(150,dt*4);let run=[],longest=[];
    for(const p of points){if(run.length&&p.t-run.at(-1).t>maxGap){if(run.length>longest.length)longest=run;run=[];}run.push(p);}if(run.length>longest.length)longest=run;
    if(longest.length<64)return null;
    const uniform=[];let j=0;for(let t=longest[0].t;t<=longest.at(-1).t&&uniform.length<10000;t+=dt){while(j<longest.length-2&&longest[j+1].t<t)j++;const a=longest[j],b=longest[j+1];uniform.push(a.v+(b.v-a.v)*(t-a.t)/(b.t-a.t));}
    const n=2**Math.floor(Math.log2(Math.min(256,uniform.length)));if(n<64)return null;
    const powers=Array(n/2+1).fill(0);let windows=0;
    for(let off=0;off+n<=uniform.length;off+=n/2){const window=uniform.slice(off,off+n),avg=mean(window);const w=window.map((v,i)=>(v-avg)*(.5-.5*Math.cos(2*Math.PI*i/(n-1))));
      for(let k=1;k<=n/2;k++){let re=0,im=0;for(let i=0;i<n;i++){const a=2*Math.PI*k*i/n;re+=w[i]*Math.cos(a);im-=w[i]*Math.sin(a);}powers[k]+=re*re+im*im;}windows++;
    }
    const max=Math.max(...powers);const hz=1000/dt;return {sample_rate_hz:hz,nyquist_hz:hz/2,window_samples:n,windows,segment_duration_ms:longest.at(-1).t-longest[0].t,bins:powers.slice(1).map((p,i)=>({hz:(i+1)*hz/n,relative_power:max>0?p/max:0})),meaning:'Observed sensor frequencies; aliasing can make them differ from speaker frequencies.'};
  }
  function analyze(session){
    const experiment=session.experiment;if(!experiment)return null;const t=timing(experiment),samples=session.samples;
    const before=samples.filter(s=>s.elapsed_ms>=5000&&s.elapsed_ms<t.start),play=samples.filter(s=>s.elapsed_ms>=t.start&&s.elapsed_ms<t.end),after=samples.filter(s=>s.elapsed_ms>=t.end+2000&&s.elapsed_ms<t.finish);
    const results=channels.flatMap(c=>{
      const a=before.map(s=>value(s,c.key)).filter(v=>v!==null),b=play.map(s=>value(s,c.key)).filter(v=>v!==null),tail=after.map(s=>value(s,c.key)).filter(v=>v!==null);
      if(a.length<20||b.length<20)return [];
      const center=mean(a),quiet=rms(a,center),active=rms(b,center),late=rms(tail,mean(tail));
      return [{...c,baseline_mean:center,quiet_rms:quiet,playback_rms:active,tail_rms:late,ratio_db:quiet>1e-12&&active>1e-12?20*Math.log10(active/quiet):null,playback_unique_values:new Set(b).size,baseline_samples:a.length,playback_samples:b.length,tail_mean_shift:tail.length?mean(tail)-center:null}];
    });
    // Rank ratios within channels; don't compare raw rotation and acceleration units.
    const ranked=[...results].sort((a,b)=>(b.ratio_db??-Infinity)-(a.ratio_db??-Infinity));
    const best=ranked.find(c=>c.ratio_db!==null)??results.find(c=>c.playback_rms>0)??null;
    const positiveDt=samples.slice(1).map((s,i)=>s.elapsed_ms-samples[i].elapsed_ms).filter(v=>v>0);const interval=median(positiveDt);
    const complete=session.stop_reason==='Speaker test complete.'&&session.duration_ms>=t.finish-500&&after.length>=20&&play.length>=20&&results.length>0;
    const warnings=[];
    if(!complete)warnings.push('Run incomplete: capture the entire quiet / playback / quiet sequence.');
    if(!results.length)warnings.push('Too few usable readings to compare quiet and playback.');
    if(best&&best.ratio_db===null)warnings.push('Quiet readings are at or below the observed resolution; a finite signal-to-quiet ratio cannot be calculated.');
    if(best&&Math.abs(best.tail_mean_shift??0)>Math.max(best.playback_rms*.5,1e-8))warnings.push('The final baseline shifted. Touching or tilting may have affected this run.');
    if(session.statistics?.gaps?.length)warnings.push('Delivery gaps occurred; uninterrupted audio capture is not established.');
    const envelope_match=best?matchEnvelope(samples,best.key,best.baseline_mean,experiment):null;
    const spectral=best?spectrum(samples,best.key,t.start,t.end):null;
    return {version:1,complete,median_delivery_rate_hz:interval?1000/interval:null,estimated_unaliased_band_hz:interval?500/interval:null,channels:results,strongest_channel:best?.key??null,envelope_match,spectrum:spectral,warnings,interpretation:'Activity changes and envelope correlation are exploratory. They do not establish intelligible audio or recovered words.'};
  }
  function compare(history){
    const complete=history.filter(s=>s.analysis?.complete);
    const same=complete.find(s=>s.experiment.placement==='same-table');if(!same)return null;
    const other=complete.find(s=>s.experiment.placement==='separate-surface'&&s.experiment.stimulus.id===same.experiment.stimulus.id&&s.experiment.distance_cm===same.experiment.distance_cm&&s.experiment.volume_note===same.experiment.volume_note);
    if(!other)return null;
    return {same_table:same,separate_surface:other,meaning:'Matched clip, distance, and entered volume note. Compare individual channels; output routing is user-confirmed.'};
  }
  root.TableExperiment={timing,stage,envelope,analyze,compare,value,channels};
  if(typeof module!=='undefined')module.exports=root.TableExperiment;
})(typeof window!=='undefined'?window:globalThis);
