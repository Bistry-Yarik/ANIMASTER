export function poseAt(keys,frame){
 const sorted=Object.keys(keys).map(Number).sort((a,b)=>a-b);
 if(!sorted.length)return {x:0,y:0,scale:1,opacity:1,rotation:0};
 let a=sorted[0],b=sorted.at(-1);
 if(frame<=a)return {rotation:0,...keys[a]};if(frame>=b)return {rotation:0,...keys[b]};
 for(let i=1;i<sorted.length;i++)if(sorted[i]>=frame){a=sorted[i-1];b=sorted[i];break;}
 const t=(frame-a)/(b-a),fields=['x','y','scale','opacity','rotation'];for(const axis of ['scaleX','scaleY','shake','blur'])if(keys[a][axis]!==undefined||keys[b][axis]!==undefined)fields.push(axis);const result=Object.fromEntries(fields.map(k=>{const fallback=k==='scaleX'||k==='scaleY'?1:0;return [k,(keys[a][k]??fallback)+((keys[b][k]??fallback)-(keys[a][k]??fallback))*t];}));if(keys[a].corners||keys[b].corners){
  const domains=[keys[a].warpBounds,keys[b].warpBounds].filter(Boolean);let domain;
  if(domains.length){const x=Math.min(...domains.map(v=>v.x)),y=Math.min(...domains.map(v=>v.y)),right=Math.max(...domains.map(v=>v.x+v.w)),bottom=Math.max(...domains.map(v=>v.y+v.h));domain={x,y,w:right-x,h:bottom-y};result.warpBounds=domain;}
  const points=rectCorners(domain),mapped=key=>points.map(p=>key.corners?warpPoint(p,key.corners,false,key.warpBounds):p),start=mapped(keys[a]),end=mapped(keys[b]);
  result.corners=start.map((p,i)=>({x:p.x+(end[i].x-p.x)*t,y:p.y+(end[i].y-p.y)*t}));
 }return result;
}
export function tweenSpan(keys,frame,total=0,loop=false){
 const sorted=Object.keys(keys).map(Number).filter(f=>f>=0&&(!total||f<total)).sort((a,b)=>a-b);
 if(!sorted.length)return null;
 let before=sorted.filter(f=>f<frame).at(-1),after=sorted.find(f=>f>frame),start=before,end=after;
 if(loop&&total>0){
  if(before===undefined){before=sorted.at(-1);start=before-total;}
  if(after===undefined){after=sorted[0];end=after+total;}
 }
 if(start===undefined||end===undefined||start===end)return null;
 return {before,after,t:(frame-start)/(end-start)};
}
export function framePose(layer,frame,total=0,loop=false){
 if(!Object.hasOwn(layer.keys,frame)&&layer.tweens?.includes(frame)&&loop){
  const span=tweenSpan(layer.keys,frame,total,true);
  if(span)return poseAt({0:layer.keys[span.before],1:layer.keys[span.after]},span.t);
 }
 if(Object.hasOwn(layer.keys,frame)||layer.tweens?.includes(frame))return poseAt(layer.keys,frame);
 return {x:0,y:0,scale:1,opacity:1,rotation:0};
}
export function floodFill(data,width,height,x,y,color,tolerance=24){
 x=Math.floor(x);y=Math.floor(y);if(x<0||y<0||x>=width||y>=height)return;
 const start=(y*width+x)*4,target=Array.from(data.slice(start,start+4));
 if(target.every((v,i)=>v===color[i]))return;
 const stack=[y*width+x],seen=new Uint8Array(width*height);
 while(stack.length){const p=stack.pop();if(seen[p])continue;seen[p]=1;const o=p*4;if(!target.every((v,i)=>Math.abs(data[o+i]-v)<=tolerance))continue;
 data.set(color,o);const px=p%width;if(px)stack.push(p-1);if(px<width-1)stack.push(p+1);if(p>=width)stack.push(p-width);if(p<width*(height-1))stack.push(p+width);}
}
export function removeColor(data,color,tolerance){const [r,g,b]=color;for(let i=0;i<data.length;i+=4)if(Math.abs(data[i]-r)<=tolerance&&Math.abs(data[i+1]-g)<=tolerance&&Math.abs(data[i+2]-b)<=tolerance)data[i+3]=0;}

