import {setupCommunity} from './community-ui.js';
import {guideSpan,splineWeights,guidedPose,guidedAudio,blendGuidedPixels} from './curves.js';
import {getLanguage,translate,localizedLesson,setupI18n} from './i18n.js';
import {mediaPose,audioPose,groupPose} from './groups.js';
import {createPitchNode} from './pitch.js';
import {clipSettings,clipEnd,clipTime,dragClip,buildEnvelope,envelopeAt,arrowRate,arrowDistance} from './media.js';
import {alphaBounds,rectCorners,warpPoint,poseAt,framePose,tweenSpan,transformPoint,axisScales,encodeWav,remapFrames,varyColor,spatialNoise,floodFill,removeColor,cornersOf,validCorners,yearAt,noiseOpacity,levelDb,pcmLevelDb} from './engine.js';
import {drawWarp} from './warp.js';
import {MAP_TEMPLATES,MAP_COUNTRIES,COUNTRY_FLAGS} from './templates.js';
import {TEXT_FONTS,textSurface,loadFlag,prepareMap,territoryStroke,mapOwnersAt,serializeOwnership,restoreOwnership} from './studio.js';
const $=id=>document.getElementById(id),stage=$('stage'),ctx=stage.getContext('2d'),W=960,H=540;
let brushPreferences={};try{brushPreferences=JSON.parse(localStorage.getItem('animaster.brushPreferences')||'{}');}catch{}let customPalette=Array.isArray(brushPreferences.palette)?brushPreferences.palette.filter(c=>/^#[0-9a-f]{6}$/i.test(c)):[];
function saveBrushPreferences(){try{localStorage.setItem('animaster.brushPreferences',JSON.stringify({palette:customPalette,wheel:Number($('brushWheelSpeed').value)}));}catch{}}
let projectId=crypto.randomUUID(),layers=[],selected=null,frame=0,total=1,fps=24,tool='pencil',playing=false,playbackRun=0,onion=false,gesture=null,history=[],redoHistory=[],selectedFrames=new Set([0]),selectionAnchor=0,clipboard=null,audioContext,audioDest,exporting=false;
let selectedLayerIds=new Set(),boxSelection=null;
let timelineZoom=1,nHeld=false,nCheckpoint=false,vHeld=false,vCheckpoint=false,vApplied=new Set(),frameDrag=null,mediaGesture=null,arrowHold=null;
const fontsReady=Promise.all(['Lobster','Pacifico','Caveat','Oswald','Rubik','Russo One','Comfortaa','Amatic SC'].map(font=>document.fonts.load(`24px "${font}"`)));
const initialPose=()=>({x:0,y:0,scale:1,scaleX:1,scaleY:1,opacity:1,rotation:0,shake:0,blur:0});
function mediaBounds(l){const clip=settingsFor(l);return {start:Math.max(0,Math.floor(clip.start*fps)),end:Math.max(0,Math.ceil(clipEnd(clip)*fps)-1)};}
function mediaAnchors(l,audio=false){const b=mediaBounds(l),loop=$('loop').checked&&b.start===0&&b.end>=total-1,end=loop?total-1:b.end,keys=audio?(l.audioKeys??={}):l.keys,defaults=audio?{volume:1,pitch:0}:initialPose(),anchors={};if(!loop||(!Object.keys(keys).length&&!Object.keys(l.altFrames||{}).length)){for(const f of [b.start,end]){if(Object.hasOwn(keys,f))continue;let value={...defaults};const guide=l.altFrames?.[f];for(const field of (audio?guide?.audioFields:guide?.fields)||[]){if(field==='corners'){value.corners=guide.pose.corners;value.warpBounds=guide.pose.warpBounds;}else value[field]=(audio?guide.audio:guide.pose)[field];}anchors[f]=value;}}return {keys:{...anchors,...keys},loop,end,start:b.start};}
function audioFor(l,f){const b=mediaBounds(l),loop=$('loop').checked&&b.start===0&&b.end>=total-1,end=loop?total-1:b.end;let base=audioPose(l.audioKeys??={},f,b.start,end,loop);if(!Object.keys(l.altFrames||{}).some(id=>l.altFrames[id].audioFields?.length))return base;const anchors=mediaAnchors(l,true);base=audioPose(anchors.keys,f,b.start,end,loop);return guidedAudio(anchors.keys,l.altFrames,f,loop?total:Math.max(total,end+1),loop,base);}
function poseFor(layer,f,interpolated=false){let base,keys=layer.keys,loop=$('loop').checked,spanTotal=total;if(layer.autoTween){const b=mediaBounds(layer);loop=loop&&b.start===0&&b.end>=total-1;const end=loop?total-1:b.end;base=mediaPose(layer.keys,f,b.start,end,initialPose(),loop);if(Object.keys(layer.altFrames||{}).length){const anchors=mediaAnchors(layer);keys=anchors.keys;base=mediaPose(keys,f,b.start,end,initialPose(),loop);spanTotal=Math.max(total,end+1);}}else base=interpolated?poseAt(layer.keys,f):framePose(layer,f,total,loop);if((interpolated||layer.autoTween||layer.tweens.includes(f)||layer.altFrames?.[f])&&Object.keys(layer.altFrames||{}).length)return guidedPose(keys,layer.altFrames,f,spanTotal,loop,base);return base;}
const selectedLayer=()=>layers.find(l=>l.id===selected);
const notice=s=>$('status').textContent=s;
function surface(){const c=document.createElement('canvas');c.width=W;c.height=H;return c;}
const transparent=surface();
const brushCursor=document.createElement('div');brushCursor.id='brushCursor';brushCursor.hidden=true;brushCursor.setAttribute('aria-hidden','true');document.body.append(brushCursor);
let cursorPoint=null;
function updateBrushCursor(){
 const l=selectedLayer(),r=stage.getBoundingClientRect(),p=cursorPoint;
 const show=p&&!playing&&!exporting&&!document.querySelector('dialog[open]')&&l&&l.kind!=='audio'&&l.kind!=='video'&&['pencil','eraser','territory'].includes(tool)&&p.x>=r.left&&p.x<=r.right&&p.y>=r.top&&p.y<=r.bottom;
 brushCursor.hidden=!show;
 stage.style.cursor=show?'none':tool==='move'?'move':'crosshair';
 if(!show)return;
 const pose=poseFor(l,frame),{sx,sy}=axisScales(pose),unit=+$('brush').value*r.width/W;
 Object.assign(brushCursor.style,{left:p.x+'px',top:p.y+'px',width:unit*sx+'px',height:unit*sy+'px',borderRadius:$('brushShape').value==='square'?'0':'50%',borderStyle:$('brushShape').value==='spray'?'dashed':'solid',transform:`translate(-50%,-50%) rotate(${pose.rotation||0}deg)`});
}
function trackCursor(e){cursorPoint=e.pointerType==='touch'?null:{x:e.clientX,y:e.clientY};updateBrushCursor();}
stage.addEventListener('pointerenter',trackCursor);stage.addEventListener('pointermove',trackCursor);stage.addEventListener('pointerdown',trackCursor);
stage.addEventListener('pointerleave',()=>{cursorPoint=null;updateBrushCursor();});
window.addEventListener('blur',()=>{cursorPoint=null;if(gesture){clearInterval(gesture.sprayTimer);gesture=null;refresh();}updateBrushCursor();});
document.addEventListener('scroll',()=>{cursorPoint=null;updateBrushCursor();},true);
function appendLayer(l){const index=layers.findIndex(item=>item.kind==='noise');if(l.kind!=='noise'&&index>=0)layers.splice(index,0,l);else layers.push(l);}
function newLayer(name='Рисунок',kind='drawing'){const c=surface();return {id:crypto.randomUUID(),name,kind,canvas:c,visible:true,aspectLocked:false,freeCorners:false,chroma:null,altFrames:{},keys:{0:initialPose()},drawings:kind==='drawing'?{0:c}:{},tweens:[],media:null,src:null};}
function cloneCanvas(c){const n=surface();n.getContext('2d').drawImage(c,0,0);return n;}
function linearDrawingAt(l,f){
 if(l.drawings[f])return l.drawings[f];
 if(!l.tweens?.includes(f))return l.kind==='drawing'?transparent:l.canvas;
 const span=tweenSpan(l.keys,f,total,$('loop').checked);
 const c=surface(),g=c.getContext('2d');if(!span)return c;
 const {before,after,t}=span;g.globalAlpha=1-t;g.drawImage(l.drawings[before]|| (['image','text'].includes(l.kind)?l.canvas:transparent),0,0);g.globalAlpha=t;g.globalCompositeOperation='lighter';g.drawImage(l.drawings[after]||(['image','text'].includes(l.kind)?l.canvas:transparent),0,0);return c;
}
const guidePixels=new WeakMap(),guideRasters=new WeakMap();
function drawingAt(l,f){
 if(l.drawings[f])return l.drawings[f];if(Object.hasOwn(l.keys,f))return linearDrawingAt(l,f);const guides=l.altFrames||{};if(!Object.values(guides).some(g=>g.bitmapEdited))return linearDrawingAt(l,f);
 const nodes=guideSpan(l.keys,guides,f,total,$('loop').checked,g=>g.bitmapEdited);if(!nodes||(!l.tweens.includes(f)&&!guides[f]))return linearDrawingAt(l,f);
 let cache=guideRasters.get(l);const stamp=JSON.stringify([l.guideRevision||0,total,$('loop').checked,Object.keys(l.keys),Object.entries(guides).filter(([,g])=>g.bitmapEdited).map(([id])=>id)]);if(!cache||cache.stamp!==stamp){cache={stamp,frames:new Map()};guideRasters.set(l,cache);}if(cache.frames.has(f))return cache.frames.get(f);
 const allWeights=splineWeights(nodes,f),active=nodes.map((n,i)=>({node:n,weight:allWeights[i]})).filter(entry=>Math.abs(entry.weight)>1e-12),weights=active.map(entry=>entry.weight),sources=active.map(({node:n})=>{const canvas=l.drawings[n.frame]||(['image','text'].includes(l.kind)?l.canvas:transparent);let entry=guidePixels.get(canvas);if(!entry||entry.revision!==(canvas.guideRevision||0)){entry={revision:canvas.guideRevision||0,pixels:canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,W,H).data};guidePixels.set(canvas,entry);}return entry.pixels;}),canvas=surface(),g=canvas.getContext('2d'),image=g.createImageData(W,H);blendGuidedPixels(sources,weights,image.data);g.putImageData(image,0,0);cache.frames.set(f,canvas);while(cache.frames.size>8)cache.frames.delete(cache.frames.keys().next().value);return canvas;
}
function touchDrawing(l,canvas){l.guideRevision=(l.guideRevision||0)+1;if(canvas)canvas.guideRevision=(canvas.guideRevision||0)+1;}
function editCanvas(l){if(!l.drawings[frame])l.drawings[frame]=cloneCanvas(drawingAt(l,frame));if(l.altFrames?.[frame])l.altFrames[frame]={...l.altFrames[frame],bitmapEdited:true};else{if(!l.keys[frame])l.keys[frame]=poseFor(l,frame);l.tweens=l.tweens.filter(f=>f!==frame);}touchDrawing(l,l.drawings[frame]);return l.drawings[frame];}

