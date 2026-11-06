// Clip positions are in timeline seconds; in/out are source seconds.
export function clipSettings(value={},duration=0){
 const finite=(v,d)=>Number.isFinite(v)?v:d,end=Math.max(0,finite(duration,0));
 const speed=Math.max(.25,Math.min(4,finite(value.speed,1))),input=Math.max(0,Math.min(end,finite(value.in,0))),output=Math.max(input,Math.min(end,finite(value.out,end)));
 return {start:Math.max(0,finite(value.start,0)),in:input,out:output,speed,volume:Math.max(0,Math.min(2,finite(value.volume,1))),pitch:value.pitch===true};
}
export function clipEnd(clip){return clip.start+(clip.out-clip.in)/clip.speed;}
export function clipTime(clip,time){const end=clipEnd(clip);return {active:time>=clip.start&&time<end,source:Math.max(clip.in,Math.min(Math.max(clip.in,clip.out-.00001),clip.in+(time-clip.start)*clip.speed))};}
export function dragClip(clip,action,delta,duration,fps){
 const next={...clip},minimum=Math.min(clip.out-clip.in,clip.speed/fps);
 if(action==='move')next.start=Math.max(0,clip.start+delta);
 else if(action==='in'){const d=Math.max(-clip.start,delta);next.in=Math.max(0,Math.min(clip.out-minimum,clip.in+d*clip.speed));next.start=clip.start+(next.in-clip.in)/clip.speed;}
 else if(action==='out')next.out=Math.max(clip.in+minimum,Math.min(duration,clip.out+delta*clip.speed));
 return next;
}
export function buildEnvelope(channels,sampleRate,block=256){
 const length=channels[0]?.length||0,count=Math.ceil(length/block),rms=new Float32Array(count),peaks=new Float32Array(count);
 for(let bin=0;bin<count;bin++){let sum=0,peak=0,n=0;for(const channel of channels)for(let i=bin*block;i<Math.min(length,(bin+1)*block);i++){const v=channel[i];sum+=v*v;peak=Math.max(peak,Math.abs(v));n++;}rms[bin]=Math.sqrt(sum/Math.max(1,n));peaks[bin]=peak;}
 return {rms,peaks,secondsPerBin:block/sampleRate};
}
export function envelopeAt(envelope,from,to,volume=1){
 if(!envelope)return {rms:0,peak:0};const start=Math.max(0,Math.floor(from/envelope.secondsPerBin)),end=Math.min(envelope.rms.length,Math.max(start+1,Math.ceil(to/envelope.secondsPerBin)));let sum=0,peak=0;
 for(let i=start;i<end;i++){sum+=envelope.rms[i]**2;peak=Math.max(peak,envelope.peaks[i]);}return {rms:Math.sqrt(sum/Math.max(1,end-start))*volume,peak:peak*volume};
}
export function arrowRate(elapsed){return [5,10,20,40,60,80,100][Math.min(6,Math.max(0,Math.floor(elapsed/1000)))];}
