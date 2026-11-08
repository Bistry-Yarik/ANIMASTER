import {territoryComponents,paintTerritory,encodeOwners,decodeOwners} from './territories.js';
import {MAP_COUNTRIES,COUNTRY_FLAGS} from './templates.js';
export const TEXT_FONTS=['Arial','Verdana','Georgia','Times New Roman','Courier New','sans-serif','Lobster','Pacifico','Caveat','Oswald','Rubik','Russo One','Comfortaa','Amatic SC','Tahoma','Trebuchet MS','Impact','Comic Sans MS','Palatino Linotype','Lucida Console'];
const flagCache=new Map();
export function loadFlag(code,src=COUNTRY_FLAGS[code]){
 if(!flagCache.has(src))flagCache.set(src,new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('Флаг не загрузился: '+code));image.src=src;}));
 return flagCache.get(src);
}
export function textSurface(layer){
 const data=layer.textData,key=JSON.stringify(data);if(layer.textCache===key)return layer.canvas;
 const g=layer.canvas.getContext('2d');g.clearRect(0,0,960,540);g.font=`${data.size}px "${data.font}"`;g.textBaseline='top';g.lineJoin='round';g.fillStyle=data.color;g.strokeStyle=data.outline;g.lineWidth=data.outlineWidth*2;
 data.text.split('\n').forEach((line,i)=>{const y=data.y+i*data.size*1.25;if(data.outlineWidth>0)g.strokeText(line,data.x,y);g.fillText(line,data.x,y);});layer.textCache=key;layer.guideRevision=(layer.guideRevision||0)+1;layer.canvas.guideRevision=(layer.canvas.guideRevision||0)+1;return layer.canvas;
}
export async function prepareMap(layer,data,regenerate=true){
 const definition=MAP_COUNTRIES[data.id];if(!definition)throw Error('Неизвестный шаблон карты');
 const custom=Array.isArray(data.customCountries)?data.customCountries:[];if(custom.some(c=>!/^custom-[a-zA-Z0-9-]+$/.test(c.id)||typeof c.name!=='string'||!c.name.trim()||c.name.length>80||typeof c.flag!=='string'||!c.flag.startsWith('data:image/png;base64,')))throw Error('Некорректная страна');const codes=[...new Set([...definition.countries.map(c=>c.code),...custom.map(c=>c.id)])];
 layer.flagImages=Object.fromEntries(await Promise.all(codes.map(async code=>[code,await loadFlag(code,custom.find(c=>c.id===code)?.flag||COUNTRY_FLAGS[code])])));
 layer.mapData={showYear:data.showYear!==false,customCountries:structuredClone(custom),id:data.id,yearStart:Number.isFinite(data.yearStart)?data.yearStart:1900,yearEnd:Number.isFinite(data.yearEnd)?data.yearEnd:2026,selectedFlag:codes.includes(data.selectedFlag)?data.selectedFlag:codes[0],ownershipVersion:1,legacyTerritories:data.legacyTerritories===true||(!regenerate&&!data.ownershipVersion)};
 layer.mapDefinition=definition;layer.mapPaths=definition.countries.map(c=>({...c,path:new Path2D(c.d),parts:(c.parts||[c]).map(part=>({...part,path:new Path2D(part.d)}))}));layer.landPath=new Path2D(definition.countries.map(c=>c.d).join(''));
 layer.ownerCodes=codes;layer.mapOwners={};layer.baseOwners=new Uint16Array(960*540);
 const mask=document.createElement('canvas');mask.width=960;mask.height=540;const mg=mask.getContext('2d',{willReadFrequently:true}),clip=definition.clip;
 for(const country of layer.mapPaths){mg.clearRect(0,0,960,540);mg.save();mg.beginPath();mg.rect(clip.x,clip.y,clip.w,clip.h);mg.clip();mg.fillStyle='#fff';mg.fill(country.path,'evenodd');mg.restore();const pixels=mg.getImageData(0,0,960,540).data,id=codes.indexOf(country.code)+1;for(let i=0;i<layer.baseOwners.length;i++)if(pixels[i*4+3]>=128)layer.baseOwners[i]=id;}
 layer.baseMap=renderTerritories(layer,layer.baseOwners);
 if(regenerate){const g=layer.canvas.getContext('2d');g.clearRect(0,0,960,540);g.drawImage(layer.baseMap,0,0);}
}
const flagPixels=new WeakMap(),territoryRasters=new WeakMap();
function renderTerritories(layer,owners){
 if(territoryRasters.has(owners))return territoryRasters.get(owners);
 const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;const g=canvas.getContext('2d'),pixels=g.createImageData(960,540),components=territoryComponents(owners,960,540);
 for(const part of components){const image=layer.flagImages[layer.ownerCodes[part.owner-1]];if(!image)continue;let flag=flagPixels.get(image);if(!flag){const c=document.createElement('canvas');c.width=256;c.height=192;const cg=c.getContext('2d');cg.drawImage(image,0,0,256,192);flag=cg.getImageData(0,0,256,192).data;flagPixels.set(image,flag);}
  const {center,bounds}=part,scale=Math.max((center.x-bounds.x)*2/256,(bounds.x+bounds.w-center.x)*2/256,(center.y-bounds.y)*2/192,(bounds.y+bounds.h-center.y)*2/192,1/256);
  for(const p of part.pixels){const x=p%960,y=Math.floor(p/960),u=Math.max(0,Math.min(255,Math.floor((x+.5-center.x)/scale+128))),v=Math.max(0,Math.min(191,Math.floor((y+.5-center.y)/scale+96))),o=p*4,f=(v*256+u)*4;pixels.data.set(flag.subarray(f,f+4),o);
   if((x>0&&owners[p-1]!==part.owner)||(x<959&&owners[p+1]!==part.owner)||(y>0&&owners[p-960]!==part.owner)||(y<539&&owners[p+960]!==part.owner)){pixels.data[o]=37;pixels.data[o+1]=35;pixels.data[o+2]=45;pixels.data[o+3]=255;}
  }
 }
 g.putImageData(pixels,0,0);canvas.territoryCenters=components.map(({owner,center,bounds})=>({code:layer.ownerCodes[owner-1],center,bounds}));territoryRasters.set(owners,canvas);return canvas;
}
export function mapOwnersAt(layer,frame){return layer.mapOwners?.[frame]||layer.baseOwners;}
export function territoryStroke(layer,canvas,a,b,size,frame){
 const g=canvas.getContext('2d',{willReadFrequently:true});if(!layer.mapOwners[frame])layer.mapOwners[frame]=mapOwnersAt(layer,frame).slice();const owners=layer.mapOwners[frame],before=renderTerritories(layer,owners),old=g.getImageData(0,0,960,540),expected=before.getContext('2d').getImageData(0,0,960,540);
 const changed=paintTerritory(owners,layer.baseOwners,960,540,a,b,size,layer.ownerCodes.indexOf(layer.mapData.selectedFlag)+1);if(!changed.length)return;
 territoryRasters.delete(owners);const updated=renderTerritories(layer,owners),next=updated.getContext('2d').getImageData(0,0,960,540),painted=new Set(changed);
 // Preserve ordinary pencil marks and legacy raster edits outside this brush stroke.
 for(let i=0;i<owners.length;i++){if(painted.has(i))continue;const o=i*4;if([0,1,2,3].some(k=>Math.abs(old.data[o+k]-expected.data[o+k])>2))next.data.set(old.data.subarray(o,o+4),o);}
 g.putImageData(next,0,0);layer.territoryCenters=updated.territoryCenters;
}
export function serializeOwnership(layer){return layer.mapData?{codes:layer.ownerCodes,frames:Object.fromEntries(Object.entries(layer.mapOwners).map(([f,owners])=>[f,encodeOwners(owners)]))}:undefined;}
export function restoreOwnership(layer,data,total){
 if(!data)return;if(!Array.isArray(data.codes)||data.codes.length>65535||!data.codes.every(code=>layer.ownerCodes.includes(code))||!data.frames||Object.keys(data.frames).length>total)throw Error('Некорректные территории');
 for(const [frame,runs] of Object.entries(data.frames)){if(!/^\d+$/.test(frame)||Number(frame)>=total)throw Error('Некорректный кадр территории');const owners=decodeOwners(runs,960*540,data.codes.length);for(let i=0;i<owners.length;i++){if(!layer.baseOwners[i])owners[i]=0;else if(owners[i])owners[i]=layer.ownerCodes.indexOf(data.codes[owners[i]-1])+1;}layer.mapOwners[frame]=owners;}
}