function snapshot(){return {layers:layers.map(l=>({...l,altFrames:structuredClone(l.altFrames),audioKeys:structuredClone(l.audioKeys),clip:structuredClone(l.clip),keys:structuredClone(l.keys),chroma:structuredClone(l.chroma),textData:structuredClone(l.textData),mapData:structuredClone(l.mapData),mapOwners:l.mapOwners?Object.fromEntries(Object.entries(l.mapOwners).map(([f,o])=>[f,o.slice()])):undefined,tweens:[...l.tweens],canvas:cloneCanvas(l.canvas),drawings:Object.fromEntries(Object.entries(l.drawings).map(([f,c])=>[f,cloneCanvas(c)]))})),selected,frame,total,selectedFrames:[...selectedFrames],selectedLayerIds:[...selectedLayerIds],selectionAnchor};}
function checkpoint(){history.push(snapshot());if(history.length>20)history.shift();redoHistory=[];}
function restore(s){stop();for(const l of layers)if(!s.layers.some(x=>x.media===l.media))l.media?.pause();({layers,selected,frame,total,selectionAnchor}=s);selectedFrames=new Set(s.selectedFrames);selectedLayerIds=new Set(s.selectedLayerIds||[selected]);for(const l of layers){l.playRequested=false;l.videoCacheKey=null;l.rawVideoTime=null;}$('duration').value=total;seekMedia();refresh();}
function undo(){if(!history.length)return;redoHistory.push(snapshot());restore(history.pop());notice('Изменение отменено · Y — вернуть.');}
function redo(){if(!redoHistory.length)return;history.push(snapshot());restore(redoHistory.pop());notice('Изменение возвращено.');}
function videoSurface(l,raw=false){
 if(!l.rawVideoCanvas){l.rawVideoCanvas=surface();l.keyedVideoCanvas=surface();}
 const media=l.media;if(!media||media.readyState<2)return transparent;
 const stamp=`${media.currentTime}/${media.videoWidth}/${media.videoHeight}`;
 if(l.rawVideoTime!==stamp){const g=l.rawVideoCanvas.getContext('2d',{willReadFrequently:true});g.clearRect(0,0,W,H);const ratio=Math.min(W/media.videoWidth,H/media.videoHeight);g.drawImage(media,(W-media.videoWidth*ratio)/2,(H-media.videoHeight*ratio)/2,media.videoWidth*ratio,media.videoHeight*ratio);l.rawVideoTime=stamp;l.videoCacheKey=null;}
 if(raw||!l.chroma?.enabled)return l.rawVideoCanvas;
 const cache=stamp+JSON.stringify(l.chroma);
 if(l.videoCacheKey!==cache){const g=l.rawVideoCanvas.getContext('2d',{willReadFrequently:true}),image=g.getImageData(0,0,W,H);removeColor(image.data,l.chroma.color,l.chroma.tolerance);l.keyedVideoCanvas.getContext('2d').putImageData(image,0,0);l.videoCacheKey=cache;}
 return l.keyedVideoCanvas;
}
// Frame-indexed noise is repeatable during scrubbing, playback and export.
function shakeOffset(seed,f,amount){let h=2166136261;for(const c of seed)h=Math.imul(h^c.charCodeAt(0),16777619);const random=s=>{let n=Math.imul(h^(f+1),s);n^=n>>>16;n=Math.imul(n,2246822507);return (n>>>0)/4294967296;};const angle=random(3266489909)*Math.PI*2,r=Math.sqrt(random(668265263))*amount;return {x:Math.cos(angle)*r,y:Math.sin(angle)*r};}
function blurredSurface(source,amount){
 const original=surface(),g=original.getContext('2d',{willReadFrequently:true});g.drawImage(source,0,0);const pixels=g.getImageData(0,0,W,H),bounds=alphaBounds(pixels.data,W,H);if(!bounds)return original;
 const {x,y,w,h}=bounds,t=Math.max(0,Math.min(1,amount/100)),small=document.createElement('canvas');small.width=Math.max(1,Math.round(w*Math.pow(1-t,3)));small.height=Math.max(1,Math.round(h*Math.pow(1-t,3)));const reduced=small.getContext('2d');reduced.imageSmoothingQuality='high';reduced.drawImage(original,x,y,w,h,0,0,small.width,small.height);
 if(t===1){let alpha=0,red=0,green=0,blue=0;for(let i=0;i<pixels.data.length;i+=4){const a=pixels.data[i+3];alpha+=a;red+=pixels.data[i]*a;green+=pixels.data[i+1]*a;blue+=pixels.data[i+2]*a;}reduced.clearRect(0,0,1,1);reduced.fillStyle=`rgba(${red/alpha},${green/alpha},${blue/alpha},${alpha/(w*h*255)})`;reduced.fillRect(0,0,1,1);}
 g.clearRect(0,0,W,H);g.imageSmoothingQuality='high';g.drawImage(small,x,y,w,h);return original;
}
function render(target=ctx,f=frame){
 target.clearRect(0,0,W,H);target.imageSmoothingEnabled=true;target.imageSmoothingQuality='high';
 for(const l of layers){
  if(!l.visible||l.kind==='audio'||l.kind==='noise'||(l.kind==='video'&&!clipTime(settingsFor(l),f/fps).active))continue;if(l.kind==='text')textSurface(l);
  const p=poseFor(l,f),{sx,sy}=axisScales(p),jitter=!Object.hasOwn(l.keys,f)&&(l.autoTween||l.tweens.includes(f)||l.altFrames?.[f])?shakeOffset(l.effectSeed||l.id,f,p.shake||0):{x:0,y:0};target.save();target.translate(p.x+jitter.x+W*sx/2,p.y+jitter.y+H*sy/2);target.rotate((p.rotation||0)*Math.PI/180);target.scale(sx,sy);target.translate(-W/2,-H/2);target.globalAlpha=p.opacity;
  const warped=p.corners&&validCorners(p.corners)&&p.corners.some((v,i)=>Math.hypot(v.x-cornersOf()[i].x,v.y-cornersOf()[i].y)>.001);
  if((p.blur||0)>0){const source=blurredSurface(l.kind==='video'?videoSurface(l):drawingAt(l,f),p.blur);warped?drawWarp(target,source,p.corners,p.warpBounds):target.drawImage(source,0,0);}
  else if(l.kind==='video'){const source=videoSurface(l);warped?drawWarp(target,source,p.corners,p.warpBounds):target.drawImage(source,0,0);}
  else if(warped){drawWarp(target,l.kind==='drawing'||l.drawings[f]||l.tweens.includes(f)?drawingAt(l,f):l.canvas,p.corners,p.warpBounds);}
  else if(l.mapData){target.drawImage(drawingAt(l,f),0,0);}
  else if(l.kind==='image'&&l.original&&!l.drawings[f]&&(!l.tweens.includes(f)||!Object.keys(l.drawings).length)){const image=l.original,ratio=Math.min(W/image.width,H/image.height,1);target.drawImage(image,(W-image.width*ratio)/2,(H-image.height*ratio)/2,image.width*ratio,image.height*ratio);}
  else target.drawImage(l.kind==='drawing'||l.drawings[f]||l.tweens.includes(f)?drawingAt(l,f):l.canvas,0,0);
  target.restore();
 }
 const map=[...layers].reverse().find(l=>l.visible&&l.mapData);
 if(target===ctx)stage.setAttribute('aria-label',map&&map.mapData.showYear!==false?'Холст, год '+yearAt(map.mapData.yearStart,map.mapData.yearEnd,f,total):'Холст анимации');
 if(map&&map.mapData.showYear!==false){target.save();target.font='bold 28px Arial';target.textBaseline='top';target.lineJoin='round';target.lineWidth=5;target.strokeStyle='#101115';target.fillStyle='#ffffff';const year=String(yearAt(map.mapData.yearStart,map.mapData.yearEnd,f,total));target.strokeText(year,18,18);target.fillText(year,18,18);target.restore();}
 for(const effect of layers.filter(l=>l.visible&&l.kind==='noise')){target.save();target.fillStyle='#000000';target.globalAlpha=noiseOpacity(audioDb(f))*poseFor(effect,f).opacity;target.fillRect(0,0,W,H);target.restore();}
}
function paint(){updateBrushCursor();render();if(onion&&frame>0&&!playing){ctx.save();ctx.globalAlpha=.18;const c=surface();render(c.getContext('2d'),frame-1);ctx.drawImage(c,0,0);ctx.restore();}const l=selectedLayer();if(tool==='move'&&l&&l.kind!=='audio'&&l.kind!=='noise'&&!playing&&!exporting){drawGuideTrajectory(l);drawEditHandles(poseFor(l,frame));}}
function contentBounds(l=selectedLayer()){
 if(!l)return null;const c=l.kind==='video'?videoSurface(l):l.kind==='text'?textSurface(l):drawingAt(l,frame);
 const bounds=alphaBounds(c.getContext('2d',{willReadFrequently:true}).getImageData(0,0,W,H).data,W,H),crop=poseFor(l,frame).warpBounds;if(!bounds||!crop)return bounds;const x=Math.max(bounds.x,crop.x),y=Math.max(bounds.y,crop.y),right=Math.min(bounds.x+bounds.w,crop.x+crop.w),bottom=Math.min(bounds.y+bounds.h,crop.y+crop.h);return right>x&&bottom>y?{x,y,w:right-x,h:bottom-y}:null;
}
function editHandles(p){
 const layer=selectedLayer(),bounds=contentBounds(layer);if(!bounds)return [];
 const {x,y,w,h}=bounds,points=rectCorners(bounds),specs=[...points.map((v,i)=>['resize',v.x,v.y,i===0||i===3?-1:1,i<2?-1:1]),['width',x,y+h/2,-1,0],['width',x+w,y+h/2,1,0],['height',x+w/2,y,0,-1],['height',x+w/2,y+h,0,1],['rotate',x+w/2,y+Math.min(h*.2,40),0,0]];
 const handles=layer?.freeCorners?points.map((point,index)=>({kind:'corner',index,point:transformPoint(point,p)})):specs.map(([kind,x,y,dx,dy])=>({kind,dx,dy,point:transformPoint({x,y},p)}));
 const quad=handles.slice(0,4).map(h=>h.point),unit=W/stage.getBoundingClientRect().width,left=Math.min(...quad.map(p=>p.x)),right=Math.max(...quad.map(p=>p.x)),top=Math.min(...quad.map(p=>p.y)),bottom=Math.max(...quad.map(p=>p.y));
 handles.push({kind:'flipX',point:{x:left-28*unit,y:(top+bottom)/2}},{kind:'flipY',point:{x:(left+right)/2,y:bottom+28*unit}});
 // Keep controls reachable without shifting the actual outline away from the artwork.
 const margin=10*W/stage.getBoundingClientRect().width;
 return handles.map(h=>({...h,actual:h.point,point:{x:Math.max(margin,Math.min(W-margin,h.point.x)),y:Math.max(margin,Math.min(H-margin,h.point.y))}}));
}
function drawGuideTrajectory(l){
 if(!l.altFrames?.[frame])return;const anchors=l.autoTween?mediaAnchors(l):{keys:l.keys,loop:$('loop').checked},nodes=guideSpan(anchors.keys,l.altFrames,frame,l.autoTween&&!anchors.loop?Math.max(total,anchors.end+1):total,anchors.loop,g=>g.fields?.some(key=>key==='x'||key==='y'));if(!nodes)return;const b=contentBounds(l);if(!b)return;const center={x:b.x+b.w/2,y:b.y+b.h/2},unit=W/stage.getBoundingClientRect().width,position=f=>transformPoint(center,poseFor(l,anchors.loop?((f%total)+total)%total:f,true));ctx.save();ctx.strokeStyle='#6ee7f4';ctx.fillStyle='#6ee7f4';ctx.lineWidth=1.2*unit;ctx.setLineDash([5*unit,4*unit]);const closed=!nodes.some(n=>n.key),start=closed?0:nodes[0].time,end=closed?total:nodes.at(-1).time;ctx.beginPath();for(let i=0;i<=80;i++){const f=start+(end-start)*i/80,p=position(f);i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);}ctx.stroke();ctx.setLineDash([]);const marked=new Set();for(const node of nodes){if(marked.has(node.frame))continue;marked.add(node.frame);const p=position(node.time);ctx.beginPath();ctx.arc(p.x,p.y,(node.key?3:4)*unit,0,Math.PI*2);ctx.fill();if(!node.key){ctx.font=`${10*unit}px Arial`;ctx.fillText('AltA',p.x+7*unit,p.y-7*unit);}}ctx.restore();
}
function drawEditHandles(p){const handles=editHandles(p),corners=handles.slice(0,4),r=6*W/stage.getBoundingClientRect().width;stage.dataset.editBounds=JSON.stringify(corners.map(h=>h.actual));stage.dataset.flipHandles=JSON.stringify(handles.filter(h=>h.kind.startsWith('flip')).map(h=>({kind:h.kind,...h.point}))); ctx.save();ctx.strokeStyle='#aa86ff';ctx.lineWidth=1.5*W/stage.getBoundingClientRect().width;ctx.beginPath();corners.forEach((h,i)=>i?ctx.lineTo(h.actual.x,h.actual.y):ctx.moveTo(h.actual.x,h.actual.y));ctx.closePath();ctx.stroke();for(const h of handles){if(h.actual.x!==h.point.x||h.actual.y!==h.point.y){ctx.beginPath();ctx.moveTo(h.actual.x,h.actual.y);ctx.lineTo(h.point.x,h.point.y);ctx.stroke();}const flip=h.kind.startsWith('flip');ctx.fillStyle=flip?'#7ddbe8':h.kind==='rotate'?'#adf086':h.kind==='corner'?'#ffbb74':'#ffffff';ctx.beginPath();if(h.kind==='rotate'||flip)ctx.arc(h.point.x,h.point.y,r*1.2,0,Math.PI*2);else ctx.rect(h.point.x-r,h.point.y-r,r*2,r*2);ctx.fill();ctx.stroke();if(flip){ctx.fillStyle='#101115';ctx.font=`bold ${r*2}px Arial`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(h.kind==='flipX'?'↔':'↕',h.point.x,h.point.y);}}ctx.restore();}

function flipSelection(l,field,bounds){
 const anchor={x:bounds.x+bounds.w/2,y:bounds.y+bounds.h/2};
 for(const [f,base] of Object.entries(selectionPoses(l))){const next={...base,[field]:-(base[field]??1)},before=transformPoint(anchor,base),after=transformPoint(anchor,next);next.x+=before.x-after.x;next.y+=before.y-after.y;applyGroupTransform(l,{[f]:base},base,next);}
 refresh();
}
function selectionPoses(l){const bases=Object.fromEntries([...selectedFrames].map(f=>[f,structuredClone(poseFor(l,f))]));if(selectedLayerIds.has(l.id))Object.defineProperty(bases,'otherLayers',{value:layers.filter(other=>other.id!==l.id&&selectedLayerIds.has(other.id)&&!['audio','noise'].includes(other.kind)).map(other=>({layer:other,bases:Object.fromEntries([...selectedFrames].map(f=>[f,structuredClone(poseFor(other,f))]))}))});return bases;}
function applyGroupTransform(l,bases,reference,next){for(const other of bases.otherLayers||[])applyGroupTransform(other.layer,other.bases,reference,next);const changes=Object.entries(bases).map(([f,base])=>[f,groupPose(base,reference,next)]);if(changes.some(([,pose])=>!pose)){notice('Углы не должны пересекаться.');return;}for(const [f,pose] of changes){if(l.altFrames?.[f]){const before=bases[f],fields=new Set(l.altFrames[f].fields||[]);for(const key of ['x','y','scale','scaleX','scaleY','opacity','rotation','shake','blur','mirrorX','mirrorY'])if(Math.abs((pose[key]??(['scale','scaleX','scaleY','opacity','mirrorX','mirrorY'].includes(key)?1:0))-(before[key]??(['scale','scaleX','scaleY','opacity','mirrorX','mirrorY'].includes(key)?1:0)))>1e-8)fields.add(key);if(JSON.stringify(pose.corners)!==JSON.stringify(before.corners)||JSON.stringify(pose.warpBounds)!==JSON.stringify(before.warpBounds))fields.add('corners');l.altFrames[f]={...l.altFrames[f],pose,fields:[...fields]};}else{if(l.tweens.includes(+f)&&!l.drawings[f]&&!l.media)l.drawings[f]=cloneCanvas(drawingAt(l,+f));l.keys[f]=pose;}}const selected=new Set(Object.keys(bases).map(Number).filter(f=>!l.altFrames?.[f]));l.tweens=l.tweens.filter(f=>!selected.has(f));touchDrawing(l);}