export function transformPoint(point,pose,inverse=false){
 const {sx,sy}=axisScales(pose),angle=(pose.rotation||0)*Math.PI/180,c=Math.cos(angle),n=Math.sin(angle),cx=pose.x+480*sx,cy=pose.y+270*sy;
 if(inverse){const x=point.x-cx,y=point.y-cy,p={x:(x*c+y*n)/sx+480,y:(-x*n+y*c)/sy+270};return pose.corners?warpPoint(p,pose.corners,true,pose.warpBounds):p;}
 const warped=pose.corners?warpPoint(point,pose.corners,false,pose.warpBounds):point;const x=(warped.x-480)*sx,y=(warped.y-270)*sy;return {x:cx+x*c-y*n,y:cy+x*n+y*c};
}

export function axisScales(pose){return {sx:pose.scale*(pose.scaleX??1),sy:pose.scale*(pose.scaleY??1)};}
export function yearAt(start,end,frame,total){return Math.round(start+(end-start)*(total<=1?0:Math.max(0,Math.min(total-1,frame))/(total-1)));}
export function levelDb(rms){return Math.max(-100,Math.min(0,20*Math.log10(Math.max(1e-5,rms))));}
export function noiseOpacity(db){return Math.max(0,Math.min(1,-db/100));}
export function pcmLevelDb(sources,time,windowSize=1024){
 if(!sources.length)return -100;let energy=0;
 for(let i=0;i<windowSize;i++){
  let left=0,right=0;
  for(const source of sources){const t=time+i/48000;if(t<(source.start??0)||t>=(source.end??Infinity))continue;const index=Math.floor(((source.offset??0)+(t-(source.start??0))*(source.rate??1))*source.sampleRate),a=source.channels[0]?.[index]||0,b=source.channels[1]?.[index]??a,gain=source.volume??1;left+=a*gain;right+=b*gain;}
  energy+=(left*left+right*right)/2;
 }
 return levelDb(Math.sqrt(energy/windowSize));
}
export function remapFrames(layer,map){
 const remap=entries=>Object.fromEntries(Object.entries(entries).flatMap(([f,value])=>{const next=map(Number(f));return next===null?[]:[[next,value]];}));
 return {...layer,altFrames:layer.altFrames?remap(layer.altFrames):undefined,audioKeys:layer.audioKeys?remap(layer.audioKeys):undefined,mapOwners:layer.mapOwners?remap(layer.mapOwners):undefined,keys:remap(layer.keys),drawings:remap(layer.drawings),tweens:layer.tweens.flatMap(f=>{const next=map(f);return next===null?[]:[next];})};
}
export function varyColor(rgb,amount,sample){
 const shift=Math.max(-1,Math.min(1,sample))*Math.max(0,Math.min(1,amount));
 return rgb.map(v=>Math.round(shift>=0?v+(255-v)*shift:v*(1+shift)));
}
export function spatialNoise(x,y,seed){
 const size=18,ix=Math.floor(x/size),iy=Math.floor(y/size),smooth=t=>t*t*(3-2*t),tx=smooth(x/size-ix),ty=smooth(y/size-iy);
 const hash=(a,b)=>{const n=Math.sin(a*127.1+b*311.7+seed*74.7)*43758.5453;return (n-Math.floor(n))*2-1;};
 const top=hash(ix,iy)*(1-tx)+hash(ix+1,iy)*tx,bottom=hash(ix,iy+1)*(1-tx)+hash(ix+1,iy+1)*tx;
 return top*(1-ty)+bottom*ty;
}
export function encodeWav(channels,sampleRate){
 const length=channels[0].length,count=channels.length,buffer=new ArrayBuffer(44+length*count*2),view=new DataView(buffer);
 const text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
 text(0,'RIFF');view.setUint32(4,buffer.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,count,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*count*2,true);view.setUint16(32,count*2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,length*count*2,true);
 for(let i=0;i<length;i++)for(let ch=0;ch<count;ch++){const v=Math.max(-1,Math.min(1,channels[ch][i]));view.setInt16(44+(i*count+ch)*2,v<0?v*32768:v*32767,true);}
 return buffer;
}
export function constrainHandles(handles,width,height,margin){
 const xs=handles.map(h=>h.point.x),ys=handles.map(h=>h.point.y),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
 const preferred=Math.max(1,4*margin/Math.max(1,maxX-minX),4*margin/Math.max(1,maxY-minY));
 const factor=Math.min(preferred,(width-2*margin)/Math.max(1,maxX-minX),(height-2*margin)/Math.max(1,maxY-minY));
 const w=(maxX-minX)*factor,h=(maxY-minY)*factor,left=Math.max(margin,Math.min(width-margin-w,minX)),top=Math.max(margin,Math.min(height-margin-h,minY));
 return handles.map(handle=>({...handle,point:{x:left+(handle.point.x-minX)*factor,y:top+(handle.point.y-minY)*factor}}));
}

