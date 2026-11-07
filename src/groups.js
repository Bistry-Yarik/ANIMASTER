import {poseAt,tweenSpan,rectCorners,warpPoint,validCorners} from './engine.js';
export function mediaPose(keys,frame,start=0,end=1,defaults={x:0,y:0,scale:1,scaleX:1,scaleY:1,opacity:1,rotation:0},loop=false){
 if(loop&&Object.keys(keys).length){if(Object.hasOwn(keys,frame))return {...defaults,...keys[frame]};const span=tweenSpan(keys,frame,end+1,true);if(span)return poseAt({0:keys[span.before],1:keys[span.after]},span.t);}
 const anchors={};if(!Object.hasOwn(keys,start))anchors[start]=defaults;if(!Object.hasOwn(keys,end))anchors[end]=defaults;return poseAt({...anchors,...keys},frame);
}
const audioCurves=new WeakMap();
export function audioPose(keys,frame,start,end,loop=false){
 let curve=audioCurves.get(keys);if(!curve||curve.start!==start||curve.end!==end||curve.loop!==loop){const included=loop?Object.fromEntries(Object.entries(keys).filter(([f])=>+f>=start&&+f<=end)):keys,points={};const wrapped=loop&&Object.keys(included).length>0;if(!wrapped&&!Object.hasOwn(included,start))points[start]={volume:1,pitch:0};if(!wrapped&&!Object.hasOwn(included,end))points[end]={volume:1,pitch:0};Object.assign(points,included);curve={start,end,loop,points,frames:Object.keys(points).map(Number).sort((a,b)=>a-b)};audioCurves.set(keys,curve);}
 const sorted=curve.frames,points=curve.points;let lo=0,hi=sorted.length-1;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(sorted[mid]<frame)lo=mid+1;else hi=mid;}let b=sorted[lo],a=sorted[Math.max(0,sorted[lo]>frame?lo-1:lo)],from=a,to=b;
 if(loop&&sorted.length&&frame<sorted[0]){a=sorted.at(-1);from=a-(end-start+1);b=sorted[0];to=b;}else if(loop&&frame>sorted.at(-1)){a=sorted.at(-1);from=a;b=sorted[0];to=b+(end-start+1);}
 const t=from===to?0:Math.max(0,Math.min(1,(frame-from)/(to-from)));return {volume:points[a].volume+(points[b].volume-points[a].volume)*t,pitch:points[a].pitch+(points[b].pitch-points[a].pitch)*t};
}

export function groupPose(base,reference,next){
 const result={...base};for(const key of ['x','y','rotation','opacity',...['shake','blur'].filter(k=>base[k]!==undefined||reference[k]!==undefined||next[k]!==undefined)])result[key]=(base[key]??(key==='opacity'?1:0))+(next[key]??0)-(reference[key]??0);
 for(const field of ['shake','blur'].filter(k=>result[k]!==undefined))result[field]=Math.max(0,Math.min(100,result[field]??0));
 result.opacity=Math.max(0,Math.min(1,result.opacity));for(const key of ['scale','scaleX','scaleY'])result[key]=(base[key]??1)*(next[key]??1)/(reference[key]??1);
 if(next.corners){const bounds=next.warpBounds||reference.warpBounds,points=rectCorners(bounds),at=(pose,p)=>pose.corners?warpPoint(p,pose.corners,false,pose.warpBounds):p;
  const corners=points.map(p=>{const a=at(base,p),b=at(reference,p),c=at(next,p);return {x:a.x+c.x-b.x,y:a.y+c.y-b.y};});if(!validCorners(corners))return null;result.corners=corners;if(bounds)result.warpBounds={...bounds};
 }
 return result;
}