function promoteFrame(l){if(l.altFrames?.[frame])return;if(l.tweens.includes(frame)){if(l.mapData&&!l.mapOwners[frame]){const span=tweenSpan(l.keys,frame,total,$('loop').checked);if(span)l.mapOwners[frame]=mapOwnersAt(l,span.t<.5?span.before:span.after).slice();}if(l.kind==='drawing'||l.kind==='image')l.drawings[frame]=cloneCanvas(drawingAt(l,frame));l.tweens=l.tweens.filter(f=>f!==frame);}}
function properties(){const l=selectedLayer();if(!l){document.querySelector('.tools').classList.remove('audio-mode');$('audioTools').hidden=true;$('brushSection').hidden=false;$('visualTransform').hidden=false;$('mediaControls').hidden=true;$('mapControls').hidden=true;$('noiseLevel').hidden=true;return;}const p=poseFor(l,frame);$('posX').value=Math.round(p.x);$('posY').value=Math.round(p.y);$('scale').value=Math.round(p.scale*100);$('aspectLock').setAttribute('aria-pressed',String(l.aspectLocked));$('aspectLock').textContent=l.aspectLocked?'🔒 Стороны связаны':'🔓 Связать стороны';const {sx,sy}=axisScales(p);$('scaleX').value=Math.round(Math.abs(sx)*100);$('scaleY').value=Math.round(Math.abs(sy)*100);$('opacity').value=Math.round(p.opacity*100);$('rotation').value=Math.round((p.rotation||0)*10)/10;for(const field of ['shake','blur']){$(field).value=p[field]??0;$(field+'Value').value=Math.round(p[field]??0)+(field==='blur'?'%':' px');}$('freeCorners').checked=l.freeCorners;updateStudioProperties(l);updateAudioTools(l);$('restoreVideoBg').hidden=l.kind!=='video'||!l.chroma?.enabled;if(l.kind==='video'&&l.chroma?.enabled){$('tolerance').value=l.chroma.tolerance;$('toleranceValue').value=l.chroma.tolerance;}}
function deleteLayerById(id){if(exporting)return;const l=layers.find(item=>item.id===id);if(!l)return;stop();checkpoint();l.media?.pause();layers=layers.filter(item=>item.id!==id);if(selected===id)selected=layers.at(-1)?.id;refresh();notice('Слой удалён · Z — отменить.');}
function reorderLayer(l,direction){const index=layers.indexOf(l),next=index+direction;if(next<0||next>=layers.length||layers[next].kind==='noise'&&l.kind!=='noise'||l.kind==='noise'&&layers[next].kind!=='noise')return;checkpoint();[layers[index],layers[next]]=[layers[next],layers[index]];refresh();}
function layerButtons(l){
 const group=document.createElement('span');group.className='layer-buttons';
 const button=(text,title,action)=>{const b=document.createElement('button');b.type='button';b.innerHTML=text;b.title=title;b.setAttribute('aria-label',title+' · '+l.name);b.onclick=e=>{e.stopPropagation();action();};group.append(b);return b;};
 const eye=button('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'+ (l.visible?'<path d="M3 3 21 21"/>':'')+'</svg>',l.visible?'Скрыть слой':'Показать слой',()=>{checkpoint();l.visible=!l.visible;syncMedia(frame,playing);refresh();});eye.setAttribute('aria-pressed',String(!l.visible));
 button('↑','Поднять слой',()=>reorderLayer(l,1));button('↓','Опустить слой',()=>reorderLayer(l,-1));button('×','Удалить слой',()=>deleteLayerById(l.id));return group;
}
function layerUI(){const parent=$('layers');parent.replaceChildren();for(const l of [...layers].reverse()){
 const row=document.createElement('div');row.className='layer'+(l.id===selected?' selected':'')+(!l.visible?' layer-hidden':'');row.dataset.layer=l.id;
 const icon=document.createElement('span');icon.className='layer-type';icon.textContent=l.kind==='audio'?'♫':l.kind==='video'?'▷':l.kind==='text'?'T':l.kind==='noise'?'◐':'▧';const name=document.createElement('span');name.className='layer-name';name.textContent=l.name;name.ondblclick=()=>{const value=prompt('Название слоя',l.name);if(value){checkpoint();l.name=value;refresh();}};
 row.append(icon,name,layerButtons(l));row.onclick=()=>{selectedLayerIds=new Set([l.id]);selected=l.id;refresh();showMediaSettings(l);};parent.append(row);
}}
const TRACK_LABEL=220;let timelineStart=0,timelineScrollLock=false,timelineMetrics=null;
function chooseFrame(f,l,e,drag=false){if(!drag){selectedLayerIds=new Set(l?[l.id]:[selected]);}if(drag&&f===frame&&(!l||l.id===selected))return;document.activeElement?.blur();if(l)selected=l.id;if(!drag)selectionAnchor=e.shiftKey?selectionAnchor:f;setFrame(f,drag||e.shiftKey);}
function frameCell(row,l,start,end,cellWidth,tweenLookup){
 const cell=document.createElement('div');cell.className='cell';cell.style.width=(end-start)*cellWidth+'px';cell.dataset.frame=start;
 let key=false,isA=false,isAlt=false,rangeSelected=false;for(let f=start;f<end;f++){if(l){isAlt||=Boolean(l.altFrames?.[f]);key||=Object.hasOwn(l.keys,f);isA||=tweenLookup?.has(f)??l.tweens.includes(f);}rangeSelected||=selectedFrames.has(f);}
 if(isAlt)cell.classList.add('alt-guide');if(key)cell.classList.add('key');else if(isA)cell.classList.add('tween');if(frame>=start&&frame<end)cell.classList.add('current');if(rangeSelected&&(!selectedLayerIds.size||!l||selectedLayerIds.has(l.id)))cell.classList.add('frame-selected');
 cell.textContent=l?(isAlt?'AltA':key?'◆':isA?'A':''):(end-start>1||start===0||(start+1)%5===0?start+1:'·');cell.title=(l?l.name+' · ':'')+'кадр '+(start+1)+(end>start+1?'–'+end:'')+(isAlt?' · AltA':'');
 const at=e=>Math.min(end-1,start+Math.max(0,Math.floor((e.clientX-cell.getBoundingClientRect().left)/cellWidth)));
 cell.onpointerdown=e=>{if(e.button!==0||exporting)return;e.preventDefault();frameDrag={layer:l?.id};chooseFrame(at(e),l,e);};
 cell.onpointermove=e=>{if(frameDrag&&e.buttons===1&&frameDrag.layer===l?.id)chooseFrame(at(e),l,e,true);};
 cell.onpointerenter=e=>{if(frameDrag&&e.buttons===1&&frameDrag.layer===l?.id)chooseFrame(at(e),l,e,true);};
 cell.ondblclick=()=>{if(l){selected=l.id;setFrame(start);addKey();}};row.append(cell);
}
function timeline(follow=true){
 const parent=$('tracks'),cellWidth=23*timelineZoom,step=Math.max(1,Math.ceil(4/cellWidth)),visible=Math.max(1,Math.floor((parent.clientWidth-TRACK_LABEL)/cellWidth)),count=Math.min(total,Math.max(120,visible+40*step)),virtualWidth=Math.min(total*cellWidth,8000000),compressed=virtualWidth<total*cellWidth,span=Math.max(0,virtualWidth-count*cellWidth),maxStart=Math.max(0,total-count);let scroll=parent.scrollLeft;
 let start=total<=count?0:follow?timelineStart:Math.max(0,Math.min(maxStart,compressed?Math.floor(scroll/Math.max(1,virtualWidth-parent.clientWidth)*maxStart):Math.floor(scroll/cellWidth)-8*step));
 if(follow&&(frame<start||frame>=start+Math.max(1,visible-8*step)))start=Math.max(0,Math.min(maxStart,frame-8*step));start=Math.max(0,Math.min(maxStart,start));timelineStart=start;
 const prefix=compressed?(maxStart?start/maxStart*span:0):start*cellWidth,suffix=Math.max(0,virtualWidth-prefix-count*cellWidth);
 if(follow&&(frame===0||frame<Math.floor(scroll/cellWidth)||frame>=Math.floor(scroll/cellWidth)+visible))scroll=prefix+Math.max(0,(frame-start)*cellWidth-(parent.clientWidth-TRACK_LABEL)/2);
 timelineMetrics={start,count,cellWidth,prefix};parent.replaceChildren();
 const space=(row,size)=>{if(size>0){const node=document.createElement('span');node.className='frame-spacer';node.style.width=size+'px';row.append(node);}};
 const makeRow=l=>{const row=document.createElement('div');row.className='track'+(l?.id===selected?' selected':'')+(l?.media?' media-track':'')+(l&&!l.visible?' layer-hidden':'');if(l)row.dataset.layer=l.id;const label=document.createElement('span');label.className='track-label';const name=document.createElement('span');name.className=l?'track-name':'track-ruler-name';name.textContent=l?.name||'КАДР / СЛОЙ';label.append(name);if(l){label.append(layerButtons(l));label.onclick=()=>{selectedLayerIds=new Set([l.id]);selected=l.id;refresh();showMediaSettings(l);};}row.append(label);space(row,prefix);return row;};
 const ruler=makeRow();for(let f=start;f<start+count;f+=step)frameCell(ruler,null,f,Math.min(start+count,f+step),cellWidth);space(ruler,suffix);parent.append(ruler);
 for(const l of [...layers].reverse()){
  const row=makeRow(l);if(l.media)mediaTrack(row,l,start,count,cellWidth);else{const lookup=new Set(l.tweens);for(let f=start;f<start+count;f+=step)frameCell(row,l,f,Math.min(start+count,f+step),cellWidth,lookup);}
  space(row,suffix);parent.append(row);
 }
 timelineScrollLock=true;parent.scrollLeft=scroll;requestAnimationFrame(()=>timelineScrollLock=false);$('frameJump').value=frame+1;$('timecode').textContent=`${String(frame+1).padStart(3,'0')} / ${String(total).padStart(3,'0')}`;$('timelineZoom').value=Math.round(timelineZoom*100);$('timelineZoomValue').value=timelineZoom.toFixed(2)+'×';
}
function mediaTrack(row,l,start,count,cellWidth){
 const lane=document.createElement('div');lane.className='media-lane';lane.style.width=count*cellWidth+'px';lane.dataset.layer=l.id;
 const at=e=>Math.max(0,Math.min(total-1,start+Math.floor((e.clientX-lane.getBoundingClientRect().left)/cellWidth)));
 lane.onclick=e=>{if(mediaGesture)return;selected=l.id;setFrame(at(e),e.shiftKey);showMediaSettings(l);};
 const clip=settingsFor(l),first=clip.start*fps,last=clipEnd(clip)*fps,left=Math.max(0,(first-start)*cellWidth),right=Math.min(count*cellWidth,(last-start)*cellWidth);
 if(right>left){const bar=document.createElement('div');bar.className='media-clip '+l.kind;bar.dataset.layer=l.id;bar.style.left=left+'px';bar.style.width=(right-left)+'px';bar.title=l.name+' · перетащите клип; края обрезают источник';
  const label=document.createElement('span');label.className='clip-name';label.textContent=(l.kind==='video'?'▷ ':'♫ ')+l.name;bar.append(label);
  const markers=document.createElement('canvas');markers.className='automation-markers';markers.width=Math.max(1,Math.ceil(right-left));markers.height=14;drawMediaMarkers(markers,l,(start+left/cellWidth)/fps,cellWidth);bar.append(markers);
  const wave=document.createElement('canvas');wave.className='waveform';wave.width=Math.max(1,Math.ceil(right-left));wave.height=l.kind==='audio'?34:16;wave.style.height=wave.height+'px';drawWaveform(wave,l,(start+left/cellWidth)/fps,1/(cellWidth*fps));bar.append(wave);
  if(!analysisCache.get(l.media)?.envelope){label.textContent+=' · '+(l.kind==='audio'?'анализ звука…':'видео');}
  const handle=(action,title)=>{const h=document.createElement('span');h.className='clip-handle '+action;h.title=title;h.setAttribute('role','slider');h.tabIndex=0;h.setAttribute('aria-label',title+' · '+l.name);h.setAttribute('aria-valuenow',String(action==='in'?clip.in:clip.out));h.setAttribute('aria-valuemin','0');h.setAttribute('aria-valuemax',String(l.media.duration));h.onpointerdown=e=>startMediaDrag(e,l,action,cellWidth);h.onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.code))return;e.preventDefault();e.stopPropagation();stop();checkpoint();l.clip=dragClip(settingsFor(l),action,(e.code==='ArrowRight'?1:-1)/fps,l.media.duration,fps);seekMedia();refresh();};bar.append(h);};
  if(first>=start&&first<=start+count)handle('in','Обрезать начало');if(last>=start&&last<=start+count)handle('out','Обрезать конец');
  bar.onpointerdown=e=>startMediaDrag(e,l,'move',cellWidth);bar.onclick=e=>e.stopPropagation();bar.onpointermove=e=>{if(!mediaGesture){const time=(start+(e.clientX-lane.getBoundingClientRect().left)/cellWidth)/fps,position=clipTime(clip,time),value=envelopeAt(analysisCache.get(l.media)?.envelope,position.source,position.source+1/fps*clip.speed,clip.volume);bar.title=`${l.name} · ${time.toFixed(2)} с · ${levelDb(value.rms).toFixed(1)} дБ · ${l.altFrames?.[Math.floor(time*fps)]?'AltA*':Object.hasOwn(l.keys,Math.floor(time*fps))||Object.hasOwn(l.audioKeys||{},Math.floor(time*fps))?'Q*':'A*'}`;}};lane.append(bar);
 }
 const marker=document.createElement('span');marker.className='media-playhead';marker.style.left=(frame-start)*cellWidth+'px';lane.append(marker);row.append(lane);
}
function drawWaveform(canvas,l,time,secondsPerPixel){
 const g=canvas.getContext('2d'),envelope=analysisCache.get(l.media)?.envelope,clip=settingsFor(l),middle=canvas.height/2;g.strokeStyle='#d4c3ff';g.beginPath();
 for(let x=0;x<canvas.width;x++){const a=clipTime(clip,time+x*secondsPerPixel).source,b=clipTime(clip,time+(x+1)*secondsPerPixel).source,value=envelopeAt(envelope,a,b,clip.volume*audioFor(l,(time+x*secondsPerPixel)*fps).volume),peak=Math.min(1,value.peak)*middle;g.moveTo(x+.5,middle-peak);g.lineTo(x+.5,middle+peak);}g.stroke();g.strokeStyle='#adf086';g.beginPath();
 for(let x=0;x<canvas.width;x++){const a=clipTime(clip,time+x*secondsPerPixel).source,b=clipTime(clip,time+(x+1)*secondsPerPixel).source,height=Math.min(1,envelopeAt(envelope,a,b,clip.volume*audioFor(l,(time+x*secondsPerPixel)*fps).volume).rms)*middle;g.moveTo(x+.5,middle-height);g.lineTo(x+.5,middle+height);}g.stroke();
}
function drawMediaMarkers(canvas,l,startTime,cellWidth){
 const g=canvas.getContext('2d'),first=Math.floor(startTime*fps),last=Math.ceil(first+canvas.width/cellWidth),keys=new Set([...Object.keys(l.keys),...Object.keys(l.audioKeys||{})].map(Number));g.font='8px Arial';g.textBaseline='top';
 for(let f=first;f<=last;f++){const alt=l.altFrames?.[f],q=keys.has(f),x=(f-first)*cellWidth;g.fillStyle=alt?'#75efff':q?'#ffe38a':'#d0bee8';if(cellWidth>=18)g.fillText(alt?'AltA*':q?'Q*':'A*',x+2,1,cellWidth-3);else if(q||alt)g.fillRect(x,1,Math.max(1,cellWidth),10);}
}

function startMediaDrag(e,l,action,cellWidth){
 if(e.button!==0||exporting)return;e.preventDefault();e.stopPropagation();document.activeElement?.blur();if(e.shiftKey&&action==='move'){const lane=e.currentTarget.closest('.media-lane'),f=Math.max(0,Math.min(total-1,timelineMetrics.start+Math.floor((e.clientX-lane.getBoundingClientRect().left)/cellWidth)));selected=l.id;frameDrag={layer:l.id,media:true};setFrame(f,true);return;}stop();selected=l.id;properties();layerUI();showMediaSettings(l);mediaGesture={l,action,cellWidth,x:e.clientX,clip:{...settingsFor(l)},changed:false};e.currentTarget.setPointerCapture(e.pointerId);
}
document.addEventListener('pointermove',e=>{if(frameDrag?.media&&e.buttons===1){const lane=$('tracks').querySelector(`.media-lane[data-layer="${frameDrag.layer}"]`);if(lane){const f=Math.max(0,Math.min(total-1,timelineMetrics.start+Math.floor((e.clientX-lane.getBoundingClientRect().left)/timelineMetrics.cellWidth)));if(f!==frame)setFrame(f,true);}}const drag=mediaGesture;if(!drag)return;const delta=(e.clientX-drag.x)/(drag.cellWidth*fps);if(!drag.changed&&Math.abs(e.clientX-drag.x)<3)return;if(!drag.changed){checkpoint();drag.changed=true;}drag.l.clip=dragClip(drag.clip,drag.action,delta,drag.l.media.duration,fps);const bar=$('tracks').querySelector(`.media-clip[data-layer="${drag.l.id}"]`),m=timelineMetrics;if(bar&&m){const c=drag.l.clip,left=Math.max(0,(c.start*fps-m.start)*m.cellWidth),right=Math.min(m.count*m.cellWidth,(clipEnd(c)*fps-m.start)*m.cellWidth);bar.style.left=left+'px';bar.style.width=Math.max(1,right-left)+'px';}properties();seekMedia();paint();});
function finishMediaDrag(){if(!mediaGesture)return;const drag=mediaGesture;mediaGesture=null;if(drag.changed){total=Math.max(total,Math.ceil(clipEnd(settingsFor(drag.l))*fps));$('duration').value=total;}refresh();}
document.addEventListener('pointerup',()=>{frameDrag=null;finishMediaDrag();});
document.addEventListener('pointercancel',()=>{frameDrag=null;finishMediaDrag();});
function setTimelineZoom(value){timelineZoom=Math.max(.02,Math.min(1,value));timelineStart=Math.max(0,frame-8);timeline();}
$('timelineZoom').oninput=()=>setTimelineZoom(Number($('timelineZoom').value)/100);
for(const target of [$('tracks'),$('layers')])target.addEventListener('wheel',e=>{if(exporting||e.deltaY===0||(target===$('tracks')&&!e.target.closest('.track-label')))return;e.preventDefault();setTimelineZoom(timelineZoom*Math.exp(-e.deltaY*.002));},{passive:false});
$('tracks').addEventListener('scroll',()=>{if(!timelineScrollLock&&total>120)timeline(false);},{passive:true});

function refresh(){if(!selectedLayerIds.has(selected))selectedLayerIds=new Set([selected]);paint();properties();layerUI();timeline();}
function setFrame(f,extend=false){if(exporting)return;stop();frame=Math.max(0,Math.min(total-1,f));if(extend){selectedFrames=new Set(Array.from({length:Math.abs(frame-selectionAnchor)+1},(_,i)=>Math.min(frame,selectionAnchor)+i));}else{selectedFrames=new Set([frame]);selectionAnchor=frame;}if(nHeld)convertToTween();if(vHeld)pasteFrames();seekMedia();refresh();}
function settingsFor(l){return clipSettings(l.clip,l.media?.duration);}
function syncMedia(f,run=false){
 for(const l of layers){if(!l.media)continue;const clip=settingsFor(l),automation=audioFor(l,f),position=clipTime(clip,f/fps),active=l.visible&&position.active,media=l.media;media.playbackRate=clip.speed;media.preservesPitch=!clip.pitch;
  const gain=mediaGains.get(media);if(gain)gain.gain.value=active?clip.volume*automation.volume:0;const pitch=mediaPitches.get(media);if(pitch)pitch.parameters.get('ratio').value=2**(automation.pitch/12);if(!gain)media.volume=active?Math.min(1,clip.volume*automation.volume):0;
  if(Number.isFinite(media.duration)&&(!run||!active||Math.abs(media.currentTime-position.source)>.15)&&Math.abs(media.currentTime-position.source)>.0005)media.currentTime=position.source;
  if(run&&active){if(media.paused&&!l.playRequested){l.playRequested=true;media.play().catch(()=>{}).finally(()=>l.playRequested=false);}}else media.pause();
 }
}
function seekMedia(){syncMedia(frame,false);}

function stop(){playing=false;playbackRun++;$('play').textContent='▶';for(const l of layers)l.media?.pause();}
async function play(){
 if(playing){stop();return;}
 if(frame===total-1)frame=0;
 if(layers.some(l=>l.media&&l.visible))await ensureAudioGraph();
 playing=true;const run=++playbackRun;$('play').textContent='Ⅱ';seekMedia();
 const startMedia=()=>syncMedia(frame,true);
 startMedia();const start=performance.now()-frame/fps*1000;let cycle=0;
 function tick(now){
  if(!playing||run!==playbackRun)return;
  const elapsed=Math.floor((now-start)*fps/1000),nextCycle=Math.floor(elapsed/total);
  if(!$('loop').checked&&nextCycle>cycle){frame=total-1;paint();properties();timeline();stop();return;}
  frame=elapsed%total;
  if(nextCycle!==cycle){cycle=nextCycle;seekMedia();startMedia();}
  syncMedia(frame,true);paint();properties();timeline();requestAnimationFrame(tick);
 }
 requestAnimationFrame(tick);
}

