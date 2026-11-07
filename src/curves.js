import {tweenSpan,poseAt,rectCorners,warpPoint,validCorners} from './engine.js';

// AltA is an interpolation guide, never an ordinary key. Each edited channel
// has its own Hermite spline so editing color does not change the motion path.
export function guideSpan(keys,guides,frame,total,loop,accept=()=>true){
 const span=tweenSpan(keys,frame,total,loop);if(!span){if(loop&&total>0&&!Object.keys(keys).some(f=>+f>=0&&+f<total)){const nodes=[];for(const [id,guide] of Object.entries(guides||{})){const f=Number(id);if(f<0||f>=total||!accept(guide))continue;for(const offset of [-total,0,total])nodes.push({time:f+offset,frame:f,guide});}nodes.sort((a,b)=>a.time-b.time);return nodes.length?nodes:null;}return null;}
 let start=span.before,end=span.after;if(loop&&start>=frame)start-=total;if(loop&&end<=frame)end+=total;
 const nodes=[{time:start,frame:span.before,key:true},{time:end,frame:span.after,key:true}];
 for(const [id,guide] of Object.entries(guides||{})){const f=Number(id);if(!accept(guide))continue;for(const offset of loop?[-total,0,total]:[0]){const time=f+offset;if(time>start&&time<end)nodes.push({time,frame:f,guide});}}
 nodes.sort((a,b)=>a.time-b.time);return nodes.length>2?nodes:null;
}
export function splineWeights(nodes,frame){
 let left=0;for(let i=1;i<nodes.length;i++){if(nodes[i].time>=frame){left=i-1;break;}}
 const right=left+1,a=nodes[left].time,b=nodes[right].time,dt=b-a,t=Math.max(0,Math.min(1,(frame-a)/dt)),t2=t*t,t3=t2*t;
 const weights=new Array(nodes.length).fill(0);weights[left]+=2*t3-3*t2+1;weights[right]+=-2*t3+3*t2;
 const tangent=(index,factor)=>{const before=Math.max(0,index-1),after=Math.min(nodes.length-1,index+1),distance=nodes[after].time-nodes[before].time;if(distance){weights[before]-=factor/distance;weights[after]+=factor/distance;}};
 tangent(left,(t3-2*t2+t)*dt);tangent(right,(t3-t2)*dt);return weights;
}
const value=(nodes,weights,read)=>nodes.reduce((sum,node,i)=>sum+weights[i]*read(node,i),0);
const defaults={x:0,y:0,scale:1,scaleX:1,scaleY:1,opacity:1,rotation:0,shake:0,blur:0};
export function guidedPose(keys,guides,frame,total,loop,base){
 if(Object.hasOwn(keys,frame)&&!guides?.[frame])return base;let result={...base};
 for(const field of Object.keys(defaults)){
  const nodes=guideSpan(keys,guides,frame,total,loop,g=>g.fields?.includes(field));if(!nodes){if(guides?.[frame]?.fields?.includes(field))result[field]=guides[frame].pose[field]??defaults[field];continue;}const weights=splineWeights(nodes,frame);
  result[field]=value(nodes,weights,n=>(n.key?keys[n.frame]:n.guide.pose)[field]??defaults[field]);
 }
 for(const field of ['shake','blur'].filter(k=>result[k]!==undefined))result[field]=Math.max(0,Math.min(100,result[field]??0));
 result.opacity=Math.max(0,Math.min(1,result.opacity));for(const field of ['scale','scaleX','scaleY'])if(result[field]!==undefined)result[field]=Math.max(.01,result[field]);
 const nodes=guideSpan(keys,guides,frame,total,loop,g=>g.fields?.includes('corners'));if(nodes){
  const poses=nodes.map(n=>n.key?keys[n.frame]:n.guide.pose),domains=poses.map(p=>p.warpBounds).filter(Boolean);let domain;
  if(domains.length){const x=Math.min(...domains.map(b=>b.x)),y=Math.min(...domains.map(b=>b.y));domain={x,y,w:Math.max(...domains.map(b=>b.x+b.w))-x,h:Math.max(...domains.map(b=>b.y+b.h))-y};}
  const source=rectCorners(domain),quads=poses.map(p=>source.map(point=>p.corners?warpPoint(point,p.corners,false,p.warpBounds):point)),weights=splineWeights(nodes,frame);
  let corners=source.map((_,corner)=>({x:value(nodes,weights,(_n,i)=>quads[i][corner].x),y:value(nodes,weights,(_n,i)=>quads[i][corner].y)}));
  // Stay within the convex deformation space if a strongly bent guide overshoots.
  if(!validCorners(corners)){const linear=poseAt(Object.fromEntries(nodes.map((n,i)=>[n.time,{...poses[i],corners:quads[i],warpBounds:domain}])),frame).corners;if(validCorners(linear)){let lo=0,hi=1;for(let i=0;i<18;i++){const t=(lo+hi)/2,candidate=linear.map((p,j)=>({x:p.x+(corners[j].x-p.x)*t,y:p.y+(corners[j].y-p.y)*t}));if(validCorners(candidate))lo=t;else hi=t;}corners=linear.map((p,j)=>({x:p.x+(corners[j].x-p.x)*lo,y:p.y+(corners[j].y-p.y)*lo}));}else corners=quads[0];}
  result.corners=corners;if(domain)result.warpBounds=domain;
 }else if(guides?.[frame]?.fields?.includes('corners')){result.corners=guides[frame].pose.corners;result.warpBounds=guides[frame].pose.warpBounds;}
 return result;
}
export function guidedAudio(keys,guides,frame,total,loop,base){
 if(Object.hasOwn(keys,frame)&&!guides?.[frame])return base;const result={...base};for(const field of ['volume','pitch']){const nodes=guideSpan(keys,guides,frame,total,loop,g=>g.audioFields?.includes(field));if(nodes)result[field]=value(nodes,splineWeights(nodes,frame),n=>(n.key?keys[n.frame]:n.guide.audio)[field]);else if(guides?.[frame]?.audioFields?.includes(field))result[field]=guides[frame].audio[field];}
 result.volume=Math.max(0,Math.min(2,result.volume));result.pitch=Math.max(-24,Math.min(24,result.pitch));return result;
}
// Signed spline weights require premultiplied pixel interpolation; Canvas alpha
// blending alone would introduce brightness seams and cannot express negatives.
export function blendGuidedPixels(sources,weights,output){
 for(let p=0;p<output.length;p+=4){let alpha=0,r=0,g=0,b=0;for(let i=0;i<sources.length;i++){const data=sources[i],a=data[p+3]/255*weights[i];alpha+=a;r+=data[p]*a;g+=data[p+1]*a;b+=data[p+2]*a;}const clamped=Math.max(0,Math.min(1,alpha));output[p+3]=clamped*255;if(alpha>1e-7&&clamped){output[p]=Math.max(0,Math.min(255,r/alpha));output[p+1]=Math.max(0,Math.min(255,g/alpha));output[p+2]=Math.max(0,Math.min(255,b/alpha));}}
 return output;
}
