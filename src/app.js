import {poseAt,framePose,tweenSpan,transformPoint,axisScales,constrainHandles,encodeWav,remapFrames,varyColor,spatialNoise,floodFill,removeColor,cornersOf,validCorners} from './engine.js';
import {drawWarp} from './warp.js';
import {MAP_TEMPLATES} from './templates.js';
const $=id=>document.getElementById(id),stage=$('stage'),ctx=stage.getContext('2d'),W=960,H=540;
let layers=[],selected=null,frame=0,total=1,fps=24,tool='pencil',playing=false,playbackRun=0,onion=false,gesture=null,history=[],redoHistory=[],selectedFrames=new Set([0]),selectionAnchor=0,clipboard=null,audioContext,audioDest,exporting=false;
const initialPose=()=>({x:0,y:0,scale:1,scaleX:1,scaleY:1,opacity:1,rotation:0});
function poseFor(layer,f){return framePose(layer,f,total,$('loop').checked);}
const selectedLayer=()=>layers.find(l=>l.id===selected);
const notice=s=>$('status').textContent=s;
function surface(){const c=document.createElement('canvas');c.width=W;c.height=H;return c;}
const transparent=surface();
const brushCursor=document.createElement('div');brushCursor.id='brushCursor';brushCursor.hidden=true;brushCursor.setAttribute('aria-hidden','true');document.body.append(brushCursor);
let cursorPoint=null;
function updateBrushCursor(){
 const l=selectedLayer(),r=stage.getBoundingClientRect(),p=cursorPoint;
 const show=p&&!playing&&!exporting&&!document.querySelector('dialog[open]')&&l&&l.kind!=='audio'&&l.kind!=='video'&&['pencil','eraser'].includes(tool)&&p.x>=r.left&&p.x<=r.right&&p.y>=r.top&&p.y<=r.bottom;
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
function newLayer(name='Рисунок',kind='drawing'){const c=surface();return {id:crypto.randomUUID(),name,kind,canvas:c,visible:true,aspectLocked:false,freeCorners:false,chroma:null,keys:{0:initialPose()},drawings:kind==='drawing'?{0:c}:{},tweens:[],media:null,src:null};}
function cloneCanvas(c){const n=surface();n.getContext('2d').drawImage(c,0,0);return n;}
function drawingAt(l,f){
 if(l.drawings[f])return l.drawings[f];
 if(!l.tweens?.includes(f))return l.kind==='drawing'?transparent:l.canvas;
 const span=tweenSpan(l.keys,f,total,$('loop').checked);
 const c=surface(),g=c.getContext('2d');if(!span)return c;
 const {before,after,t}=span;g.globalAlpha=1-t;g.drawImage(l.drawings[before]|| (l.kind==='image'?l.canvas:transparent),0,0);g.globalAlpha=t;g.globalCompositeOperation='lighter';g.drawImage(l.drawings[after]||(l.kind==='image'?l.canvas:transparent),0,0);return c;
}
function editCanvas(l){if(!l.drawings[frame])l.drawings[frame]=cloneCanvas(drawingAt(l,frame));if(!l.keys[frame])l.keys[frame]=poseFor(l,frame);l.tweens=l.tweens.filter(f=>f!==frame);return l.drawings[frame];}
function snapshot(){return {layers:layers.map(l=>({...l,keys:structuredClone(l.keys),chroma:structuredClone(l.chroma),tweens:[...l.tweens],canvas:cloneCanvas(l.canvas),drawings:Object.fromEntries(Object.entries(l.drawings).map(([f,c])=>[f,cloneCanvas(c)]))})),selected,frame,total,selectedFrames:[...selectedFrames],selectionAnchor};}
function checkpoint(){history.push(snapshot());if(history.length>20)history.shift();redoHistory=[];}
function restore(s){stop();for(const l of layers)if(!s.layers.some(x=>x.media===l.media))l.media?.pause();({layers,selected,frame,total,selectionAnchor}=s);selectedFrames=new Set(s.selectedFrames);for(const l of layers){l.videoCacheKey=null;l.rawVideoTime=null;}$('duration').value=total;seekMedia();refresh();}
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
function render(target=ctx,f=frame){
 target.clearRect(0,0,W,H);target.imageSmoothingEnabled=true;target.imageSmoothingQuality='high';
 for(const l of layers){
  if(!l.visible||l.kind==='audio')continue;
  const p=poseFor(l,f),{sx,sy}=axisScales(p);target.save();target.translate(p.x+W*sx/2,p.y+H*sy/2);target.rotate((p.rotation||0)*Math.PI/180);target.scale(sx,sy);target.translate(-W/2,-H/2);target.globalAlpha=p.opacity;
  const warped=p.corners&&validCorners(p.corners)&&p.corners.some((v,i)=>Math.hypot(v.x-cornersOf()[i].x,v.y-cornersOf()[i].y)>.001);
  if(l.kind==='video'){const source=videoSurface(l);warped?drawWarp(target,source,p.corners):target.drawImage(source,0,0);}
  else if(warped){drawWarp(target,l.kind==='drawing'||l.drawings[f]||l.tweens.includes(f)?drawingAt(l,f):l.canvas,p.corners);}
  else if(l.kind==='image'&&l.original&&!l.drawings[f]&&(!l.tweens.includes(f)||!Object.keys(l.drawings).length)){const image=l.original,ratio=Math.min(W/image.width,H/image.height,1);target.drawImage(image,(W-image.width*ratio)/2,(H-image.height*ratio)/2,image.width*ratio,image.height*ratio);}
  else target.drawImage(l.kind==='drawing'||l.drawings[f]||l.tweens.includes(f)?drawingAt(l,f):l.canvas,0,0);
  target.restore();
 }
}
function paint(){updateBrushCursor();render();if(onion&&frame>0&&!playing){ctx.save();ctx.globalAlpha=.18;const c=surface();render(c.getContext('2d'),frame-1);ctx.drawImage(c,0,0);ctx.restore();}const l=selectedLayer();if(tool==='move'&&l&&l.kind!=='audio'&&!playing&&!exporting)drawEditHandles(poseFor(l,frame));}
function editHandles(p){
 const specs=[['resize',8,8,-1,-1],['resize',W-8,8,1,-1],['resize',W-8,H-8,1,1],['resize',8,H-8,-1,1],['width',8,H/2,-1,0],['width',W-8,H/2,1,0],['height',W/2,8,0,-1],['height',W/2,H-8,0,1],['rotate',W/2,50,0,0]];
 const layer=selectedLayer();
 const handles=layer?.freeCorners?cornersOf().map((point,index)=>({kind:'corner',index,point:transformPoint(point,p)})):specs.map(([kind,x,y,dx,dy])=>({kind,dx,dy,point:transformPoint({x,y},p)}));
 return constrainHandles(handles,W,H,22*W/stage.getBoundingClientRect().width);
}
function drawEditHandles(p){const handles=editHandles(p),corners=handles.slice(0,4),r=6*W/stage.getBoundingClientRect().width;ctx.save();ctx.strokeStyle='#aa86ff';ctx.lineWidth=1.5*W/stage.getBoundingClientRect().width;ctx.beginPath();corners.forEach((h,i)=>i?ctx.lineTo(h.point.x,h.point.y):ctx.moveTo(h.point.x,h.point.y));ctx.closePath();ctx.stroke();for(const h of handles){ctx.fillStyle=h.kind==='rotate'?'#adf086':h.kind==='corner'?'#ffbb74':'#ffffff';ctx.beginPath();if(h.kind==='rotate')ctx.arc(h.point.x,h.point.y,r*1.2,0,Math.PI*2);else ctx.rect(h.point.x-r,h.point.y-r,r*2,r*2);ctx.fill();ctx.stroke();}ctx.restore();}

function promoteFrame(l){if(l.tweens.includes(frame)){if(l.kind==='drawing'||l.kind==='image')l.drawings[frame]=cloneCanvas(drawingAt(l,frame));l.tweens=l.tweens.filter(f=>f!==frame);}}
function properties(){const l=selectedLayer();if(!l)return;const p=poseFor(l,frame);$('posX').value=Math.round(p.x);$('posY').value=Math.round(p.y);$('scale').value=Math.round(p.scale*100);$('aspectLock').setAttribute('aria-pressed',String(l.aspectLocked));$('aspectLock').textContent=l.aspectLocked?'🔒 Стороны связаны':'🔓 Связать стороны';const {sx,sy}=axisScales(p);$('scaleX').value=Math.round(sx*100);$('scaleY').value=Math.round(sy*100);$('opacity').value=Math.round(p.opacity*100);$('rotation').value=Math.round((p.rotation||0)*10)/10;$('freeCorners').checked=l.freeCorners;$('restoreVideoBg').hidden=l.kind!=='video'||!l.chroma?.enabled;if(l.kind==='video'&&l.chroma?.enabled){$('tolerance').value=l.chroma.tolerance;$('toleranceValue').value=l.chroma.tolerance;}}
function layerUI(){const parent=$('layers');parent.replaceChildren();for(const l of [...layers].reverse()){const row=document.createElement('div');row.className='layer'+(l.id===selected?' selected':'');const eye=document.createElement('button');eye.textContent=l.visible?'◉':'○';eye.title='Видимость слоя';eye.onclick=e=>{e.stopPropagation();checkpoint();l.visible=!l.visible;refresh();};const icon=document.createElement('span');icon.className='layer-type';icon.textContent=l.kind==='audio'?'♫':l.kind==='video'?'▷':'▧';const name=document.createElement('span');name.className='layer-name';name.textContent=l.name;name.ondblclick=()=>{const n=prompt('Название слоя',l.name);if(n){checkpoint();l.name=n;refresh();}};const up=document.createElement('button');up.textContent='↑';up.title='Поднять слой';up.onclick=e=>{e.stopPropagation();const i=layers.indexOf(l);checkpoint();if(i<layers.length-1)[layers[i],layers[i+1]]=[layers[i+1],layers[i]];refresh();};row.append(eye,icon,name,up);row.onclick=()=>{selected=l.id;refresh();};parent.append(row);}}
function timeline(){const parent=$('tracks');const scroll=parent.scrollLeft;parent.replaceChildren();const ruler=document.createElement('div');ruler.className='track';const label=document.createElement('span');label.className='track-label';label.textContent='КАДР / СЛОЙ';ruler.append(label);for(let f=0;f<total;f++){const c=document.createElement('div');c.className='cell'+(f===frame?' current':'')+(selectedFrames.has(f)?' frame-selected':'');c.textContent=f===0||(f+1)%5===0?f+1:'·';c.onclick=e=>setFrame(f,e.shiftKey);ruler.append(c);}parent.append(ruler);for(const l of [...layers].reverse()){const row=document.createElement('div');row.className='track'+(l.id===selected?' selected':'');const n=document.createElement('span');n.className='track-label';n.textContent=l.name;row.append(n);const keys=Object.keys(l.keys).map(Number);for(let f=0;f<total;f++){const c=document.createElement('div');const key=Object.hasOwn(l.keys,f),tween=!key&&(l.tweens.includes(f)&&$('loop').checked?Boolean(tweenSpan(l.keys,f,total,true)):keys.some(k=>k<f)&&keys.some(k=>k>f));c.className='cell'+(key?' key':tween?' tween':'')+(f===frame?' current':'')+(selectedFrames.has(f)?' frame-selected':'');c.textContent=key?'◆':l.tweens.includes(f)?'A':l.kind==='video'?'▸':tween?'·':'';c.title=`${l.name} · кадр ${f+1}`;c.onclick=e=>{selected=l.id;setFrame(f,e.shiftKey);};c.ondblclick=()=>{selected=l.id;setFrame(f);addKey();};row.append(c);}parent.append(row);}parent.scrollLeft=scroll;$('timecode').textContent=`${String(frame+1).padStart(3,'0')} / ${String(total).padStart(3,'0')}`;}
function refresh(){paint();properties();layerUI();timeline();}
function setFrame(f,extend=false){if(exporting)return;stop();frame=Math.max(0,Math.min(total-1,f));if(extend){selectedFrames=new Set(Array.from({length:Math.abs(frame-selectionAnchor)+1},(_,i)=>Math.min(frame,selectionAnchor)+i));}else{selectedFrames=new Set([frame]);selectionAnchor=frame;}seekMedia();refresh();}
function seekMedia(){for(const l of layers)if(l.media){const t=frame/fps;if(Number.isFinite(l.media.duration))l.media.currentTime=Math.min(t,Math.max(0,l.media.duration-.001));}}
function stop(){playing=false;playbackRun++;$('play').textContent='▶';for(const l of layers)l.media?.pause();}
async function play(){
 if(playing){stop();return;}
 if(frame===total-1)frame=0;
 playing=true;const run=++playbackRun;$('play').textContent='Ⅱ';seekMedia();
 const startMedia=()=>{for(const l of layers)if(l.media&&l.visible)l.media.play().catch(()=>notice('Нажмите воспроизведение ещё раз для включения звука.'));};
 startMedia();const start=performance.now()-frame/fps*1000;let cycle=0;
 function tick(now){
  if(!playing||run!==playbackRun)return;
  const elapsed=Math.floor((now-start)*fps/1000),nextCycle=Math.floor(elapsed/total);
  if(!$('loop').checked&&nextCycle>cycle){frame=total-1;paint();properties();timeline();stop();return;}
  frame=elapsed%total;
  if(nextCycle!==cycle){cycle=nextCycle;seekMedia();startMedia();}
  paint();properties();timeline();requestAnimationFrame(tick);
 }
 requestAnimationFrame(tick);
}

function insertFrame(kind){
 const l=selectedLayer();if(!l||exporting)return;
 if(total>=600){notice('Максимум 600 кадров. Удалите кадр перед вставкой.');return;}
 stop();checkpoint();const at=frame+1,pose=poseFor(l,frame),image=kind==='key'&&l.kind==='drawing'?cloneCanvas(drawingAt(l,frame)):null;
 layers=layers.map(layer=>remapFrames(layer,f=>f>=at?f+1:f));
 const target=selectedLayer();if(kind==='key'){target.keys[at]={...pose};if(image)target.drawings[at]=image;}else target.tweens.push(at);
 total++;frame=at;selectedFrames=new Set([frame]);selectionAnchor=frame;$('duration').value=total;seekMedia();refresh();
 notice(`${kind==='key'?'Ключевой':'A-'} кадр вставлен на позиции ${frame+1}. Следующие кадры сдвинуты вправо.`);
}
function addKey(){insertFrame('key');}
function addTween(){insertFrame('tween');}
function deleteFrames(){
 if(exporting)return;const removed=[...selectedFrames].filter(f=>f>=0&&f<total).sort((a,b)=>a-b);if(!removed.length)return;
 stop();checkpoint();const gone=new Set(removed),start=removed[0];
 layers=layers.map(l=>remapFrames(l,f=>gone.has(f)?null:f-removed.filter(n=>n<f).length));
 total=Math.max(1,total-removed.length);frame=Math.min(start,total-1);selectedFrames=new Set([frame]);selectionAnchor=frame;$('duration').value=total;seekMedia();refresh();
 notice(`Удалено кадров: ${removed.length}. Следующие кадры сдвинуты влево.${removed.length===gone.size&&total===1?' В проекте остаётся минимум один кадр.':''}`);
}
function addLayer(){if(exporting)return;stop();checkpoint();const l=newLayer(`Рисунок ${layers.length+1}`);if(frame!==0){l.keys={[frame]:initialPose()};l.drawings={[frame]:l.canvas};}layers.push(l);selected=l.id;refresh();notice('Добавлен новый слой · Backspace — удалить.');}
function deleteLayer(){if(exporting||!selectedLayer())return;stop();checkpoint();selectedLayer().media?.pause();layers=layers.filter(l=>l.id!==selected);selected=layers.at(-1)?.id;refresh();notice('Слой удалён · Z — отменить.');}
function copyFrames(){const l=selectedLayer();if(!l)return;const start=Math.min(...selectedFrames);clipboard=[...selectedFrames].sort((a,b)=>a-b).map(f=>({offset:f-start,key:l.keys[f]?structuredClone(l.keys[f]):null,tween:l.tweens.includes(f),drawing:l.drawings[f]?cloneCanvas(l.drawings[f]):null}));notice(`Скопировано кадров: ${clipboard.length} · V — вставить.`);}
function pasteFrames(){const l=selectedLayer();if(!l||!clipboard||exporting)return;const items=clipboard.filter(c=>frame+c.offset<600);checkpoint();for(const c of items){const f=frame+c.offset;delete l.keys[f];delete l.drawings[f];l.tweens=l.tweens.filter(n=>n!==f);if(c.key)l.keys[f]=structuredClone(c.key);if(c.tween)l.tweens.push(f);if(c.drawing)l.drawings[f]=cloneCanvas(c.drawing);total=Math.max(total,f+1);}selectedFrames=new Set(items.map(c=>frame+c.offset));$('duration').value=total;refresh();notice(`Вставлено кадров: ${items.length}.`);}
function coords(e){const r=stage.getBoundingClientRect();return{x:(e.clientX-r.left)*W/r.width,y:(e.clientY-r.top)*H/r.height};}
function local(p,l){return transformPoint(p,poseFor(l,frame),true);}
function rgba(){const s=$('color').value;return [parseInt(s.slice(1,3),16),parseInt(s.slice(3,5),16),parseInt(s.slice(5,7),16),255];}
stage.onpointerdown=e=>{if(exporting||e.button!==0)return;stop();let l=selectedLayer();if(!l||l.kind==='audio')return;const p=coords(e);checkpoint(l);stage.setPointerCapture(e.pointerId);if(tool==='move'){const pose=poseFor(l,frame);const radius=14*W/stage.getBoundingClientRect().width;const handle=editHandles(pose).find(h=>Math.hypot(h.point.x-p.x,h.point.y-p.y)<=radius);promoteFrame(l);l.keys[frame]={...pose};gesture={l,start:p,pose,action:handle?.kind||'move',handle,center:transformPoint({x:W/2,y:H/2},pose)};return;}if(l.kind==='video'){if(tool!=='remove'){notice('Для рисования поверх видео добавьте отдельный слой.');return;}const q=local(p,l),x=Math.floor(q.x),y=Math.floor(q.y);if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>=W||y>=H)return;const pixel=videoSurface(l,true).getContext('2d').getImageData(x,y,1,1).data;if(!pixel[3]){notice('Нажмите на цвет внутри видео.');return;}l.chroma={enabled:true,color:Array.from(pixel.slice(0,3)),tolerance:+$('tolerance').value};l.videoCacheKey=null;refresh();notice('Цвет удаляется на всех кадрах видео. Настройте допуск при необходимости.');return;}const c=editCanvas(l),g=c.getContext('2d',{willReadFrequently:true}),q=local(p,l);if(tool==='fill'||tool==='remove'){const d=g.getImageData(0,0,W,H);if(tool==='fill')floodFill(d.data,W,H,q.x,q.y,rgba());else{const x=Math.floor(q.x),y=Math.floor(q.y);if(x<0||y<0||x>=W||y>=H)return;const o=(y*W+x)*4;removeColor(d.data,Array.from(d.data.slice(o,o+4)),+$('tolerance').value);}g.putImageData(d,0,0);refresh();return;}gesture={l,g,last:q,seed:Math.random()*10000};stroke(g,q,q);if($('brushShape').value==='spray')gesture.sprayTimer=setInterval(()=>{if(gesture?.g){stroke(gesture.g,gesture.last,gesture.last);paint();}},65);refresh();};
const brushStamp=document.createElement('canvas');
function stroke(g,a,b){
 const shape=$('brushShape').value,size=+$('brush').value,variation=tool==='eraser'?0:+$('colorVariation').value/100,base=rgba().slice(0,3),seed=gesture?.seed||0;
 const shade=(x,y)=>{const rgb=varyColor(base,variation,spatialNoise(x,y,seed));return `rgb(${rgb.join(',')})`;};
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
stage.onpointermove=e=>{if(!gesture)return;const p=coords(e),g=gesture;if(tool==='move'){let next={...g.pose};if(g.action==='corner'){const angle=(g.pose.rotation||0)*Math.PI/180,dx=p.x-g.start.x,dy=p.y-g.start.y,{sx,sy}=axisScales(g.pose),corners=cornersOf(g.pose).map(v=>({...v}));corners[g.handle.index].x+=(dx*Math.cos(angle)+dy*Math.sin(angle))/sx;corners[g.handle.index].y+=(-dx*Math.sin(angle)+dy*Math.cos(angle))/sy;if(validCorners(corners))next.corners=corners;else{notice('Углы не должны пересекаться.');return;}}else if(['resize','width','height'].includes(g.action)){const angle=(g.pose.rotation||0)*Math.PI/180,dx=p.x-g.start.x,dy=p.y-g.start.y,localX=dx*Math.cos(angle)+dy*Math.sin(angle),localY=-dx*Math.sin(angle)+dy*Math.cos(angle),axes=axisScales(g.pose);let sx=g.action==='height'?axes.sx:Math.max(.01,axes.sx+g.handle.dx*2*localX/W),sy=g.action==='width'?axes.sy:Math.max(.01,axes.sy+g.handle.dy*2*localY/H);if(g.l.aspectLocked){const value=g.action==='height'?sy:g.action==='width'?sx:Math.abs(localX/W)>=Math.abs(localY/H)?sx:sy;sx=value;sy=value;}next.scaleX=sx/g.pose.scale;next.scaleY=sy/g.pose.scale;next.x=g.center.x-W*sx/2;next.y=g.center.y-H*sy/2;}else if(g.action==='rotate'){const displayed=editHandles(g.pose).slice(0,4),center={x:displayed.reduce((sum,h)=>sum+h.point.x,0)/4,y:displayed.reduce((sum,h)=>sum+h.point.y,0)/4};const a=Math.atan2(p.y-center.y,p.x-center.x)-Math.atan2(g.start.y-center.y,g.start.x-center.x);next.rotation=(g.pose.rotation||0)+Math.atan2(Math.sin(a),Math.cos(a))*180/Math.PI;}else{next.x+=p.x-g.start.x;next.y+=p.y-g.start.y;}g.l.keys[frame]=next;properties();}else{const q=local(p,g.l);stroke(g.g,g.last,q);g.last=q;}paint();};
stage.onpointerup=stage.onpointercancel=()=>{if(gesture){clearInterval(gesture.sprayTimer);gesture=null;refresh();}};
const names={move:'↖ Редактировать',pencil:'✎ Карандаш',fill:'◩ Заливка',eraser:'▱ Ластик',remove:'✂ Удаление цвета'};
function selectTool(t){tool=t;document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===t));$('toolName').textContent=names[t];stage.style.cursor=t==='move'?'move':'crosshair';paint();}
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>selectTool(b.dataset.tool));
function scaleValue(id,fallback){const value=Number($(id).value)/100;return Number.isFinite(value)&&value>0?Math.max(.01,value):fallback;}
for(const id of ['posX','posY','scale','scaleX','scaleY','opacity','rotation'])$(id).onchange=()=>{
 const l=selectedLayer();if(!l)return;checkpoint();const p=poseFor(l,frame),axes=axisScales(p);promoteFrame(l);
 const next={...p,x:Number($('posX').value)||0,y:Number($('posY').value)||0,scale:scaleValue('scale',p.scale),opacity:Math.max(0,Math.min(1,Number($('opacity').value)/100)),rotation:Number($('rotation').value)||0};
 if(id==='scaleX'||id==='scaleY'){
  let sx=scaleValue('scaleX',axes.sx),sy=scaleValue('scaleY',axes.sy);
  if(l.aspectLocked){const value=id==='scaleX'?sx:sy;sx=value;sy=value;}
  next.scaleX=sx/next.scale;next.scaleY=sy/next.scale;
 }
 l.keys[frame]=next;refresh();
};
$('aspectLock').onclick=()=>{
 const l=selectedLayer();if(!l||exporting)return;checkpoint();l.aspectLocked=!l.aspectLocked;
 if(l.aspectLocked){const p=poseFor(l,frame);promoteFrame(l);l.keys[frame]={...p,scaleY:p.scaleX??1};}
 refresh();notice(l.aspectLocked?'Замок включён: ширина и высота масштабируются одинаково.':'Замок выключен: стороны меняются независимо.');
};
$('freeCorners').onchange=()=>{const l=selectedLayer();if(!l)return;checkpoint();l.freeCorners=$('freeCorners').checked;selectTool('move');refresh();notice(l.freeCorners?'Свободные углы: тяните оранжевые маркеры. Переходы сохраняются на A-кадрах.':'Обычное масштабирование включено.');};
$('resetCorners').onclick=()=>{const l=selectedLayer();if(!l)return;checkpoint();const pose=poseFor(l,frame);promoteFrame(l);l.keys[frame]={...pose,corners:cornersOf().map(p=>({...p}))};refresh();};
$('restoreVideoBg').onclick=()=>{const l=selectedLayer();if(!l?.chroma)return;checkpoint();l.chroma.enabled=false;l.videoCacheKey=null;refresh();notice('Фон видео восстановлен.');};
$('tolerance').onpointerdown=()=>{if(selectedLayer()?.kind==='video'&&selectedLayer()?.chroma?.enabled)checkpoint();};
$('addLayer').onclick=addLayer;$('deleteLayer').onclick=deleteLayer;
$('addKey').onclick=addKey;$('addTween').onclick=addTween;$('undo').onclick=undo;$('redo').onclick=redo;$('deleteKey').onclick=deleteFrames;
stage.addEventListener('wheel',e=>{if(!['pencil','eraser'].includes(tool)||exporting)return;e.preventDefault();const v=Math.max(1,Math.min(500,+$('brush').value+(e.deltaY<0?3:e.deltaY>0?-3:0)));$('brush').value=v;$('brushValue').value=v+' px';updateBrushCursor();notice(`${tool==='eraser'?'Ластик':'Кисть'}: ${v} px`);},{passive:false});
$('brushShape').onchange=()=>{updateBrushCursor();notice('Кисть: '+$('brushShape').selectedOptions[0].textContent);};
$('colorVariation').oninput=()=>$('variationValue').value=$('colorVariation').value+'%';
function syncPalette(){document.querySelectorAll('[data-palette]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.palette===$('color').value.toLowerCase())));}
$('color').addEventListener('input',syncPalette);
document.querySelectorAll('[data-palette]').forEach(b=>b.onclick=()=>{$('color').value=b.dataset.palette;syncPalette();notice('Цвет: '+b.title);});
$('brush').oninput=()=>{$('brushValue').value=$('brush').value+' px';updateBrushCursor();};$('tolerance').oninput=()=>{$('toleranceValue').value=$('tolerance').value;const l=selectedLayer();if(l?.kind==='video'&&l.chroma?.enabled){l.chroma={...l.chroma,tolerance:+$('tolerance').value};l.videoCacheKey=null;paint();}};
$('fps').onchange=()=>{stop();fps=Math.max(1,Math.min(60,Math.round(+$('fps').value)||24));$('fps').value=fps;for(const l of layers)if(l.kind==='video'&&Number.isFinite(l.media?.duration))total=Math.min(600,Math.max(total,Math.ceil(l.media.duration*fps)));$('duration').value=total;seekMedia();refresh();};
$('duration').onchange=()=>{checkpoint();stop();total=Math.max(1,Math.min(600,Math.round(+$('duration').value)||1));$('duration').value=total;frame=Math.min(frame,total-1);selectedFrames=new Set([frame]);selectionAnchor=frame;seekMedia();refresh();};
$('loop').addEventListener('change',()=>{refresh();notice($('loop').checked?'Повтор включён: конечные A-кадры переходят к первому ключу.':'Повтор выключен.');});
$('first').onclick=()=>setFrame(0);$('last').onclick=()=>setFrame(total-1);$('play').onclick=play;$('onion').onclick=()=>{onion=!onion;$('onion').classList.toggle('active',onion);paint();};$('fit').onclick=()=>{fitCanvas();notice('Холст вписан в рабочую область.');};
function readData(file){return new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=no;r.readAsDataURL(file);});}
async function loadAsset(src,name,type){const kind=type.startsWith('audio/')?'audio':type.startsWith('video/')?'video':'image',l=newLayer(name,kind);l.src=src;l.mime=type;if(kind==='image'){const img=new Image();await new Promise((ok,no)=>{img.onload=ok;img.onerror=no;img.src=src;});l.original=img;const s=Math.min(W/img.width,H/img.height,1);l.canvas.getContext('2d').drawImage(img,(W-img.width*s)/2,(H-img.height*s)/2,img.width*s,img.height*s);if(type==='image/gif')notice('GIF импортирован как статичное изображение. Для анимированного источника используйте MP4.');}else{const media=document.createElement(kind==='audio'?'audio':'video');media.preload='auto';media.playsInline=true;await new Promise((ok,no)=>{media.onloadeddata=ok;media.onerror=()=>no(Error('Браузер не поддерживает кодек файла'));media.src=src;media.load();});l.media=media;
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
    checkpoint();layers.push(layer);selected=layer.id;total=Math.min(600,Math.max(total,Math.ceil(audio.duration*fps)));$('duration').value=total;seekMedia();refresh();notice(`Запись добавлена отдельным слоем: ${audio.duration.toFixed(1)} с. Кнопка ▶ — прослушать.`);
   }catch(err){notice('Не удалось сохранить запись: '+err.message);}
   finally{if(decoder)await decoder.close().catch(()=>{});micIdle();}
  };
  rec.start();micStarted=performance.now();micPending=false;$('microphone').disabled=false;$('microphone').textContent='■ Остановить запись';$('microphone').setAttribute('aria-pressed','true');
  const update=()=>{const seconds=(performance.now()-micStarted)/1000;$('recordTime').textContent=`● Запись ${seconds.toFixed(1)} с`;if(seconds>=600/fps&&rec.state==='recording'){rec.stop();releaseMicrophone();}};
  update();micTimer=setInterval(update,100);notice('Идёт запись с микрофона. Нажмите кнопку ещё раз, чтобы остановить.');
 }catch(err){releaseMicrophone();micIdle();notice(err.name==='NotAllowedError'?'Доступ к микрофону запрещён. Разрешите его в настройках сайта и нажмите запись снова.':err.name==='NotFoundError'?'Микрофон не найден. Подключите его и попробуйте снова.':'Не удалось включить микрофон: '+err.message);}
};
window.addEventListener('pagehide',()=>{if(micRecorder?.state==='recording')micRecorder.stop();releaseMicrophone();});
$('templates').onclick=()=>{stop();$('templatesDialog').showModal();updateBrushCursor();};
for(const template of MAP_TEMPLATES){
 const card=document.createElement('button');card.type='button';card.className='template-card';
 const preview=document.createElement('img');preview.src=template.src;preview.alt=template.name;const title=document.createElement('span');title.textContent=template.name;card.append(preview,title);
 card.onclick=async()=>{card.disabled=true;try{const l=await loadAsset(template.src,template.name,'image/svg+xml');checkpoint();layers.push(l);selected=l.id;$('templatesDialog').close();refresh();notice('Добавлен шаблон: '+template.name);}catch(err){notice('Не удалось добавить карту: '+err.message);}finally{card.disabled=false;}};
 $('templateCards').append(card);
}
const lessons=[
 {title:'Начните с рисунка',intro:'Это ваш холст. Рисуйте мышью или пером на выбранном кадре.',steps:['1 — карандаш, 2 — ластик, 3 — заливка, 4 — редактирование.','Справа выберите круг, квадрат или спрей. Колесо над холстом меняет размер кисти.','Выберите цвет слева или оттенок из палитры. Разброс светлоты делает мазок неоднородным.']},
 {title:'Оживите рисунок',intro:'Ключи хранят рисунок и положение. A-кадры плавно соединяют соседние ключи.',steps:['Q вставляет ключ сразу после текущего кадра; A вставляет промежуточный кадр.','На следующем ключе измените рисунок или положение. Между ключами добавьте A-кадры.','Нажмите ▶. Повтор замыкает последние A-кадры к первому ключу.']},
 {title:'Кадры и слои',intro:'Слои позволяют отдельно редактировать фон, персонажей и звук.',steps:['Пробел создаёт слой, Backspace удаляет выбранный слой.','Shift + ЛКМ выделяет диапазон кадров. C копирует, V вставляет, Delete удаляет.','Z отменяет действие, Y возвращает его. Рисование изменяет только текущий кадр.']},
 {title:'Перемещение и свободные углы',intro:'Нажмите 4 для редактирования выбранного слоя.',steps:['Тяните слой для перемещения, боковые маркеры для размера, зелёный круг для поворота.','Включите «Свободные углы». Тяните оранжевые маркеры — каждый угол меняет форму независимо.','Измените углы на двух ключах: A-кадры плавно переместят углы между ними. Кнопка «Сбросить углы» вернёт прямоугольник.']},
 {title:'Видео, фон и карты',intro:'Импортируйте файлы или начните со встроенного шаблона.',steps:['Кнопка «Шаблоны карт» добавляет карту мира, Европы или Африки отдельным слоем.','Для удаления фона выберите слой и инструмент «Убрать фон» (K), затем нажмите на нужный цвет.','В видео цвет удаляется на всех кадрах. Допуск регулирует близкие оттенки, «Восстановить фон видео» отключает фильтр.']},
 {title:'Звук, сохранение и скачивание',intro:'Сохраните работу, чтобы вернуться к ней позже.',steps:['Кнопка микрофона записывает звук. Повторное нажатие остановит запись и создаст звуковой слой.','«Сохранить» оставляет проект в этом браузере; «↓ Проект» скачивает .animaster для продолжения работы.','«↓ Анимация» → «Создать видео» → «Скачать видео» сохраняет готовый WebM со звуком. Во время создания держите вкладку открытой.']}
];
let lesson=0;
function showLesson(){const item=lessons[lesson];$('tutorialCounter').textContent=`Шаг ${lesson+1} из ${lessons.length}`;$('tutorialTitle').textContent=item.title;$('tutorialIntro').textContent=item.intro;$('tutorialSteps').replaceChildren(...item.steps.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));$('tutorialBack').disabled=lesson===0;$('tutorialNext').textContent=lesson===lessons.length-1?'Начать работу':'Далее';}
$('helpButton').onclick=()=>{stop();lesson=0;showLesson();$('tutorialDialog').showModal();updateBrushCursor();};
$('tutorialBack').onclick=()=>{if(lesson>0){lesson--;showLesson();}};
$('tutorialNext').onclick=()=>{if(lesson===lessons.length-1)$('tutorialDialog').close();else{lesson++;showLesson();}};
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('close',()=>updateBrushCursor());
$('import').onclick=()=>$('files').click();$('files').onchange=async e=>{stop();for(const file of e.target.files){try{if(!/\.(mp4|png|gif|mp3|jpe?g|webp)$/i.test(file.name))throw Error('Неподдерживаемый формат');notice('Импорт: '+file.name);const l=await loadAsset(await readData(file),file.name,file.type||(/\.mp3$/i.test(file.name)?'audio/mpeg':/\.mp4$/i.test(file.name)?'video/mp4':'image/png'));checkpoint();layers.push(l);selected=l.id;if(l.media&&Number.isFinite(l.media.duration)){total=Math.min(600,Math.max(total,Math.ceil(l.media.duration*fps)));$('duration').value=total;}seekMedia();refresh();if(l.mime!=='image/gif')notice('Файл добавлен: '+file.name);}catch(err){notice('Не удалось импортировать '+file.name+': '+err.message);}}e.target.value='';};
function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),30000);}
function filename(){return $('projectName').value.replace(/[<>:"/\\|?*]/g,'_')||'ANIMASTER';}
function projectData(){return {version:1,name:$('projectName').value,fps,total,loop:$('loop').checked,brushSettings:{shape:$('brushShape').value,size:+$('brush').value,variation:+$('colorVariation').value,color:$('color').value},layers:layers.map(l=>({id:l.id,name:l.name,kind:l.kind,visible:l.visible,aspectLocked:l.aspectLocked,freeCorners:l.freeCorners,chroma:l.chroma,keys:l.keys,tweens:l.tweens,src:l.src,mime:l.mime,canvas:l.canvas.toDataURL(),drawings:Object.fromEntries(Object.entries(l.drawings).map(([f,c])=>[f,c.toDataURL()]))}))};}
function saveProjectFile(){try{download(new Blob([JSON.stringify(projectData())],{type:'application/json'}),filename()+'.animaster');notice('Проект скачан. Откройте файл .animaster, чтобы продолжить редактирование.');}catch(err){notice('Не удалось скачать проект: '+err.message);}}
$('save').onclick=saveProjectFile;
$('downloadProject').onclick=saveProjectFile;
function projectStorage(mode,value){return new Promise((resolve,reject)=>{
 const request=indexedDB.open('animaster-projects',1);let db;
 request.onupgradeneeded=()=>request.result.createObjectStore('projects');
 request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('Закройте другие вкладки ANIMASTER и повторите.'));
 request.onsuccess=()=>{db=request.result;const tx=db.transaction('projects',mode),store=tx.objectStore('projects');const op=mode==='readwrite'?store.put(value,'latest'):store.get('latest');let result;op.onsuccess=()=>result=op.result;tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=tx.onerror=()=>{db.close();reject(tx.error||Error('Хранилище недоступно'));};};
});}
async function showSaveDialog(){
 $('saveDialog').showModal();$('restoreLocal').disabled=true;$('localSaveInfo').textContent='Проверяем сохранение…';
 try{const stored=await projectStorage('readonly');$('restoreLocal').disabled=!stored;$('localSaveInfo').textContent=stored?`Сохранено: ${stored.data.name} · ${new Date(stored.savedAt).toLocaleString('ru-RU')}`:'В этом браузере пока нет сохранённого проекта.';}
 catch{$('localSaveInfo').textContent='Хранилище браузера недоступно. Скачайте файл проекта.';}
}
$('saveLocal').onclick=showSaveDialog;
$('writeLocal').onclick=async()=>{
 $('writeLocal').disabled=true;try{const value={data:projectData(),savedAt:Date.now()};await projectStorage('readwrite',value);$('localSaveInfo').textContent=`Сохранено: ${value.data.name} · ${new Date(value.savedAt).toLocaleString('ru-RU')}`;$('restoreLocal').disabled=false;notice('Проект сохранён в этом браузере.');}
 catch(err){$('localSaveInfo').textContent='Не удалось сохранить: '+err.message+'. Скачайте файл проекта.';}finally{$('writeLocal').disabled=false;}
};
$('restoreLocal').onclick=async()=>{try{const stored=await projectStorage('readonly');if(!stored)throw Error('Сохранение не найдено');await loadProject(stored.data);$('saveDialog').close();}catch(err){$('localSaveInfo').textContent='Не удалось открыть сохранение: '+err.message;}};

async function imageCanvas(src){const c=surface(),img=new Image();await new Promise((ok,no)=>{img.onload=ok;img.onerror=no;img.src=src;});c.getContext('2d').drawImage(img,0,0);return c;}
$('openProject').onclick=()=>$('projectFile').click();async function loadProject(d){if(d.version!==1||!Array.isArray(d.layers)||d.layers.length>100||!Number.isInteger(d.fps)||d.fps<1||d.fps>60||!Number.isInteger(d.total)||d.total<1||d.total>600)throw Error('Некорректный проект');const loaded=[];for(const a of d.layers){if(!['drawing','image','video','audio'].includes(a.kind)||!a.keys)throw Error('Некорректный слой');for(const [f,p] of Object.entries(a.keys))if(!/^\d+$/.test(f)||!['x','y','scale','opacity'].every(k=>Number.isFinite(p[k]))||p.scale<=0||(p.rotation!==undefined&&!Number.isFinite(p.rotation))||['scaleX','scaleY'].some(k=>p[k]!==undefined&&(!Number.isFinite(p[k])||p[k]<=0))||(p.corners!==undefined&&!validCorners(p.corners)))throw Error('Некорректный ключ');if(a.src&&!a.src.startsWith('data:'))throw Error('Внешние источники не разрешены');const l=a.kind==='drawing'?newLayer(a.name):await loadAsset(a.src,a.name,a.mime);l.keys=a.keys;l.aspectLocked=a.aspectLocked===true;l.freeCorners=a.freeCorners===true;if(a.chroma){if(!Array.isArray(a.chroma.color)||a.chroma.color.length!==3||!a.chroma.color.every(v=>Number.isFinite(v)&&v>=0&&v<=255)||!Number.isFinite(a.chroma.tolerance)||a.chroma.tolerance<0||a.chroma.tolerance>180)throw Error('Некорректный фильтр цвета');l.chroma={color:[...a.chroma.color],tolerance:a.chroma.tolerance,enabled:a.chroma.enabled===true};}l.tweens=Array.isArray(a.tweens)?a.tweens.filter(f=>Number.isInteger(f)&&f>=0&&f<d.total):[];l.visible=a.visible;l.canvas=await imageCanvas(a.canvas);l.drawings={};for(const [f,s] of Object.entries(a.drawings||{}))l.drawings[f]=await imageCanvas(s);loaded.push(l);}stop();layers=loaded;fps=d.fps;total=d.total;frame=0;selected=layers.at(-1)?.id;history=[];redoHistory=[];selectedFrames=new Set([0]);selectionAnchor=0;$('projectName').value=d.name;$('fps').value=fps;$('duration').value=total;$('loop').checked=d.loop===true;if(d.brushSettings){const b=d.brushSettings;$('brushShape').value=['circle','square','spray'].includes(b.shape)?b.shape:'circle';$('brush').value=Number.isFinite(b.size)?Math.max(1,Math.min(500,b.size)):8;$('colorVariation').value=Number.isFinite(b.variation)?Math.max(0,Math.min(100,b.variation)):0;if(/^#[0-9a-f]{6}$/i.test(b.color))$('color').value=b.color;$('brushValue').value=$('brush').value+' px';$('variationValue').value=$('colorVariation').value+'%';syncPalette();}refresh();notice('Проект открыт.');}
$('projectFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{await loadProject(JSON.parse(await file.text()));}catch(err){notice('Ошибка открытия: '+err.message);}e.target.value='';};
$('export').onclick=()=>$('exportDialog').showModal();
$('png').onclick=()=>{const s=+$('exportSize').value,c=document.createElement('canvas');c.width=W*s;c.height=H*s;const g=c.getContext('2d');g.scale(s,s);render(g);c.toBlob(b=>download(b,filename()+'.png'),'image/png');notice('PNG экспортирован. Качество PNG всегда без потерь.');};
let readyVideoUrl=null;
async function exportVideo(){if(exporting)return;if(!window.MediaRecorder||!HTMLCanvasElement.prototype.captureStream){notice('Запись видео недоступна в этом браузере. Используйте Chrome или Edge.');return;}if(micRecorder?.state==='recording'){notice('Остановите запись микрофона перед скачиванием анимации.');return;}stop();$('exportDialog').close();$('renderDialog').showModal();$('renderProgress').value=0;$('renderText').textContent='Подготавливаем анимацию…';$('videoResult').hidden=true;$('renderClose').disabled=true;const oldFrame=frame,s=+$('exportSize').value,c=document.createElement('canvas');c.width=W*s;c.height=H*s;const g=c.getContext('2d');g.scale(s,s);let stream=c.captureStream(0);if(!stream.getVideoTracks()[0]?.requestFrame){stream.getTracks().forEach(t=>t.stop());stream=c.captureStream(fps);}const videoTrack=stream.getVideoTracks()[0];let recordedFrame=-1;const mediaLayers=layers.filter(l=>l.visible&&l.media);try{if(mediaLayers.length){audioContext??=new AudioContext();await audioContext.resume();audioDest??=audioContext.createMediaStreamDestination();for(const l of mediaLayers){if(!l.audioNode){l.audioNode=audioContext.createMediaElementSource(l.media);l.audioNode.connect(audioContext.destination);}l.audioNode.connect(audioDest);}for(const t of audioDest.stream.getAudioTracks())stream.addTrack(t);}const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));if(!mime)throw Error('WebM не поддерживается');const rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:Math.round(8000000*+$('quality').value*s*s)}),chunks=[];const done=new Promise((ok,no)=>{rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};rec.onstop=ok;rec.onerror=no;});frame=0;seekMedia();await Promise.all(mediaLayers.map(l=>new Promise(resolve=>{if(!l.media.seeking)return resolve();l.media.addEventListener('seeked',resolve,{once:true});})));render(g,0);exporting=true;rec.start();await Promise.all(mediaLayers.map(l=>l.media.play().catch(()=>{})));videoTrack.requestFrame?.();const start=performance.now();await new Promise(resolve=>{function tick(now){const f=Math.floor((now-start)*fps/1000);if(f>=total){render(g,total-1);videoTrack.requestFrame?.();return resolve();}frame=f;render(g,f);if(f!==recordedFrame){videoTrack.requestFrame?.();recordedFrame=f;}paint();const progress=Math.round((f+1)/total*100);$('renderProgress').value=progress;$('renderText').textContent=`Создаём видео: ${progress}%`;notice(`Экспорт видео: ${progress}%`);requestAnimationFrame(tick);}requestAnimationFrame(tick);});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));rec.stop();await done;const blob=new Blob(chunks,{type:mime});if(!blob.size)throw Error('Браузер создал пустое видео');if(readyVideoUrl)URL.revokeObjectURL(readyVideoUrl);readyVideoUrl=URL.createObjectURL(blob);$('videoPreview').src=readyVideoUrl;$('downloadVideo').href=readyVideoUrl;$('downloadVideo').download=filename()+'.webm';$('videoResult').hidden=false;$('renderProgress').value=100;$('renderText').textContent='Анимация готова! Скачайте видео кнопкой ниже.';notice('Анимация готова — нажмите «Скачать видео».');}catch(err){notice('Ошибка экспорта: '+err.message);$('renderText').textContent='Не удалось создать видео: '+err.message;}finally{$('renderClose').disabled=false;exporting=false;stop();stream.getVideoTracks().forEach(t=>t.stop());for(const l of mediaLayers)if(l.audioNode)try{l.audioNode.disconnect(audioDest);}catch{}frame=oldFrame;seekMedia();refresh();}}
$('video').onclick=exportVideo;
$('renderDialog').addEventListener('cancel',e=>{if($('renderClose').disabled)e.preventDefault();});
$('renderClose').onclick=()=>{$('videoPreview').pause();$('renderDialog').close();};
document.addEventListener('keydown',e=>{
 if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||e.target.isContentEditable||exporting||document.querySelector('dialog[open]')||gesture)return;
 const code=e.code,modified=e.ctrlKey||e.metaKey;
 const actions={KeyQ:addKey,KeyA:addTween,KeyZ:e.shiftKey?redo:undo,KeyY:redo,Digit1:()=>selectTool('pencil'),Digit2:()=>selectTool('eraser'),Digit3:()=>selectTool('fill'),Digit4:()=>selectTool('move'),KeyC:copyFrames,KeyV:pasteFrames,KeyB:()=>selectTool('pencil'),KeyE:()=>selectTool('eraser'),KeyF:()=>selectTool('fill'),KeyK:()=>selectTool('remove'),KeyM:()=>selectTool('move'),Space:addLayer,Delete:deleteFrames,Backspace:deleteLayer,ArrowRight:()=>setFrame(frame+1,e.shiftKey),ArrowLeft:()=>setFrame(frame-1,e.shiftKey)};
 if(modified&&!['KeyZ','KeyY','KeyC','KeyV'].includes(code))return;
 if(actions[code]){e.preventDefault();if(!e.repeat)actions[code]();}
});
const first=newLayer('Рисунок 1');layers=[first];selected=first.id;refresh();new ResizeObserver(()=>{$('zoom').textContent=Math.round(stage.getBoundingClientRect().width/W*100)+'%';}).observe(stage);

function fitCanvas(){const area=document.querySelector('.stage-area');const style=getComputedStyle(area);const availableWidth=area.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);const availableHeight=area.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom)-70;const width=Math.max(100,Math.min(W,availableWidth,availableHeight*W/H));stage.style.width=width+'px';stage.style.height=width*H/W+'px';const density=Math.max(1,window.devicePixelRatio||1),backingWidth=Math.max(W,Math.round(width*density)),backingHeight=Math.round(backingWidth*H/W);if(stage.width!==backingWidth||stage.height!==backingHeight){stage.width=backingWidth;stage.height=backingHeight;ctx.setTransform(backingWidth/W,0,0,backingHeight/H,0,0);paint();}updateBrushCursor();}
new ResizeObserver(fitCanvas).observe(document.querySelector('.stage-area'));
fitCanvas();