function insertFrame(kind){
 const l=selectedLayer();if(!l||exporting)return;
 stop();checkpoint();const at=frame+1,audioKey=l.media?audioFor(l,frame):null,owners=l.mapData?mapOwnersAt(l,frame).slice():null,pose=poseFor(l,frame),image=kind==='key'&&(l.kind==='drawing'||l.mapData)?cloneCanvas(drawingAt(l,frame)):null;
 layers=layers.map(layer=>remapFrames(layer,f=>f>=at?f+1:f));
 const target=selectedLayer();if(kind==='key'){target.keys[at]={...pose};if(target.media){target.audioKeys={...target.audioKeys,[at]:audioKey};}if(image)target.drawings[at]=image;if(owners)target.mapOwners[at]=owners;}else if(!target.autoTween)target.tweens.push(at);
 total++;frame=at;selectedFrames=new Set([frame]);selectionAnchor=frame;$('duration').value=total;seekMedia();refresh();
 notice(`${kind==='key'?'Ключевой':'A-'} кадр вставлен на позиции ${frame+1}. Следующие кадры сдвинуты вправо.`);
}
function addKey(){insertFrame('key');}
function addTween(){insertFrame('tween');}
function convertToAltA(){
 const l=selectedLayer();if(!l||exporting)return;const candidates=[...selectedFrames].filter(f=>!Object.hasOwn(l.keys,f)&&!Object.hasOwn(l.audioKeys||{},f)&&!l.altFrames?.[f]&&(l.autoTween||l.tweens.includes(f)));if(!candidates.length)return;
 const records=candidates.map(f=>[f,{pose:structuredClone(poseFor(l,f)),fields:[],audioFields:[],...(l.media?{audio:audioFor(l,f)}:{}),bitmapEdited:false}]);stop();checkpoint();l.altFrames={...l.altFrames,...Object.fromEntries(records)};touchDrawing(l);refresh();notice('AltA: редактируйте опорную точку кривой. N возвращает A.');
}
function convertToTween(){
 const plans=layers.filter(l=>selectedLayerIds.has(l.id)||l.id===selected).map(l=>({l,existing:new Set(l.tweens),targets:[...selectedFrames].filter(f=>l.altFrames?.[f]||(l.media?Object.hasOwn(l.keys,f)||Object.hasOwn(l.audioKeys||{},f):!l.tweens.includes(f)))})).filter(p=>p.targets.length);if(!plans.length)return;stop();if(!nHeld||!nCheckpoint){checkpoint();if(nHeld)nCheckpoint=true;}let count=0;
 for(const {l,existing,targets} of plans){if(l.audioKeys)l.audioKeys={...l.audioKeys};for(const f of targets){if(l.altFrames)delete l.altFrames[f];delete l.keys[f];delete l.drawings[f];if(l.audioKeys)delete l.audioKeys[f];if(l.mapOwners)delete l.mapOwners[f];if(!l.media&&!existing.has(f))l.tweens.push(f);count++;}touchDrawing(l);}seekMedia();refresh();notice(`Преобразовано в A-кадры: ${count}.`);
}

function deleteFrames(){
 if(exporting)return;const removed=[...selectedFrames].filter(f=>f>=0&&f<total).sort((a,b)=>a-b);if(!removed.length)return;
 stop();checkpoint();const gone=new Set(removed),start=removed[0];
 layers=layers.map(l=>remapFrames(l,f=>gone.has(f)?null:f-removed.filter(n=>n<f).length));
 total=Math.max(1,total-removed.length);frame=Math.min(start,total-1);selectedFrames=new Set([frame]);selectionAnchor=frame;$('duration').value=total;seekMedia();refresh();
 notice(`Удалено кадров: ${removed.length}. Следующие кадры сдвинуты влево.${removed.length===gone.size&&total===1?' В проекте остаётся минимум один кадр.':''}`);
}
function addLayer(){if(exporting)return;stop();checkpoint();const l=newLayer(`${translate('Рисунок')} ${layers.length+1}`);if(frame!==0){l.keys={[frame]:initialPose()};l.drawings={[frame]:l.canvas};}appendLayer(l);selected=l.id;refresh();notice('Добавлен новый слой · Backspace — удалить.');}
function deleteLayer(){deleteLayerById(selected);}
function copyFrames(){const l=selectedLayer();if(!l)return;const start=Math.min(...selectedFrames);clipboard=[...selectedFrames].sort((a,b)=>a-b).map(f=>({offset:f-start,key:l.keys[f]?structuredClone(l.keys[f]):null,alt:l.altFrames?.[f]?structuredClone(l.altFrames[f]):null,audioKey:l.audioKeys?.[f]?structuredClone(l.audioKeys[f]):null,tween:l.autoTween?!Object.hasOwn(l.keys,f)&&!Object.hasOwn(l.audioKeys||{},f):l.tweens.includes(f),ownerCodes:l.ownerCodes,owners:l.mapData?mapOwnersAt(l,f).slice():null,drawing:l.drawings[f]?cloneCanvas(l.drawings[f]):null}));notice(`Скопировано кадров: ${clipboard.length} · V — вставить.`);}
function pasteFrames(){
 const l=selectedLayer();if(!l||!clipboard?.length||exporting)return;const selection=[...selectedFrames].sort((a,b)=>a-b),pattern=clipboard,span=Math.max(...pattern.map(c=>c.offset))+1;
 let items;if(selection.length>1)items=selection.map((f,i)=>({f,c:pattern[i%pattern.length]}));else items=pattern.map(c=>({f:frame+c.offset,c}));
 if(vHeld)items=items.filter(({f})=>!vApplied.has(l.id+':'+f));if(!items.length)return;
 if(!vHeld||!vCheckpoint){checkpoint();if(vHeld)vCheckpoint=true;}if(l.audioKeys)l.audioKeys={...l.audioKeys};const cleared=new Set(items.map(({f})=>f));l.tweens=l.tweens.filter(f=>!cleared.has(f));
 for(const {f,c} of items){if(l.altFrames)delete l.altFrames[f];delete l.keys[f];delete l.drawings[f];if(l.audioKeys)delete l.audioKeys[f];if(l.mapOwners)delete l.mapOwners[f];if(c.alt){l.altFrames??={};l.altFrames[f]=structuredClone(c.alt);}if(c.key)l.keys[f]=structuredClone(c.key);if(c.audioKey&&l.media){l.audioKeys??={};l.audioKeys[f]=structuredClone(c.audioKey);}if(c.tween&&!l.autoTween)l.tweens.push(f);if(c.drawing&&!l.media)l.drawings[f]=cloneCanvas(c.drawing);
  if(l.mapData&&c.owners){const owners=c.owners.slice();for(let i=0;i<owners.length;i++)owners[i]=l.baseOwners[i]&&owners[i]?Math.max(0,l.ownerCodes.indexOf(c.ownerCodes[owners[i]-1])+1):0;l.mapOwners[f]=owners;}total=Math.max(total,f+1);if(vHeld)vApplied.add(l.id+':'+f);
 }
 touchDrawing(l);if(!vHeld&&selection.length===1)selectedFrames=new Set(items.map(({f})=>f));$('duration').value=total;seekMedia();refresh();notice(`Вставлено кадров: ${items.length}.`);
}

