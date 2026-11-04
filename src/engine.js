export function poseAt(keys,frame){
 const sorted=Object.keys(keys).map(Number).sort((a,b)=>a-b);
 if(!sorted.length)return {x:0,y:0,scale:1,opacity:1,rotation:0};
 let a=sorted[0],b=sorted.at(-1);
 if(frame<=a)return {rotation:0,...keys[a]};if(frame>=b)return {rotation:0,...keys[b]};
 for(let i=1;i<sorted.length;i++)if(sorted[i]>=frame){a=sorted[i-1];b=sorted[i];break;}
 const t=(frame-a)/(b-a),fields=['x','y','scale','opacity','rotation'];for(const axis of ['scaleX','scaleY'])if(keys[a][axis]!==undefined||keys[b][axis]!==undefined)fields.push(axis);return Object.fromEntries(fields.map(k=>{const fallback=k==='scaleX'||k==='scaleY'?1:0;return [k,(keys[a][k]??fallback)+((keys[b][k]??fallback)-(keys[a][k]??fallback))*t];}));
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
export function removeColor(data,color,tolerance){for(let i=0;i<data.length;i+=4)if(Math.max(...color.slice(0,3).map((v,c)=>Math.abs(data[i+c]-v)))<=tolerance)data[i+3]=0;}

export function transformPoint(point,pose,inverse=false){
 const {sx,sy}=axisScales(pose),angle=(pose.rotation||0)*Math.PI/180,c=Math.cos(angle),n=Math.sin(angle),cx=pose.x+480*sx,cy=pose.y+270*sy;
 if(inverse){const x=point.x-cx,y=point.y-cy;return {x:(x*c+y*n)/sx+480,y:(-x*n+y*c)/sy+270};}
 const x=(point.x-480)*sx,y=(point.y-270)*sy;return {x:cx+x*c-y*n,y:cy+x*n+y*c};
}

export function axisScales(pose){return {sx:pose.scale*(pose.scaleX??1),sy:pose.scale*(pose.scaleY??1)};}
export function remapFrames(layer,map){
 const remap=entries=>Object.fromEntries(Object.entries(entries).flatMap(([f,value])=>{const next=map(Number(f));return next===null?[]:[[next,value]];}));
 return {...layer,keys:remap(layer.keys),drawings:remap(layer.drawings),tweens:layer.tweens.flatMap(f=>{const next=map(f);return next===null?[]:[next];})};
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