export function rectCorners(b={x:0,y:0,w:960,h:540}){return [{x:b.x,y:b.y},{x:b.x+b.w,y:b.y},{x:b.x+b.w,y:b.y+b.h},{x:b.x,y:b.y+b.h}];}
export function cornersOf(pose={}){return pose.corners||rectCorners(pose.warpBounds);}
export function alphaBounds(data,width,height){let left=width,top=height,right=-1,bottom=-1;for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}return right<0?null:{x:left,y:top,w:right-left+1,h:bottom-top+1};}
export function validCorners(points){
 if(!Array.isArray(points)||points.length!==4||!points.every(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)))return false;
 return points.every((a,i)=>{const b=points[(i+1)%4],c=points[(i+2)%4];return (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x)>.001;});
}
export function quadMatrix(points,bounds={x:0,y:0,w:960,h:540}){
 const [p0,p1,p2,p3]=points,dx1=p1.x-p2.x,dx2=p3.x-p2.x,dx3=p0.x-p1.x+p2.x-p3.x,dy1=p1.y-p2.y,dy2=p3.y-p2.y,dy3=p0.y-p1.y+p2.y-p3.y;
 let g=0,h=0;
 if(Math.abs(dx3)+Math.abs(dy3)>1e-9){const det=dx1*dy2-dx2*dy1;if(Math.abs(det)<1e-9)return null;g=(dx3*dy2-dx2*dy3)/det;h=(dx1*dy3-dx3*dy1)/det;}
 const {x,y,w,h:height}=bounds;if(!(w>0&&height>0))return null;const a=(p1.x-p0.x+g*p1.x)/w,b=(p3.x-p0.x+h*p3.x)/height,d=(p1.y-p0.y+g*p1.y)/w,e=(p3.y-p0.y+h*p3.y)/height,gg=g/w,hh=h/height;return [a,b,p0.x-a*x-b*y,d,e,p0.y-d*x-e*y,gg,hh,1-gg*x-hh*y];
}
export function projectPoint(p,m){const w=m[6]*p.x+m[7]*p.y+m[8];return Math.abs(w)<1e-12?{x:Infinity,y:Infinity}:{x:(m[0]*p.x+m[1]*p.y+m[2])/w,y:(m[3]*p.x+m[4]*p.y+m[5])/w};}
export function warpPoint(p,points,inverse=false,bounds){
 const m=quadMatrix(points,bounds);if(!m)return {x:Infinity,y:Infinity};
 if(!inverse)return projectPoint(p,m);
 const [a,b,c,d,e,f,g,h,i]=m,det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
 if(Math.abs(det)<1e-12)return {x:Infinity,y:Infinity};
 return projectPoint(p,[(e*i-f*h)/det,(c*h-b*i)/det,(b*f-c*e)/det,(f*g-d*i)/det,(a*i-c*g)/det,(c*d-a*f)/det,(d*h-e*g)/det,(b*g-a*h)/det,(a*e-b*d)/det]);
}