function coords(e){const r=stage.getBoundingClientRect();return{x:(e.clientX-r.left)*W/r.width,y:(e.clientY-r.top)*H/r.height};}
function local(p,l){return transformPoint(p,poseFor(l,frame),true);}
function rgba(){const s=$('color').value;return [parseInt(s.slice(1,3),16),parseInt(s.slice(3,5),16),parseInt(s.slice(5,7),16),255];}
stage.onpointerdown=e=>{if(exporting||e.button!==0)return;stop();let l=selectedLayer();if(tool==='text'){beginText(coords(e));return;}if(!l||l.kind==='audio')return;const p=coords(e);if(l.kind==='noise')return;checkpoint(l);stage.setPointerCapture(e.pointerId);if(tool==='move'){let pose=poseFor(l,frame);const bounds=contentBounds(l);if(!bounds)return;const radius=14*W/stage.getBoundingClientRect().width;const bases=selectionPoses(l);const handle=editHandles(pose).find(h=>Math.hypot(h.point.x-p.x,h.point.y-p.y)<=radius);if(handle?.kind==='flipX'||handle?.kind==='flipY'){flipSelection(l,handle.kind==='flipX'?'mirrorX':'mirrorY',bounds);return;}if(handle?.kind==='corner'){pose={...pose,warpBounds:bounds,corners:rectCorners(bounds).map(v=>pose.corners?warpPoint(v,pose.corners,false,pose.warpBounds):v)};}promoteFrame(l);if(l.altFrames?.[frame])l.altFrames[frame]={...l.altFrames[frame],pose:{...pose}};else l.keys[frame]={...pose};const anchor={x:bounds.x+bounds.w/2,y:bounds.y+bounds.h/2};gesture={l,bases,start:p,pose,bounds,anchor,action:handle?.kind||'move',handle,center:transformPoint(anchor,pose)};return;}if(l.kind==='video'){if(tool!=='remove'){notice('Для рисования поверх видео добавьте отдельный слой.');return;}const q=local(p,l),x=Math.floor(q.x),y=Math.floor(q.y);if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>=W||y>=H)return;const pixel=videoSurface(l,true).getContext('2d').getImageData(x,y,1,1).data;if(!pixel[3]){notice('Нажмите на цвет внутри видео.');return;}l.chroma={enabled:true,color:Array.from(pixel.slice(0,3)),tolerance:+$('tolerance').value};l.videoCacheKey=null;refresh();notice('Цвет удаляется на всех кадрах видео. Настройте допуск при необходимости.');return;}if(tool==='territory'&&!l.mapData){notice('Выберите слой карты.');return;}if(l.mapData&&!l.mapOwners[frame]&&l.tweens.includes(frame)){const span=tweenSpan(l.keys,frame,total,$('loop').checked);if(span)l.mapOwners[frame]=mapOwnersAt(l,span.t<.5?span.before:span.after).slice();}const c=editCanvas(l),g=c.getContext('2d',{willReadFrequently:true}),q=local(p,l);if(tool==='fill'||tool==='remove'){const d=g.getImageData(0,0,W,H);if(tool==='fill')floodFill(d.data,W,H,q.x,q.y,rgba());else{const x=Math.floor(q.x),y=Math.floor(q.y);if(x<0||y<0||x>=W||y>=H)return;const o=(y*W+x)*4;removeColor(d.data,Array.from(d.data.slice(o,o+4)),+$('tolerance').value);}g.putImageData(d,0,0);refresh();return;}gesture={l,g,last:q,seed:Math.random()*10000};stroke(g,q,q);if($('brushShape').value==='spray')gesture.sprayTimer=setInterval(()=>{if(gesture?.g){stroke(gesture.g,gesture.last,gesture.last);paint();}},65);refresh();};
const brushStamp=document.createElement('canvas');
function stroke(g,a,b){
 if(gesture?.l)touchDrawing(gesture.l,g.canvas);const shape=$('brushShape').value,size=+$('brush').value,variation=tool==='eraser'?0:+$('colorVariation').value/100,base=rgba().slice(0,3),seed=gesture?.seed||0;
 const shade=(x,y)=>{const rgb=varyColor(base,variation,spatialNoise(x,y,seed));return `rgb(${rgb.join(',')})`;};
 if(tool==='territory'){territoryStroke(gesture.l,g.canvas,a,b,size,frame);return;}
 g.save();g.globalCompositeOperation=tool==='eraser'?'destination-out':'source-over';
 if(shape==='circle'&&!variation){g.strokeStyle=$('color').value;g.lineWidth=size;g.lineCap='round';g.lineJoin='round';g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x+.001,b.y+.001);g.stroke();}
 else{
  const distance=Math.hypot(b.x-a.x,b.y-a.y),steps=Math.max(1,Math.ceil(distance/Math.max(1,size*(shape==='spray'?.2:.12))));
  for(let i=0;i<=steps;i++){
   const t=i/steps,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;
   if(shape==='spray'){
    const dots=Math.max(8,Math.round(size*.7)),dot=Math.max(.6,size/35);
    for(let n=0;n<dots;n++){const angle=Math.random()*Math.PI*2,r=Math.sqrt(Math.random())*size/2,px=x+Math.cos(angle)*r,py=y+Math.sin(angle)*r;g.fillStyle=shade(px,py);g.beginPath();g.arc(px,py,dot/2,0,Math.PI*2);g.fill();}
   }else if(variation){
    const extent=Math.ceil(size),left=x-extent/2,top=y-extent/2;brushStamp.width=extent;brushStamp.height=extent;
    const sg=brushStamp.getContext('2d'),pixels=sg.createImageData(extent,extent);
    for(let py=0;py<extent;py++)for(let px=0;px<extent;px++){
     const coverage=shape==='square'?1:Math.max(0,Math.min(1,size/2-Math.hypot(px+.5-extent/2,py+.5-extent/2)+.5));if(!coverage)continue;
     const rgb=varyColor(base,variation,spatialNoise(left+px+.5,top+py+.5,seed)),offset=(py*extent+px)*4;
     pixels.data.set([...rgb,Math.round(coverage*255)],offset);
    }
    sg.putImageData(pixels,0,0);g.drawImage(brushStamp,left,top);
   }else{
    g.fillStyle=shade(x,y);
    if(shape==='square')g.fillRect(x-size/2,y-size/2,size,size);
    else{g.beginPath();g.arc(x,y,size/2,0,Math.PI*2);g.fill();}
   }
  }
 }
 g.restore();
}
stage.onpointermove=e=>{if(!gesture)return;const p=coords(e),g=gesture;if(tool==='move'){let next={...g.pose};if(g.action==='corner'){const angle=(g.pose.rotation||0)*Math.PI/180,dx=p.x-g.start.x,dy=p.y-g.start.y,{sx,sy}=axisScales(g.pose),corners=cornersOf(g.pose).map(v=>({...v}));corners[g.handle.index].x+=(dx*Math.cos(angle)+dy*Math.sin(angle))/sx;corners[g.handle.index].y+=(-dx*Math.sin(angle)+dy*Math.cos(angle))/sy;if(validCorners(corners))next.corners=corners;else{notice('Углы не должны пересекаться.');return;}}else if(['resize','width','height'].includes(g.action)){const angle=(g.pose.rotation||0)*Math.PI/180,dx=p.x-g.start.x,dy=p.y-g.start.y,localX=dx*Math.cos(angle)+dy*Math.sin(angle),localY=-dx*Math.sin(angle)+dy*Math.cos(angle),axes={sx:Math.abs(axisScales(g.pose).sx),sy:Math.abs(axisScales(g.pose).sy)};let sx=g.action==='height'?axes.sx:Math.max(.01,axes.sx+g.handle.dx*2*localX/g.bounds.w),sy=g.action==='width'?axes.sy:Math.max(.01,axes.sy+g.handle.dy*2*localY/g.bounds.h);if(g.l.aspectLocked){const value=g.action==='height'?sy:g.action==='width'?sx:Math.abs(localX/W)>=Math.abs(localY/H)?sx:sy;sx=value;sy=value;}next.scaleX=sx/g.pose.scale;next.scaleY=sy/g.pose.scale;const moved=transformPoint(g.anchor,next);next.x+=g.center.x-moved.x;next.y+=g.center.y-moved.y;}else if(g.action==='rotate'){const center=g.center;const a=Math.atan2(p.y-center.y,p.x-center.x)-Math.atan2(g.start.y-center.y,g.start.x-center.x);next.rotation=(g.pose.rotation||0)+Math.atan2(Math.sin(a),Math.cos(a))*180/Math.PI;const moved=transformPoint(g.anchor,next);next.x+=g.center.x-moved.x;next.y+=g.center.y-moved.y;}else{next.x+=p.x-g.start.x;next.y+=p.y-g.start.y;}applyGroupTransform(g.l,g.bases,g.pose,next);properties();}else{const q=local(p,g.l);stroke(g.g,g.last,q);g.last=q;}paint();};
stage.onpointerup=stage.onpointercancel=()=>{if(gesture){clearInterval(gesture.sprayTimer);gesture=null;refresh();}};
const names={move:'↖ Редактировать',pencil:'✎ Карандаш',fill:'◩ Заливка',eraser:'▱ Ластик',remove:'✂ Удаление цвета',text:'T Текст',territory:'⚑ Кисть территорий'};
function selectTool(t){tool=t;document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===t));$('toolName').textContent=names[t];stage.style.cursor=t==='move'?'move':'crosshair';paint();}
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>selectTool(b.dataset.tool));
function scaleValue(id,fallback){const value=Number($(id).value)/100;return Number.isFinite(value)&&value>0?Math.max(.01,value):fallback;}
for(const field of ['shake','blur']){let editing=null;$(field).oninput=()=>{const l=selectedLayer();if(!l||exporting)return;if(!editing){checkpoint();editing={l,p:poseFor(l,frame),bases:selectionPoses(l)};}const {p,bases}=editing;applyGroupTransform(l,bases,p,{...p,[field]:Number($(field).value)});$(field+'Value').value=$(field).value+(field==='blur'?'%':' px');paint();};$(field).onchange=()=>{if(!editing)$(field).oninput();editing=null;refresh();};}
for(const id of ['posX','posY','scale','scaleX','scaleY','opacity','rotation'])$(id).onchange=()=>{
 const l=selectedLayer();if(!l)return;checkpoint();const p=poseFor(l,frame),axes={sx:Math.abs(axisScales(p).sx),sy:Math.abs(axisScales(p).sy)},bases=selectionPoses(l);promoteFrame(l);
 const next={...p,x:Number($('posX').value)||0,y:Number($('posY').value)||0,scale:scaleValue('scale',p.scale),opacity:Math.max(0,Math.min(1,Number($('opacity').value)/100)),rotation:Number($('rotation').value)||0};
 if(id==='scaleX'||id==='scaleY'){
  let sx=scaleValue('scaleX',axes.sx),sy=scaleValue('scaleY',axes.sy);
  if(l.aspectLocked){const value=id==='scaleX'?sx:sy;sx=value;sy=value;}
  next.scaleX=sx/next.scale;next.scaleY=sy/next.scale;
 }
 if(['scale','scaleX','scaleY','rotation'].includes(id)){const bounds=contentBounds(l);if(bounds){const anchor={x:bounds.x+bounds.w/2,y:bounds.y+bounds.h/2},before=transformPoint(anchor,p),after=transformPoint(anchor,next);next.x+=before.x-after.x;next.y+=before.y-after.y;}}
 applyGroupTransform(l,bases,p,next);refresh();
};
$('aspectLock').onclick=()=>{
 const l=selectedLayer();if(!l||exporting)return;checkpoint();l.aspectLocked=!l.aspectLocked;
 if(l.aspectLocked){const p=poseFor(l,frame);promoteFrame(l);applyGroupTransform(l,selectionPoses(l),p,{...p,scaleY:p.scaleX??1});}
 refresh();notice(l.aspectLocked?'Замок включён: ширина и высота масштабируются одинаково.':'Замок выключен: стороны меняются независимо.');
};
$('freeCorners').onchange=()=>{const l=selectedLayer();if(!l)return;checkpoint();l.freeCorners=$('freeCorners').checked;selectTool('move');refresh();notice(l.freeCorners?'Свободные углы: тяните оранжевые маркеры. Переходы сохраняются на A-кадрах.':'Обычное масштабирование включено.');};
$('resetCorners').onclick=()=>{const l=selectedLayer();if(!l)return;checkpoint();const pose=poseFor(l,frame);promoteFrame(l);applyGroupTransform(l,selectionPoses(l),pose,{...pose,corners:rectCorners(pose.warpBounds)});refresh();};
$('restoreVideoBg').onclick=()=>{const l=selectedLayer();if(!l?.chroma)return;checkpoint();l.chroma.enabled=false;l.videoCacheKey=null;refresh();notice('Фон видео восстановлен.');};
$('tolerance').onpointerdown=()=>{if(selectedLayer()?.kind==='video'&&selectedLayer()?.chroma?.enabled)checkpoint();};
$('addLayer').onclick=addLayer;$('deleteLayer').onclick=deleteLayer;
$('addAlt').onclick=convertToAltA;$('addKey').onclick=addKey;$('addTween').onclick=addTween;$('undo').onclick=undo;$('redo').onclick=redo;$('deleteKey').onclick=deleteFrames;
stage.addEventListener('wheel',e=>{if(!['pencil','eraser','territory'].includes(tool)||exporting)return;e.preventDefault();const v=Math.max(1,Math.min(500,+$('brush').value+(e.deltaY<0?1:e.deltaY>0?-1:0)*Number($('brushWheelSpeed').value)));$('brush').value=v;$('brushValue').value=v+' px';updateBrushCursor();notice(`${tool==='eraser'?'Ластик':'Кисть'}: ${v} px`);},{passive:false});
$('brushShape').onchange=()=>{updateBrushCursor();notice('Кисть: '+$('brushShape').selectedOptions[0].textContent);};
$('colorVariation').oninput=()=>$('variationValue').value=$('colorVariation').value+'%';
function renderCustomPalette(){const parent=$('customPalette');parent.replaceChildren();for(const color of customPalette){const button=document.createElement('button');button.type='button';button.dataset.palette=color;button.style.setProperty('--swatch',color);button.title=color;button.setAttribute('aria-label',color);button.onclick=()=>{$('color').value=color;syncPalette();};parent.append(button);}syncPalette();saveBrushPreferences();}
$('addPaletteColor').onclick=()=>{const color=$('color').value.toLowerCase();if(!customPalette.includes(color)&&!document.querySelector(`.palette>[data-palette="${color}"]`))customPalette.push(color);renderCustomPalette();};
$('brushWheelSpeed').value=Math.max(1,Math.min(10,Number(brushPreferences.wheel)||3));$('brushWheelSpeedValue').value=$('brushWheelSpeed').value+'×';$('brushWheelSpeed').oninput=()=>{$('brushWheelSpeedValue').value=$('brushWheelSpeed').value+'×';saveBrushPreferences();};
function syncPalette(){document.querySelectorAll('[data-palette]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.palette===$('color').value.toLowerCase())));}
$('color').addEventListener('input',syncPalette);
document.querySelectorAll('[data-palette]').forEach(b=>b.onclick=()=>{$('color').value=b.dataset.palette;syncPalette();notice('Цвет: '+b.title);});
$('brush').oninput=()=>{$('brushValue').value=$('brush').value+' px';updateBrushCursor();};$('tolerance').oninput=()=>{$('toleranceValue').value=$('tolerance').value;const l=selectedLayer();if(l?.kind==='video'&&l.chroma?.enabled){l.chroma={...l.chroma,tolerance:+$('tolerance').value};l.videoCacheKey=null;paint();}};
function changeFps(value,snap=false){
 stop();let next=Math.max(1,Math.min(240,Math.round(Number(value))||24));
 if(snap){const near=[12,24,60,144].find(v=>Math.abs(v-next)<=3);if(near)next=near;}
 fps=next;$('fps').value=fps;$('fpsSlider').value=fps;
 for(const l of layers)if(l.media&&Number.isFinite(l.media.duration))total=Math.max(total,Math.ceil(clipEnd(settingsFor(l))*fps));
 $('duration').value=total;seekMedia();refresh();
}
$('fps').onchange=()=>changeFps($('fps').value);
$('fpsSlider').oninput=()=>changeFps($('fpsSlider').value,true);
document.querySelectorAll('[data-fps]').forEach(button=>button.onclick=()=>changeFps(button.dataset.fps));
$('frameJump').onchange=()=>setFrame(Math.round(Number($('frameJump').value)||1)-1);
$('duration').onchange=()=>{const value=Math.round(+$('duration').value);if(!Number.isSafeInteger(value)||value<1){$('duration').value=total;notice('Укажите целое положительное число кадров.');return;}checkpoint();stop();total=value;$('duration').value=total;frame=Math.min(frame,total-1);selectedFrames=new Set([frame]);selectionAnchor=frame;seekMedia();refresh();};
$('loop').addEventListener('change',()=>{refresh();notice($('loop').checked?'Повтор включён: конечные A-кадры переходят к первому ключу.':'Повтор выключен.');});
$('first').onclick=()=>setFrame(0);$('last').onclick=()=>setFrame(total-1);$('play').onclick=play;$('onion').onclick=()=>{onion=!onion;$('onion').classList.toggle('active',onion);paint();};$('fit').onclick=()=>{fitCanvas();notice('Холст вписан в рабочую область.');};
function readData(file){return new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=no;r.readAsDataURL(file);});}
async function loadAsset(src,name,type){const kind=type.startsWith('audio/')?'audio':type.startsWith('video/')?'video':'image',l=newLayer(name,kind);l.src=src;l.mime=type;if(kind==='image'){const img=new Image();await new Promise((ok,no)=>{img.onload=ok;img.onerror=no;img.src=src;});l.original=img;const s=Math.min(W/img.width,H/img.height,1);l.canvas.getContext('2d').drawImage(img,(W-img.width*s)/2,(H-img.height*s)/2,img.width*s,img.height*s);if(type==='image/gif')notice('GIF импортирован как статичное изображение. Для анимированного источника используйте MP4.');}else{const media=document.createElement(kind==='audio'?'audio':'video');media.preload='auto';media.playsInline=true;await new Promise((ok,no)=>{media.onloadeddata=ok;media.onerror=()=>no(Error('Браузер не поддерживает кодек файла'));media.src=src;media.load();});l.media=media;l.autoTween=true;l.keys={};l.audioKeys={};l.clip=clipSettings({},media.duration);decodeAnalysis(l);
 media.onseeked=()=>{if(!playing)paint();};}return l;}
let micRecorder=null,micStream=null,micTimer=null,micStarted=0,micPending=false;
function releaseMicrophone(){clearInterval(micTimer);micTimer=null;micStream?.getTracks().forEach(track=>track.stop());micStream=null;}
function micIdle(){micRecorder=null;micPending=false;$('microphone').disabled=false;$('microphone').textContent='🎙 Записать звук';$('microphone').setAttribute('aria-pressed','false');$('recordTime').textContent='';}
$('microphone').onclick=async()=>{
 if(exporting||micPending)return;
 if(micRecorder?.state==='recording'){micRecorder.stop();releaseMicrophone();return;}
 if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){notice('Микрофон недоступен. Откройте редактор через HTTPS или localhost в браузере с поддержкой записи.');return;}
 stop();micPending=true;$('microphone').disabled=true;notice('Разрешите доступ к микрофону в браузере.');
 try{
  micStream=await navigator.mediaDevices.getUserMedia({audio:true});
  const mime=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
  const rec=new MediaRecorder(micStream,mime?{mimeType:mime}:{}),chunks=[];let failed=false;
  micRecorder=rec;rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  rec.onerror=()=>{failed=true;releaseMicrophone();micIdle();notice('Ошибка записи микрофона. Попробуйте записать звук ещё раз.');};
  rec.onstop=async()=>{
   releaseMicrophone();micPending=true;$('microphone').disabled=true;$('microphone').textContent='Обработка записи…';
   let decoder;
   try{
    if(failed||!chunks.length)throw Error('Нет записанного звука');
    decoder=new AudioContext();const audio=await decoder.decodeAudioData(await new Blob(chunks,{type:rec.mimeType}).arrayBuffer());
    const wav=encodeWav(Array.from({length:audio.numberOfChannels},(_,i)=>audio.getChannelData(i)),audio.sampleRate);
    const src=await readData(new Blob([wav],{type:'audio/wav'}));const layer=await loadAsset(src,`Микрофон ${layers.filter(l=>l.kind==='audio').length+1}`,'audio/wav');
    checkpoint();layers.push(layer);selected=layer.id;total=Math.max(total,Math.ceil(audio.duration*fps));$('duration').value=total;seekMedia();refresh();notice(`Запись добавлена отдельным слоем: ${audio.duration.toFixed(1)} с. Кнопка ▶ — прослушать.`);
   }catch(err){notice('Не удалось сохранить запись: '+err.message);}
   finally{if(decoder)await decoder.close().catch(()=>{});micIdle();}
  };
  rec.start();micStarted=performance.now();micPending=false;$('microphone').disabled=false;$('microphone').textContent='■ Остановить запись';$('microphone').setAttribute('aria-pressed','true');
  const update=()=>{const seconds=(performance.now()-micStarted)/1000;$('recordTime').textContent=`● Запись ${seconds.toFixed(1)} с`;};
  update();micTimer=setInterval(update,100);notice('Идёт запись с микрофона. Нажмите кнопку ещё раз, чтобы остановить.');
 }catch(err){releaseMicrophone();micIdle();notice(err.name==='NotAllowedError'?'Доступ к микрофону запрещён. Разрешите его в настройках сайта и нажмите запись снова.':err.name==='NotFoundError'?'Микрофон не найден. Подключите его и попробуйте снова.':'Не удалось включить микрофон: '+err.message);}
};
window.addEventListener('pagehide',()=>{if(micRecorder?.state==='recording')micRecorder.stop();releaseMicrophone();});
const mediaNodes=new WeakMap(),mediaPitches=new WeakMap(),mediaGains=new WeakMap(),analysisCache=new WeakMap();let masterAnalyser=null;
async function ensureAudioGraph(){
 audioContext??=new AudioContext();if(!masterAnalyser){masterAnalyser=audioContext.createAnalyser();masterAnalyser.fftSize=1024;}
 for(const l of layers)if(l.media){let node=mediaNodes.get(l.media);if(!node){node=audioContext.createMediaElementSource(l.media);const gain=audioContext.createGain(),pitch=await createPitchNode(audioContext);node.connect(pitch);pitch.connect(gain);mediaPitches.set(l.media,pitch);gain.connect(audioContext.destination);gain.connect(masterAnalyser);mediaGains.set(l.media,gain);mediaNodes.set(l.media,node);l.media.volume=1;}l.audioNode=mediaGains.get(l.media);}
 await audioContext.resume();
}
function decodeAnalysis(l){
 if(!l.media||analysisCache.has(l.media))return;const state={buffer:null,promise:null};analysisCache.set(l.media,state);
 state.promise=(async()=>{try{audioContext??=new AudioContext();const encoded=l.src.split(',')[1],bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));state.buffer=await audioContext.decodeAudioData(bytes.buffer);state.envelope=buildEnvelope(Array.from({length:state.buffer.numberOfChannels},(_,i)=>state.buffer.getChannelData(i)),state.buffer.sampleRate);if(layers.includes(l)){paint();timeline();if(selectedLayer()?.kind==='noise')updateStudioProperties(selectedLayer());}}catch{/* Some video codecs expose analysis only during playback. */}})();
}
function audioDb(f){
 const sources=layers.filter(l=>l.visible&&l.media).flatMap(l=>{const b=analysisCache.get(l.media)?.buffer;const clip=settingsFor(l);return b?[{offset:clip.in,start:clip.start,end:clipEnd(clip),rate:clip.speed,volume:clip.volume*audioFor(l,f).volume,sampleRate:b.sampleRate,channels:Array.from({length:b.numberOfChannels},(_,i)=>b.getChannelData(i))}]:[];});
 if(sources.length)return pcmLevelDb(sources,f/fps);
 if((playing||exporting)&&masterAnalyser){const samples=new Float32Array(masterAnalyser.fftSize);masterAnalyser.getFloatTimeDomainData(samples);return levelDb(Math.sqrt(samples.reduce((sum,v)=>sum+v*v,0)/samples.length));}
 return -100;
}

