import {MAP_COUNTRIES,COUNTRY_FLAGS} from './templates.js';
export const TEXT_FONTS=['Arial','Verdana','Georgia','Times New Roman','Courier New','sans-serif'];
const flagCache=new Map();
export function loadFlag(code){
 if(!flagCache.has(code))flagCache.set(code,new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('Флаг не загрузился: '+code));image.src=COUNTRY_FLAGS[code];}));
 return flagCache.get(code);
}
export function textSurface(layer){
 const data=layer.textData,key=JSON.stringify(data);if(layer.textCache===key)return layer.canvas;
 const g=layer.canvas.getContext('2d');g.clearRect(0,0,960,540);g.font=`${data.size}px "${data.font}"`;g.textBaseline='top';g.lineJoin='round';g.fillStyle=data.color;g.strokeStyle=data.outline;g.lineWidth=data.outlineWidth*2;
 data.text.split('\n').forEach((line,i)=>{const y=data.y+i*data.size*1.25;if(data.outlineWidth>0)g.strokeText(line,data.x,y);g.fillText(line,data.x,y);});layer.textCache=key;return layer.canvas;
}
export async function prepareMap(layer,data,regenerate=true){
 const definition=MAP_COUNTRIES[data.id];if(!definition)throw Error('Неизвестный шаблон карты');
 const codes=[...new Set(definition.countries.map(c=>c.code))];
 layer.flagImages=Object.fromEntries(await Promise.all(codes.map(async code=>[code,await loadFlag(code)])));
 layer.mapData={id:data.id,yearStart:Number.isFinite(data.yearStart)?data.yearStart:1900,yearEnd:Number.isFinite(data.yearEnd)?data.yearEnd:2026,selectedFlag:codes.includes(data.selectedFlag)?data.selectedFlag:codes[0]};
 layer.mapDefinition=definition;layer.mapPaths=definition.countries.map(c=>({...c,path:new Path2D(c.d),parts:(c.parts||[c]).map(part=>({...part,path:new Path2D(part.d)}))}));layer.landPath=new Path2D(definition.countries.map(c=>c.d).join(''));
 if(regenerate){const g=layer.canvas.getContext('2d');g.clearRect(0,0,960,540);g.save();const clip=definition.clip;g.beginPath();g.rect(clip.x,clip.y,clip.w,clip.h);g.clip();
  for(const country of layer.mapPaths){g.save();g.clip(country.path,'evenodd');for(const part of country.parts){const b=part.bounds;g.save();g.clip(part.path,'evenodd');g.drawImage(layer.flagImages[country.code],b.x,b.y,b.w,b.h);g.restore();}g.restore();g.strokeStyle='#25232d';g.lineWidth=.7;g.stroke(country.path);}
  g.restore();
 }
}
export function territoryStroke(layer,canvas,a,b,size){
 const g=canvas.getContext('2d'),image=layer.flagImages[layer.mapData.selectedFlag],pattern=g.createPattern(image,'repeat');if(!pattern)return;
 pattern.setTransform(new DOMMatrix().scale(120/image.width,90/image.height));g.save();const clip=layer.mapDefinition.clip;g.beginPath();g.rect(clip.x,clip.y,clip.w,clip.h);g.clip();g.clip(layer.landPath,'nonzero');g.strokeStyle=pattern;g.lineWidth=size;g.lineCap='round';g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x+.001,b.y+.001);g.stroke();g.restore();
}