function updateAudioTools(l){const audio=l.kind==='audio';document.querySelector('.tools').classList.toggle('audio-mode',audio);$('audioTools').hidden=!audio;$('brushSection').hidden=audio;$('visualTransform').hidden=audio;if(audio){const p=audioFor(l,frame);$('audioKeyVolume').value=Math.round(p.volume*100);$('audioKeyVolumeValue').value=Math.round(p.volume*100)+'%';$('audioKeyPitch').value=p.pitch;$('audioKeyPitchValue').value=p.pitch.toFixed(1)+' st';}}
let audioEdit=false;
function changeAudioKeys(field,value,check=true){const l=selectedLayer();if(l?.kind!=='audio')return;stop();if(check)checkpoint();const reference=audioFor(l,frame),keys={...l.audioKeys},delta=value-reference[field];for(const f of selectedFrames){const p=audioFor(l,f);const next={...p,[field]:Math.max(field==='volume'?0:-24,Math.min(field==='volume'?2:24,p[field]+delta))};if(l.altFrames?.[f])l.altFrames[f]={...l.altFrames[f],audio:next,audioFields:[...new Set([...(l.altFrames[f].audioFields||[]),field])]};else keys[f]=next;}l.audioKeys=keys;seekMedia();refresh();}
for(const [id,field,factor] of [['audioKeyVolume','volume',.01],['audioKeyPitch','pitch',1]]){const input=$(id);input.onpointerdown=()=>{checkpoint();audioEdit=true;};input.oninput=()=>{if(!audioEdit){checkpoint();audioEdit=true;}changeAudioKeys(field,Number(input.value)*factor,false);};input.onchange=()=>{audioEdit=false;};}
function showMediaSettings(l){if(l?.media)$('mediaControls').scrollIntoView({block:'start'});}
function updateMediaControls(l){
 $('mediaControls').hidden=!l.media;if(!l.media)return;const c=settingsFor(l);$('mediaVolume').value=Math.round(c.volume*100);$('mediaVolumeValue').value=Math.round(c.volume*100)+'%';$('mediaSpeed').value=c.speed;$('mediaPitch').checked=c.pitch;
 for(const [id,key] of [['mediaStart','start'],['mediaIn','in'],['mediaOut','out']])$(id).value=Number(c[key].toFixed(4));
 $('mediaInfo').textContent=`На шкале: ${c.start.toFixed(2)}–${clipEnd(c).toFixed(2)} с · источник ${c.in.toFixed(2)}–${c.out.toFixed(2)} с.`;
}
function changeMediaControls(check=true){
 const l=selectedLayer();if(!l?.media||exporting)return;const next={start:Number($('mediaStart').value),in:Number($('mediaIn').value),out:Number($('mediaOut').value),speed:Number($('mediaSpeed').value),volume:Number($('mediaVolume').value)/100,pitch:$('mediaPitch').checked};
 if(!['start','in','out','speed','volume'].every(k=>Number.isFinite(next[k]))||next.out<=next.in){notice('Конец клипа должен быть позже начала.');updateMediaControls(l);return;}
 const normalized=clipSettings(next,l.media.duration);if(!Number.isSafeInteger(Math.ceil(clipEnd(normalized)*fps))){notice('Некорректная позиция клипа.');updateMediaControls(l);return;}stop();if(check)checkpoint();l.clip=normalized;total=Math.max(total,Math.ceil(clipEnd(l.clip)*fps));$('duration').value=total;seekMedia();refresh();
}
for(const id of ['mediaStart','mediaIn','mediaOut','mediaSpeed','mediaPitch'])$(id).onchange=()=>changeMediaControls();
let volumeEdit=false;
$('mediaVolume').onpointerdown=()=>{if(selectedLayer()?.media){checkpoint();volumeEdit=true;}};
$('mediaVolume').oninput=()=>{if(!volumeEdit){checkpoint();volumeEdit=true;}changeMediaControls(false);};
$('mediaVolume').onchange=()=>{if(!volumeEdit)changeMediaControls();volumeEdit=false;};

function updateStudioProperties(l){
 updateMediaControls(l);
 $('mapControls').hidden=!l.mapData;$('mapYearStartWrap').hidden=!l.mapData;$('mapYearEndWrap').hidden=!l.mapData;$('editText').hidden=l.kind!=='text';$('noiseLevel').hidden=l.kind!=='noise';
 if(l.kind==='noise')$('noiseLevel').textContent=`Осветление шума: ${audioDb(frame).toFixed(1)} дБ. Тишина — чёрный, 0 дБ — прозрачный.`;
 if(l.mapData){
  $('mapShowYear').checked=l.mapData.showYear!==false;$('mapYearStart').value=l.mapData.yearStart;$('mapYearEnd').value=l.mapData.yearEnd;
  const countrySignature=l.id+':'+currentLanguage()+':'+l.ownerCodes.join(',');if($('countryFlag').dataset.layer!==countrySignature){const regions=new Intl.DisplayNames([currentLanguage()],{type:'region'}),countries=l.mapDefinition.countries,custom=l.mapData.customCountries||[],names=l.ownerCodes.map(code=>({code,name:custom.find(c=>c.id===code)?.name||regions.of(code.toUpperCase())||countries.find(c=>c.code===code)?.name||code})).sort((a,b)=>a.name.localeCompare(b.name,currentLanguage()));$('countryFlag').replaceChildren(...names.map(({code,name})=>{const option=document.createElement('option');option.value=code;option.textContent=name;return option;}));$('countryFlag').dataset.layer=countrySignature;}
  $('countryFlag').value=l.mapData.selectedFlag;$('flagPreview').src=flagSource(l,l.mapData.selectedFlag);
 }
}
for(const [id,field] of [['mapYearStart','yearStart'],['mapYearEnd','yearEnd']])$(id).onchange=()=>{const l=selectedLayer();if(!l?.mapData)return;stop();checkpoint();l.mapData={...l.mapData,[field]:Math.max(-9999,Math.min(9999,Math.round(Number($(id).value)||0)))};refresh();};
function currentLanguage(){return getLanguage();}
function flagSource(l,code){return l.mapData.customCountries?.find(c=>c.id===code)?.flag||COUNTRY_FLAGS[code];}
$('countryFlag').onchange=()=>{const l=selectedLayer();if(!l?.mapData)return;l.mapData={...l.mapData,selectedFlag:$('countryFlag').value};$('flagPreview').src=flagSource(l,l.mapData.selectedFlag);};
let pendingFlag=null;
$('customCountry').onclick=()=>{if(!selectedLayer()?.mapData)return;pendingFlag=null;$('customCountryName').value='';$('customFlagFile').value='';$('customFlagPreview').removeAttribute('src');$('customCountryDialog').showModal();};
$('customFlagFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const image=new Image();image.src=await readData(file);await image.decode();const canvas=document.createElement('canvas');canvas.width=256;canvas.height=192;canvas.getContext('2d').drawImage(image,0,0,256,192);pendingFlag=canvas.toDataURL('image/png');$('customFlagPreview').src=pendingFlag;}catch{notice('Не удалось открыть флаг.');}};
$('createCountry').onclick=async()=>{const l=selectedLayer(),name=$('customCountryName').value.trim();if(!l?.mapData||!name||!pendingFlag){notice('Введите название и выберите флаг.');return;}const country={id:'custom-'+crypto.randomUUID(),name:name.slice(0,80),flag:pendingFlag},image=await loadFlag(country.id,country.flag);checkpoint();l.mapData={...l.mapData,customCountries:[...(l.mapData.customCountries||[]),country],selectedFlag:country.id};l.ownerCodes=[...l.ownerCodes,country.id];l.flagImages={...l.flagImages,[country.id]:image};$('countryFlag').dataset.layer='';$('customCountryDialog').close();refresh();notice('Страна создана. Выберите кисть территорий.');};
$('territoryBrush').onclick=()=>{if(selectedLayer()?.mapData){selectTool('territory');if(selectedLayer().mapData.legacyTerritories)notice('У старой карты сохранены растровые правки. Для полного пересчёта центров добавьте новый шаблон карты.');}};
$('noiseTemplate').onclick=()=>{const existing=layers.find(l=>l.kind==='noise');if(existing){selected=existing.id;}else{checkpoint();const l=newLayer(translate('Осветление шума'),'noise');appendLayer(l);selected=l.id;}$('templatesDialog').close();refresh();notice('Эффект добавлен верхним слоем. Тишина — чёрный; отключить можно значком глаза.');};
let activeText=null;
function beginText(at,existing=null){
 if(exporting)return;stop();const r=stage.getBoundingClientRect(),client=cursorPoint||{x:r.left+r.width/2,y:r.top+r.height/2},point=at||{x:(client.x-r.left)*W/r.width,y:(client.y-r.top)*H/r.height};
 activeText={id:existing?.id||null,point:existing?{x:existing.textData.x,y:existing.textData.y}:{x:Math.max(0,Math.min(W-10,point.x)),y:Math.max(0,Math.min(H-10,point.y))},previous:tool};const data=existing?.textData||{text:'',font:'Arial',size:42,color:'#ffffff',outline:'#000000',outlineWidth:2};
 $('textContent').value=data.text;$('textFont').value=data.font;updateFontPreview();$('textSize').value=data.size;$('textColor').value=data.color;$('textOutline').value=data.outline;$('textOutlineWidth').value=data.outlineWidth;
 const x=r.left+point.x*r.width/W,y=r.top+point.y*r.height/H;$('textEditor').hidden=false;Object.assign($('textEditor').style,{left:Math.max(8,Math.min(innerWidth-350,x))+'px',top:Math.max(8,Math.min(innerHeight-300,y))+'px'});selectTool('text');$('textContent').focus();
}
function cancelText(){const previous=activeText?.previous||'pencil';$('textEditor').hidden=true;activeText=null;selectTool(previous);}
$('cancelText').onclick=cancelText;
$('applyText').onclick=async()=>{await fontsReady;
 if(!activeText||!$('textContent').value.trim()){notice('Введите текст.');return;}
 checkpoint();let l=layers.find(l=>l.id===activeText.id);if(!l){l=newLayer('Текст','text');l.keys={[frame]:initialPose()};appendLayer(l);}l.textData={text:$('textContent').value,font:$('textFont').value,size:Math.max(8,Math.min(300,Number($('textSize').value)||42)),color:$('textColor').value,outline:$('textOutline').value,outlineWidth:Math.max(0,Math.min(24,Number($('textOutlineWidth').value)||0)),...activeText.point};l.name='Текст: '+l.textData.text.split('\n')[0].slice(0,28);l.drawings={};l.textCache=null;selected=l.id;$('textEditor').hidden=true;activeText=null;selectTool('move');refresh();notice('Текст добавлен. Кнопка «Изменить текст» открывает редактирование.');
};
$('textContent').onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancelText();}else if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();$('applyText').click();}};
$('editText').onclick=()=>{const l=selectedLayer();if(l?.kind==='text')beginText(undefined,l);};

$('templates').onclick=()=>{stop();$('templatesDialog').showModal();updateBrushCursor();};
for(const template of MAP_TEMPLATES){
 const card=document.createElement('button');card.type='button';card.className='template-card';
 const preview=document.createElement('img');preview.src=template.src;preview.alt=template.name;const title=document.createElement('span');title.textContent=template.name;card.append(preview,title);
 card.onclick=async()=>{card.disabled=true;try{const l=await loadAsset(template.src,translate(template.name),'image/svg+xml');await prepareMap(l,{id:template.id});checkpoint();appendLayer(l);selected=l.id;$('templatesDialog').close();refresh();notice('Добавлен шаблон: '+template.name);}catch(err){notice('Не удалось добавить карту: '+err.message);}finally{card.disabled=false;}};
 $('templateCards').append(card);
}
const lessons=[
 {title:'Рисование',intro:'Начните новую анимацию из меню «Твои сохранения».',steps:['1 — карандаш, 2 — ластик, 3 — заливка, 4 — редактирование.','Справа выберите круг, квадрат или спрей. Колесо над холстом меняет размер кисти.','Выберите цвет слева или в палитре; разброс светлоты делает участки мазка светлее или темнее.']},
 {title:'Текст на холсте',intro:'Наведите курсор на холст и нажмите T.',steps:['Поле текста появится около курсора. Введите одну или несколько строк.','Выберите шрифт, размер, цвет и цвет/толщину обводки.','«Добавить текст» или Ctrl+Enter создаёт слой. «Изменить текст» редактирует выбранный текстовый слой.']},
 {title:'Ключи и промежуточные кадры',intro:'Ключи хранят рисунок и положение. A-кадры плавно соединяют ключи.',steps:['Q вставляет ключ после текущего кадра; A вставляет промежуточный. N превращает всё выделение в A-кадры. Держите N или V при выделении для преобразования или вставки.','На следующем ключе измените рисунок или трансформацию, а между ними добавьте A-кадры.','▶ запускает воспроизведение. FPS задаётся от 1 до 240; ползунок прилипает к 12, 24, 60 и 144. «Повтор» соединяет последние A-кадры с первым ключом.']},
 {title:'Кадры и слои',intro:'Разделяйте персонажей, карты, текст и звук на слои.',steps:['Пробел создаёт слой, Backspace удаляет выбранный слой. Держите стрелки: переход ускоряется с 5 до 100 кадров/с.','Shift+ЛКМ выделяет диапазон; C копирует, V вставляет, Delete удаляет.','Z отменяет, Y возвращает. У слоя есть скрытие, стрелки вверх/вниз и удаление. Колесо над именами слоёв меняет масштаб шкалы от 0,02× до 1×.']},
 {title:'Редактирование и свободные углы',intro:'Нажмите 4, чтобы перемещать и изменять слой.',steps:['Боковые маркеры меняют ширину/высоту, зелёный круг — поворот; замочек связывает стороны.','«Свободные углы» разрешают отдельно двигать оранжевые углы. A-кадры плавно соединяют их положения.','«Сбросить углы» возвращает прямоугольник на текущем кадре.']},
 {title:'Карты, годы и территории',intro:'«Шаблоны карт» добавляют мир, Европу, Африку, Северную и Южную Америку, Азию и Евразию со встроенными флагами.',steps:['На слое карты задайте первый и последний год около кнопок воспроизведения. Между ними год меняется плавно.','Справа выберите флаг по алфавиту или создайте свою страну с флагом из файла. «Кисть территорий» меняет сушу. Размер меняется колесом.','Кисть меняет территории только на суше. Флаг остаётся в центре каждой связной части страны после расширения или захвата. Q копирует карту на новый ключ.']},
 {title:'Видео и удаление фона',intro:'Импортируйте MP4, изображения и звук кнопкой «Добавить файлы».',steps:['Выберите слой и инструмент «Убрать фон» (K), нажмите на нужный цвет.','На шкале тяните видео/звук за середину для перемещения, за края — для обрезки. При нажатии доступны громкость, скорость и влияние на питч.','«Восстановить фон видео» отключает фильтр. Он сохраняется в проекте и применяется в экспорте.']},
 {title:'Звук и осветление шума',intro:'MP3, видео и запись микрофона могут управлять яркостью анимации.',steps:['Кнопка микрофона начинает запись; повторное нажатие создаёт звуковой слой.','В шаблонах выберите «Осветление шума»: эффект появится верхним слоем.','0 дБ — прозрачный, −100 дБ — чёрный. Чем громче звук, тем светлее изображение. Для рисования эффект можно скрыть значком глаза.']},
 {title:'Сохранения и скачивание',intro:'«Твои сохранения» открывается при запуске и кнопкой сверху.',steps:['«Сохранить» → «Сохранить в библиотеку» обновляет текущий проект; в Windows файлы лежат в папке анимаций.','В меню библиотеки можно открыть папку или выбрать другую. Превью всегда показывает первый кадр.','«↓ Проект» скачивает .animaster; «↓ Анимация» создаёт видео WebM со звуком. В Windows скачанные файлы попадают в «Загрузки».']}
];
lessons[2].steps.push('Alt превращает A в AltA. Редактируйте его, чтобы получить плавную кривую; N возвращает обычный A.');
let lesson=0;
function showLesson(){const item=getLanguage()==='ru'?lessons[lesson]:localizedLesson(lesson);$('tutorialCounter').textContent=getLanguage()==='ru'?`Шаг ${lesson+1} из ${lessons.length}`:`${lesson+1} / ${lessons.length}`;$('tutorialTitle').textContent=item.title;$('tutorialIntro').textContent=item.intro;$('tutorialSteps').replaceChildren(...item.steps.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));$('tutorialBack').disabled=lesson===0;$('tutorialNext').textContent=lesson===lessons.length-1?'Начать работу':'Далее';}
$('helpButton').onclick=()=>{stop();lesson=0;showLesson();$('tutorialDialog').showModal();updateBrushCursor();};
$('tutorialBack').onclick=()=>{if(lesson>0){lesson--;showLesson();}};
$('tutorialNext').onclick=()=>{if(lesson===lessons.length-1)$('tutorialDialog').close();else{lesson++;showLesson();}};
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('close',()=>updateBrushCursor());
$('import').onclick=()=>$('files').click();$('files').onchange=async e=>{stop();for(const file of e.target.files){try{if(!/\.(mp4|png|gif|mp3|jpe?g|webp)$/i.test(file.name))throw Error('Неподдерживаемый формат');notice('Импорт: '+file.name);const l=await loadAsset(await readData(file),file.name,file.type||(/\.mp3$/i.test(file.name)?'audio/mpeg':/\.mp4$/i.test(file.name)?'video/mp4':'image/png'));checkpoint();appendLayer(l);selected=l.id;if(l.media&&Number.isFinite(l.media.duration)){total=Math.max(total,Math.ceil(l.media.duration*fps));$('duration').value=total;}seekMedia();refresh();if(l.mime!=='image/gif')notice('Файл добавлен: '+file.name);}catch(err){notice('Не удалось импортировать '+file.name+': '+err.message);}}e.target.value='';};
function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),30000);}
function filename(){return $('projectName').value.replace(/[<>:"/\\|?*]/g,'_')||'ANIMASTER';}
function projectData(){return {version:1,projectId,name:$('projectName').value,fps,total,timelineZoom,loop:$('loop').checked,brushSettings:{shape:$('brushShape').value,size:+$('brush').value,variation:+$('colorVariation').value,color:$('color').value,palette:customPalette,wheel:Number($('brushWheelSpeed').value)},layers:layers.map(l=>({id:l.id,effectSeed:l.effectSeed||l.id,name:l.name,kind:l.kind,visible:l.visible,aspectLocked:l.aspectLocked,freeCorners:l.freeCorners,chroma:l.chroma,textData:l.textData,altFrames:l.altFrames,autoTween:l.autoTween,audioKeys:l.audioKeys,clip:l.clip,mapData:l.mapData,mapOwnership:serializeOwnership(l),keys:l.keys,tweens:l.tweens,src:l.src,mime:l.mime,canvas:l.canvas.toDataURL(),drawings:Object.fromEntries(Object.entries(l.drawings).map(([f,c])=>[f,c.toDataURL()]))}))};}
function saveProjectFile(){try{if(activeText&&$('textContent').value.trim())$('applyText').click();download(new Blob([JSON.stringify(projectData())],{type:'application/json'}),filename()+'.animaster');notice('Проект скачан. Откройте файл .animaster, чтобы продолжить редактирование.');}catch(err){notice('Не удалось скачать проект: '+err.message);}}
$('save').onclick=saveProjectFile;
$('downloadProject').onclick=saveProjectFile;
function webStore(action,key,value){return new Promise((resolve,reject)=>{
 const request=indexedDB.open('animaster-projects',1);request.onupgradeneeded=()=>request.result.createObjectStore('projects');request.onerror=()=>reject(request.error);
 request.onsuccess=()=>{const db=request.result,tx=db.transaction('projects',action==='save'?'readwrite':'readonly'),store=tx.objectStore('projects');let result,keys=[];
 if(action==='list'){const rows=store.getAll(),ids=store.getAllKeys();rows.onsuccess=()=>result=rows.result;ids.onsuccess=()=>keys=ids.result;}
 else{const op=action==='save'?store.put(value,key):store.get(key);op.onsuccess=()=>result=op.result;}
 tx.oncomplete=()=>{db.close();resolve(action==='list'?result.map((v,i)=>({...v,id:String(keys[i])})):result);};tx.onabort=tx.onerror=()=>{db.close();reject(tx.error||Error('Хранилище недоступно'));};};
});}
async function savedEntries(){
 const native=window.animasterLibrary?await window.animasterLibrary.list():[];let web=[];try{web=await webStore('list');}catch{}
 return [...native.map(entry=>({...entry,source:'desktop'})),...web.filter(entry=>entry.data).map(entry=>({id:entry.id,source:'web',projectId:entry.data.projectId,name:entry.data.name,thumbnail:entry.thumbnail||'',updatedAt:entry.savedAt||entry.updatedAt||0}))].sort((a,b)=>b.updatedAt-a.updatedAt);
}
async function openLibrary(){
 if(activeText){if($('textContent').value.trim())$('applyText').click();else cancelText();}stop();$('libraryDialog').showModal();updateBrushCursor();$('libraryStatus').textContent='Открываем сохранения…';$('savedCards').replaceChildren();
 $('openLibraryFolder').hidden=!window.animasterLibrary;$('chooseLibraryFolder').hidden=!window.animasterLibrary;
 try{
  $('libraryLocation').textContent=window.animasterLibrary?'Папка: '+await window.animasterLibrary.folder():'Библиотека этого браузера. В версии Windows проекты сохраняются в обычной папке.';
  const entries=await savedEntries();$('libraryStatus').textContent=entries.length?`${entries.length} сохранений. Нажмите на превью, чтобы открыть.`:'Пока нет сохранений. Создайте первую анимацию или откройте файл проекта.';
  for(const entry of entries){const card=document.createElement('button');card.type='button';card.className='save-card';const preview=document.createElement('div');preview.className='save-preview';if(entry.thumbnail){const img=document.createElement('img');img.src=entry.thumbnail;img.alt='Первый кадр: '+entry.name;preview.append(img);}else preview.textContent='Превью появится после пересохранения';const title=document.createElement('strong');title.textContent=entry.name||'Без названия';const date=document.createElement('small');date.textContent=entry.updatedAt?new Date(entry.updatedAt).toLocaleString(getLanguage()):'';card.append(preview,title,date);card.onclick=async()=>{card.disabled=true;try{const data=entry.source==='desktop'?await window.animasterLibrary.load(entry.id):(await webStore('get',entry.id)).data;await loadProject(data);}catch(err){$('libraryStatus').textContent='Не удалось открыть: '+err.message;}finally{card.disabled=false;}};$('savedCards').append(card);}
 }catch(err){$('libraryStatus').textContent='Не удалось открыть папку: '+err.message+'. Можно выбрать другую папку.';}
}
async function thumbnail(){
 const old=frame;stop();try{
  if(layers.some(l=>l.kind==='noise'))await Promise.all(layers.filter(l=>l.media).map(l=>analysisCache.get(l.media)?.promise));
  frame=0;seekMedia();await Promise.all(layers.filter(l=>l.media?.seeking).map(l=>new Promise(resolve=>{const finish=()=>{clearTimeout(timer);l.media.removeEventListener('seeked',finish);resolve();};const timer=setTimeout(finish,2500);l.media.addEventListener('seeked',finish,{once:true});})));
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const g=canvas.getContext('2d');g.scale(1/3,1/3);render(g,0);return canvas.toDataURL('image/png');
 }finally{frame=old;seekMedia();refresh();}
}
async function saveToLibrary(){
 if(micRecorder?.state==='recording')throw Error('Остановите запись микрофона перед сохранением');
 const preview=await thumbnail(),data=projectData();if(window.animasterLibrary)await window.animasterLibrary.save({id:projectId,data,thumbnail:preview});else await webStore('save',projectId,{data,thumbnail:preview,savedAt:Date.now()});
 return data;
}
async function showSaveDialog(){
 $('saveDialog').showModal();$('localSaveInfo').textContent=window.animasterLibrary?'Папка: '+await window.animasterLibrary.folder():'Проекты сохранятся в библиотеке браузера.';$('restoreLocal').disabled=false;
}
$('saveLocal').onclick=()=>showSaveDialog().catch(err=>notice(err.message));
$('writeLocal').onclick=async()=>{$('writeLocal').disabled=true;$('localSaveInfo').textContent='Сохраняем анимацию…';try{if(activeText&&$('textContent').value.trim())$('applyText').click();const data=await saveToLibrary();$('localSaveInfo').textContent=`Сохранено: ${data.name} · ${new Date().toLocaleString(getLanguage())}`;notice('Анимация сохранена в библиотеке.');}catch(err){$('localSaveInfo').textContent='Не удалось сохранить: '+err.message;}finally{$('writeLocal').disabled=false;}};
$('restoreLocal').onclick=()=>{$('saveDialog').close();openLibrary();};$('mySaves').onclick=()=>openLibrary();$('closeLibrary').onclick=()=>$('libraryDialog').close();
$('galleryImport').onclick=()=>$('projectFile').click();
$('openLibraryFolder').onclick=()=>window.animasterLibrary.openFolder().catch(err=>$('libraryStatus').textContent=err.message);
$('chooseLibraryFolder').onclick=async()=>{await window.animasterLibrary.chooseFolder();$('libraryDialog').close();await openLibrary();};
$('newProject').onclick=()=>{stop();projectId=crypto.randomUUID();renderCustomPalette();
const first=newLayer(translate('Рисунок')+' 1');layers=[first];selected=first.id;frame=0;total=1;fps=24;timelineZoom=1;history=[];redoHistory=[];selectedFrames=new Set([0]);selectionAnchor=0;activeText=null;$('textEditor').hidden=true;$('projectName').value=translate('Новая анимация');$('duration').value=1;$('fps').value=24;$('fpsSlider').value=24;$('loop').checked=false;$('libraryDialog').close();selectTool('pencil');refresh();};

async function imageCanvas(src){const c=surface(),img=new Image();await new Promise((ok,no)=>{img.onload=ok;img.onerror=no;img.src=src;});c.getContext('2d').drawImage(img,0,0);return c;}
$('openProject').onclick=()=>$('projectFile').click();async function loadProject(d){await fontsReady;if(d.version!==1||!Array.isArray(d.layers)||d.layers.length>100||!Number.isInteger(d.fps)||d.fps<1||d.fps>240||!Number.isSafeInteger(d.total)||d.total<1)throw Error('Некорректный проект');const loaded=[];for(const a of d.layers){if(!['drawing','image','video','audio','text','noise'].includes(a.kind)||!a.keys)throw Error('Некорректный слой');for(const [f,p] of [...Object.entries(a.keys),...Object.entries(a.altFrames||{}).map(([f,g])=>[f,g.pose])])if(!/^\d+$/.test(f)||!['x','y','scale','opacity'].every(k=>Number.isFinite(p[k]))||p.scale<=0||['mirrorX','mirrorY'].some(k=>p[k]!==undefined&&(!Number.isFinite(p[k])||Math.abs(p[k])>1))||['shake','blur'].some(k=>p[k]!==undefined&&(!Number.isFinite(p[k])||p[k]<0||p[k]>100))||(p.rotation!==undefined&&!Number.isFinite(p.rotation))||['scaleX','scaleY'].some(k=>p[k]!==undefined&&(!Number.isFinite(p[k])||p[k]<=0))||(p.corners!==undefined&&!validCorners(p.corners))||(p.warpBounds!==undefined&&(!['x','y','w','h'].every(k=>Number.isFinite(p.warpBounds[k]))||p.warpBounds.w<=0||p.warpBounds.h<=0)))throw Error('Некорректный ключ');if(a.src&&!a.src.startsWith('data:'))throw Error('Внешние источники не разрешены');const l=['drawing','text','noise'].includes(a.kind)?newLayer(a.name,a.kind):await loadAsset(a.src,a.name,a.mime);if(a.kind==='text'){if(!a.textData||typeof a.textData.text!=='string'||a.textData.text.length>5000||!TEXT_FONTS.includes(a.textData.font)||!['size','x','y','outlineWidth'].every(k=>Number.isFinite(a.textData[k]))||!/^#[0-9a-f]{6}$/i.test(a.textData.color)||!/^#[0-9a-f]{6}$/i.test(a.textData.outline))throw Error('Некорректный текст');l.textData={...a.textData,size:Math.max(8,Math.min(300,a.textData.size)),outlineWidth:Math.max(0,Math.min(24,a.textData.outlineWidth))};}if(l.media){if(a.clip&&(!['start','in','out','speed','volume'].every(k=>Number.isFinite(a.clip[k]))||a.clip.start<0||a.clip.in<0||a.clip.out<=a.clip.in||a.clip.speed<.25||a.clip.speed>4||a.clip.volume<0||a.clip.volume>2))throw Error('Некорректный клип');l.clip=clipSettings(a.clip,l.media.duration);if(!Number.isSafeInteger(Math.ceil(clipEnd(l.clip)*d.fps))||l.clip.out<=l.clip.in)throw Error('Некорректный клип');}l.effectSeed=typeof a.effectSeed==='string'?a.effectSeed.slice(0,100):typeof a.id==='string'?a.id.slice(0,100):l.id;l.altFrames=a.altFrames||{};for(const [f,g] of Object.entries(l.altFrames)){if(Object.hasOwn(a.keys,f)||!Array.isArray(g.fields)||g.fields.some(k=>!['x','y','scale','scaleX','scaleY','opacity','rotation','shake','blur','mirrorX','mirrorY','corners'].includes(k))||!Array.isArray(g.audioFields)||g.audioFields.some(k=>!['volume','pitch'].includes(k))||(g.audioFields.length&&!g.audio)||(g.audio&&(!Number.isFinite(g.audio.volume)||g.audio.volume<0||g.audio.volume>2||!Number.isFinite(g.audio.pitch)||Math.abs(g.audio.pitch)>24)))throw Error('Некорректный AltA');}l.keys=a.keys;if(l.media){if(!a.autoTween&&Object.keys(l.keys).length===1&&l.keys[0]&&JSON.stringify({...initialPose(),...l.keys[0]})===JSON.stringify(initialPose()))l.keys={};l.autoTween=true;l.audioKeys=a.audioKeys||{};for(const [f,key] of Object.entries(l.audioKeys))if(!/^\d+$/.test(f)||!Number.isFinite(key.volume)||key.volume<0||key.volume>2||!Number.isFinite(key.pitch)||Math.abs(key.pitch)>24)throw Error('Некорректный звуковой ключ');}l.aspectLocked=a.aspectLocked===true;l.freeCorners=a.freeCorners===true;if(a.chroma){if(!Array.isArray(a.chroma.color)||a.chroma.color.length!==3||!a.chroma.color.every(v=>Number.isFinite(v)&&v>=0&&v<=255)||!Number.isFinite(a.chroma.tolerance)||a.chroma.tolerance<0||a.chroma.tolerance>180)throw Error('Некорректный фильтр цвета');l.chroma={color:[...a.chroma.color],tolerance:a.chroma.tolerance,enabled:a.chroma.enabled===true};}l.tweens=Array.isArray(a.tweens)?a.tweens.filter(f=>Number.isInteger(f)&&f>=0&&f<d.total):[];l.visible=a.visible;l.canvas=await imageCanvas(a.canvas);l.drawings={};for(const [f,s] of Object.entries(a.drawings||{}))l.drawings[f]=await imageCanvas(s);const legacy=MAP_TEMPLATES.find(t=>t.src===a.src);if(a.mapData||legacy){const data=a.mapData||{id:legacy.id};if(!MAP_COUNTRIES[data.id])throw Error('Неизвестная карта');await prepareMap(l,data,!a.mapData);restoreOwnership(l,a.mapOwnership,d.total);}loaded.push(l);}stop();layers=loaded;projectId=typeof d.projectId==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(d.projectId)?d.projectId:crypto.randomUUID();fps=d.fps;total=d.total;timelineZoom=Math.max(.02,Math.min(1,Number(d.timelineZoom)||1));frame=0;selected=layers.at(-1)?.id;history=[];redoHistory=[];selectedFrames=new Set([0]);selectionAnchor=0;$('projectName').value=d.name;$('fps').value=fps;$('fpsSlider').value=fps;$('duration').value=total;$('loop').checked=d.loop===true;if(d.brushSettings){const b=d.brushSettings;if(Array.isArray(b.palette))customPalette=b.palette.filter(c=>/^#[0-9a-f]{6}$/i.test(c));$('brushWheelSpeed').value=Math.max(1,Math.min(10,Number(b.wheel)||Number(brushPreferences.wheel)||3));$('brushWheelSpeedValue').value=$('brushWheelSpeed').value+'×';renderCustomPalette();$('brushShape').value=['circle','square','spray'].includes(b.shape)?b.shape:'circle';$('brush').value=Number.isFinite(b.size)?Math.max(1,Math.min(500,b.size)):8;$('colorVariation').value=Number.isFinite(b.variation)?Math.max(0,Math.min(100,b.variation)):0;if(/^#[0-9a-f]{6}$/i.test(b.color))$('color').value=b.color;$('brushValue').value=$('brush').value+' px';$('variationValue').value=$('colorVariation').value+'%';syncPalette();}activeText=null;$('textEditor').hidden=true;seekMedia();if($('libraryDialog').open)$('libraryDialog').close();refresh();notice('Проект открыт.');}
$('projectFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;notice('Открываем проект…');try{await loadProject(JSON.parse(await file.text()));}catch(err){notice('Ошибка открытия: '+err.message);}e.target.value='';};
$('export').onclick=()=>$('exportDialog').showModal();
$('png').onclick=()=>{const s=+$('exportSize').value,c=document.createElement('canvas');c.width=W*s;c.height=H*s;const g=c.getContext('2d');g.scale(s,s);render(g);c.toBlob(b=>download(b,filename()+'.png'),'image/png');notice('PNG экспортирован. Качество PNG всегда без потерь.');};
let readyVideoUrl=null;
async function exportVideo(){if(exporting)return;if(!window.MediaRecorder||!HTMLCanvasElement.prototype.captureStream){notice('Запись видео недоступна в этом браузере. Используйте Chrome или Edge.');return;}if(micRecorder?.state==='recording'){notice('Остановите запись микрофона перед скачиванием анимации.');return;}stop();$('exportDialog').close();$('renderDialog').showModal();$('renderProgress').value=0;$('renderText').textContent='Подготавливаем анимацию…';$('videoResult').hidden=true;$('renderClose').disabled=true;const oldFrame=frame,s=+$('exportSize').value,c=document.createElement('canvas');c.width=W*s;c.height=H*s;const g=c.getContext('2d');g.scale(s,s);let stream=c.captureStream(0);if(!stream.getVideoTracks()[0]?.requestFrame){stream.getTracks().forEach(t=>t.stop());stream=c.captureStream(fps);}const videoTrack=stream.getVideoTracks()[0];let recordedFrame=-1;const mediaLayers=layers.filter(l=>l.visible&&l.media);try{if(mediaLayers.length){await ensureAudioGraph();audioDest??=audioContext.createMediaStreamDestination();for(const l of mediaLayers){l.audioNode=mediaGains.get(l.media);l.audioNode.connect(audioDest);}for(const t of audioDest.stream.getAudioTracks())stream.addTrack(t);}const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));if(!mime)throw Error('WebM не поддерживается');const rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:Math.round(8000000*+$('quality').value*s*s)}),chunks=[];const done=new Promise((ok,no)=>{rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};rec.onstop=ok;rec.onerror=no;});frame=0;seekMedia();await Promise.all(mediaLayers.map(l=>new Promise(resolve=>{if(!l.media.seeking)return resolve();l.media.addEventListener('seeked',resolve,{once:true});})));render(g,0);exporting=true;rec.start();syncMedia(0,true);videoTrack.requestFrame?.();const start=performance.now();await new Promise(resolve=>{function tick(now){const f=Math.floor((now-start)*fps/1000);if(f>=total){render(g,total-1);videoTrack.requestFrame?.();return resolve();}frame=f;syncMedia(f,true);render(g,f);if(f!==recordedFrame){videoTrack.requestFrame?.();recordedFrame=f;}paint();const progress=Math.round((f+1)/total*100);$('renderProgress').value=progress;$('renderText').textContent=`Создаём видео: ${progress}%`;notice(`Экспорт видео: ${progress}%`);setTimeout(()=>tick(performance.now()),Math.max(0,start+(f+1)*1000/fps-performance.now()));}tick(performance.now());});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));rec.stop();await done;const blob=new Blob(chunks,{type:mime});if(!blob.size)throw Error('Браузер создал пустое видео');if(readyVideoUrl)URL.revokeObjectURL(readyVideoUrl);readyVideoUrl=URL.createObjectURL(blob);$('videoPreview').src=readyVideoUrl;$('downloadVideo').href=readyVideoUrl;$('downloadVideo').download=filename()+'.webm';$('videoResult').hidden=false;$('renderProgress').value=100;$('renderText').textContent='Анимация готова! Скачайте видео кнопкой ниже.';notice('Анимация готова — нажмите «Скачать видео».');}catch(err){notice('Ошибка экспорта: '+err.message);$('renderText').textContent='Не удалось создать видео: '+err.message;}finally{$('renderClose').disabled=false;exporting=false;stop();stream.getVideoTracks().forEach(t=>t.stop());for(const l of mediaLayers)if(l.audioNode)try{l.audioNode.disconnect(audioDest);}catch{}frame=oldFrame;seekMedia();refresh();}}
$('video').onclick=exportVideo;
$('renderDialog').addEventListener('cancel',e=>{if($('renderClose').disabled)e.preventDefault();});
$('renderClose').onclick=()=>{$('videoPreview').pause();$('renderDialog').close();};
const heldKeys=new Set();let altTap=null;document.addEventListener('pointerdown',()=>{if(altTap)altTap.used=true;},true);
function cancelHeldKeys(){altTap=null;heldKeys.clear();nHeld=false;nCheckpoint=false;vHeld=false;vCheckpoint=false;vApplied.clear();frameDrag=null;if(arrowHold)clearTimeout(arrowHold.timer);arrowHold=null;}
function advanceArrow(hold){
 const distance=arrowDistance(performance.now()-hold.started),delta=distance-hold.steps;if(delta<=0)return;hold.steps=distance;const direction=hold.code==='ArrowRight'?1:-1,shift=heldKeys.has('ShiftLeft')||heldKeys.has('ShiftRight'),target=Math.max(0,Math.min(total-1,frame+direction*delta));
 if((nHeld||vHeld)&&!shift&&Math.abs(target-frame)>1){selectedFrames=new Set(Array.from({length:Math.abs(target-frame)},(_,i)=>frame+direction*(i+1)));if(nHeld)convertToTween();if(vHeld)pasteFrames();}
 setFrame(target,shift);
}
function startArrow(code,shift){
 if(arrowHold)clearTimeout(arrowHold.timer);const hold={code,started:performance.now(),steps:0,timer:null};arrowHold=hold;setFrame(frame+(code==='ArrowRight'?1:-1),shift);
 const tick=()=>{if(arrowHold!==hold)return;if(document.querySelector('dialog[open]')||exporting||/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)){cancelHeldKeys();return;}const now=performance.now();advanceArrow(hold);hold.timer=setTimeout(tick,Math.max(0,1000/arrowRate(now-hold.started)-(performance.now()-now)));};
 hold.timer=setTimeout(tick,Math.max(0,200-(performance.now()-hold.started)));
}
document.addEventListener('keydown',e=>{
 heldKeys.add(e.code);if(altTap&&!['AltLeft','AltRight'].includes(e.code))altTap.used=true;
 if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||e.target.isContentEditable||exporting||document.querySelector('dialog[open]')||!$('textEditor').hidden||gesture||mediaGesture)return;
 const code=e.code,modified=e.ctrlKey||e.metaKey;if(code==='AltLeft'||code==='AltRight'){e.preventDefault();if(!e.repeat)altTap={used:false};return;}
 if(modified&&!['KeyZ','KeyY','KeyC','KeyV'].includes(code))return;
 if(code==='KeyN'){e.preventDefault();if(!e.repeat){nHeld=true;nCheckpoint=false;convertToTween();}return;}
 if(code==='KeyV'&&modified){if(window.animasterClipboard){e.preventDefault();window.animasterClipboard.files().then(async files=>{if(files.length){await importClipboardFiles(files.map(f=>new File([Uint8Array.from(atob(f.data),c=>c.charCodeAt(0))],f.name,{type:f.type})));}else{const text=await window.animasterClipboard.text();if(text.trim()){beginText();$('textContent').value=text.slice(0,5000);}}}).catch(error=>notice(error.message));}return;}
 if(code==='ArrowUp'||code==='ArrowDown'){e.preventDefault();const rows=[...layers].reverse(),index=rows.findIndex(l=>l.id===selected),next=rows[Math.max(0,Math.min(rows.length-1,index+(code==='ArrowUp'?-1:1)))];if(next){selected=next.id;selectedLayerIds=new Set([selected]);refresh();}return;}
 if(code==='KeyV'){e.preventDefault();if(!e.repeat){vHeld=true;vCheckpoint=false;vApplied.clear();pasteFrames();}return;}
 if(code==='ArrowRight'||code==='ArrowLeft'){e.preventDefault();if(!e.repeat)startArrow(code,e.shiftKey);return;}
 const actions={KeyQ:addKey,KeyA:addTween,KeyZ:e.shiftKey?redo:undo,KeyY:redo,Digit1:()=>selectTool('pencil'),Digit2:()=>selectTool('eraser'),Digit3:()=>selectTool('fill'),Digit4:()=>selectTool('move'),KeyT:()=>beginText(),KeyC:copyFrames,KeyV:pasteFrames,KeyB:()=>selectTool('pencil'),KeyE:()=>selectTool('eraser'),KeyF:()=>selectTool('fill'),KeyK:()=>selectTool('remove'),KeyM:()=>selectTool('move'),Space:addLayer,Delete:deleteFrames,Backspace:deleteLayer};
 if(actions[code]){e.preventDefault();if(!e.repeat)actions[code]();}
});
document.addEventListener('keyup',e=>{if(e.code==='AltLeft'||e.code==='AltRight'){e.preventDefault();const tap=altTap;altTap=null;if(tap&&!tap.used&&!/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)&&!document.querySelector('dialog[open]')&&!gesture&&!mediaGesture)convertToAltA();}heldKeys.delete(e.code);if(e.code==='KeyN'){nHeld=false;nCheckpoint=false;}if(e.code==='KeyV'){vHeld=false;vCheckpoint=false;vApplied.clear();}if(e.code===arrowHold?.code){advanceArrow(arrowHold);clearTimeout(arrowHold.timer);arrowHold=null;}});
window.addEventListener('blur',()=>{cancelHeldKeys();volumeEdit=false;audioEdit=false;finishMediaDrag();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelHeldKeys();});
renderCustomPalette();
const first=newLayer(translate('Рисунок')+' 1');layers=[first];selected=first.id;refresh();new ResizeObserver(()=>{$('zoom').textContent=Math.round(stage.getBoundingClientRect().width/W*100)+'%';}).observe(stage);

function fitCanvas(){const area=document.querySelector('.stage-area');const style=getComputedStyle(area);const availableWidth=area.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);const availableHeight=area.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom)-70;const width=Math.max(100,Math.min(W,availableWidth,availableHeight*W/H));stage.style.width=width+'px';stage.style.height=width*H/W+'px';const density=Math.max(1,window.devicePixelRatio||1),backingWidth=Math.max(W,Math.round(width*density)),backingHeight=Math.round(backingWidth*H/W);if(stage.width!==backingWidth||stage.height!==backingHeight){stage.width=backingWidth;stage.height=backingHeight;ctx.setTransform(backingWidth/W,0,0,backingHeight/H,0,0);paint();}updateBrushCursor();}
new ResizeObserver(fitCanvas).observe(document.querySelector('.stage-area'));
fitCanvas();

setupI18n(()=>{$('countryFlag').dataset.layer='';refresh();if($('tutorialDialog').open)showLesson();});


function applyTheme(value){const theme=value==='dark'?'dark':'classic';document.documentElement.dataset.theme=theme;$('theme').value=theme;try{localStorage.setItem('animaster-theme',theme);}catch{}}
try{applyTheme(localStorage.getItem('animaster-theme'));}catch{applyTheme('classic');}
$('theme').onchange=()=>applyTheme($('theme').value);

function updateFontPreview(){const name=$('textFont').value;$('textFont').style.fontFamily=`"${name}"`;$('textContent').style.fontFamily=`"${name}"`;for(const b of $('fontSamples').children)b.setAttribute('aria-pressed',String(b.dataset.font===name));}
$('textFont').replaceChildren(...TEXT_FONTS.map(name=>{const o=document.createElement('option');o.value=o.textContent=name;o.style.fontFamily=`"${name}"`;return o;}));
for(const name of TEXT_FONTS){const b=document.createElement('button');b.type='button';b.dataset.font=name;b.style.fontFamily=`"${name}"`;b.textContent=name+' · Анимация Aa';b.onclick=()=>{$('textFont').value=name;updateFontPreview();$('fontMenu').open=false;};$('fontSamples').append(b);}
$('textFont').onchange=updateFontPreview;updateFontPreview();

$('mapShowYear').onchange=()=>{const l=selectedLayer();if(!l?.mapData)return;checkpoint();l.mapData={...l.mapData,showYear:$('mapShowYear').checked};refresh();};
async function importClipboardFiles(files){stop();for(const file of files){try{const mime=file.type||(/\.mp3$/i.test(file.name)?'audio/mpeg':/\.(mp4|webm)$/i.test(file.name)?'video/mp4':'image/png');if(!/^(image|video|audio)\//.test(mime))throw Error('Неподдерживаемый формат');const l=await loadAsset(await readData(file),file.name||'Буфер обмена',mime);checkpoint();appendLayer(l);selected=l.id;selectedLayerIds=new Set([l.id]);if(l.media&&Number.isFinite(l.media.duration)){total=Math.max(total,Math.ceil(l.media.duration*fps));$('duration').value=total;}seekMedia();refresh();}catch(error){notice(error.message);}}}
document.addEventListener('paste',async e=>{if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.target.isContentEditable||document.querySelector('dialog[open]')||!$('textEditor').hidden||exporting)return;const files=[...(e.clipboardData?.files||[])],text=e.clipboardData?.getData('text/plain')||'';if(!files.length&&!text.trim())return;e.preventDefault();if(files.length)await importClipboardFiles(files);else{beginText();$('textContent').value=text.slice(0,5000);$('textContent').focus();}});
const selectionBox=document.createElement('div');selectionBox.id='timelineSelectionBox';selectionBox.hidden=true;document.body.append(selectionBox);
$('tracks').addEventListener('pointerdown',e=>{if(e.button!==0||exporting||e.target.closest('button,.clip-handle,.media-clip,.track-label'))return;const row=e.target.closest('.track[data-layer]'),m=timelineMetrics;if(!row||!m)return;const f=timelineFrameAt(e.clientX);boxSelection={x:e.clientX,y:e.clientY,layer:row.dataset.layer,frame:f,active:false};},true);
function timelineFrameAt(x){const tracks=$('tracks'),m=timelineMetrics,rect=tracks.getBoundingClientRect();return Math.max(0,Math.min(total-1,m.start+Math.floor((x-rect.left+tracks.scrollLeft-TRACK_LABEL-m.prefix)/m.cellWidth)));}
document.addEventListener('pointermove',e=>{const b=boxSelection;if(!b||!(e.buttons&1)||Math.hypot(e.clientX-b.x,e.clientY-b.y)<5&&!b.active)return;b.active=true;frameDrag=null;const rows=[...$('tracks').querySelectorAll('.track[data-layer]')],from=rows.findIndex(r=>r.dataset.layer===b.layer);let to=rows.findIndex(r=>{const rect=r.getBoundingClientRect();return e.clientY>=rect.top&&e.clientY<=rect.bottom;});if(to<0)to=e.clientY<b.y?0:rows.length-1;selectedLayerIds=new Set(rows.slice(Math.min(from,to),Math.max(from,to)+1).map(r=>r.dataset.layer));const end=timelineFrameAt(e.clientX);frame=end;selectionAnchor=b.frame;selectedFrames=new Set(Array.from({length:Math.abs(end-b.frame)+1},(_,i)=>Math.min(end,b.frame)+i));selectionBox.hidden=false;Object.assign(selectionBox.style,{left:Math.min(b.x,e.clientX)+'px',top:Math.min(b.y,e.clientY)+'px',width:Math.abs(e.clientX-b.x)+'px',height:Math.abs(e.clientY-b.y)+'px'});seekMedia();refresh();});
for(const type of ['pointerup','pointercancel'])document.addEventListener(type,()=>{boxSelection=null;selectionBox.hidden=true;});
const intro=$('amsIntro'),introVideo=$('amsIntroVideo');let introClosed=false;function closeAMSIntro(){if(introClosed)return;introClosed=true;intro.hidden=true;introVideo.pause();openLibrary().catch(err=>notice('Не удалось открыть библиотеку: '+err.message));}introVideo.onended=closeAMSIntro;introVideo.onerror=closeAMSIntro;$('amsIntroSkip').onclick=closeAMSIntro;$('amsIntroSound').onclick=()=>{introVideo.muted=!introVideo.muted;};introVideo.play().catch(closeAMSIntro);

setupCommunity({readFile:readData,notify:notice,importVideo:async(src,name)=>{stop();const mime=src.startsWith('data:video/webm')?'video/webm':'video/mp4',l=await loadAsset(src,name,mime);checkpoint();appendLayer(l);selected=l.id;if(Number.isFinite(l.media?.duration)){total=Math.max(total,Math.ceil(l.media.duration*fps));$('duration').value=total;}seekMedia();refresh();}});
