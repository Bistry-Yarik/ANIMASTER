const fs=require('node:fs/promises');
const path=require('node:path');
const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(id);
function createLibrary(folder){
 const file=id=>{if(typeof id!=='string'||path.basename(id)!==id||!id.endsWith('.animaster')||id.startsWith('.'))throw Error('Некорректное сохранение');return path.join(folder,id);};
 const atomic=async(p,data)=>{const temp=p+'.tmp';await fs.writeFile(temp,data);await fs.rename(temp,p);};
 return {
  async save({id,data,thumbnail}){
   if(!validId(id)||!data||data.version!==1||typeof data.name!=='string')throw Error('Некорректный проект');
   if(typeof thumbnail!=='string'||!thumbnail.startsWith('data:image/png;base64,'))throw Error('Некорректное превью');
   const image=Buffer.from(thumbnail.split(',')[1],'base64');if(image.length>4*1024*1024)throw Error('Превью слишком большое');
   await fs.mkdir(folder,{recursive:true});const name=id+'.animaster',updatedAt=Date.now();
   await atomic(file(name),JSON.stringify(data));await atomic(path.join(folder,id+'.png'),image);
   await atomic(path.join(folder,id+'.meta.json'),JSON.stringify({id:name,projectId:id,name:data.name,updatedAt}));
   return {id:name,projectId:id,name:data.name,updatedAt,thumbnail};
  },
  async list(){
   await fs.mkdir(folder,{recursive:true});const names=(await fs.readdir(folder)).filter(n=>n.endsWith('.animaster')&&!n.startsWith('.'));const entries=[];
   for(const name of names){try{
    const stat=await fs.stat(file(name)),stem=name.slice(0,-10);let info;
    try{info=JSON.parse(await fs.readFile(path.join(folder,stem+'.meta.json'),'utf8'));}catch{const d=JSON.parse(await fs.readFile(file(name),'utf8'));info={name:d.name||stem,projectId:d.projectId};}
    let thumbnail='';try{thumbnail='data:image/png;base64,'+(await fs.readFile(path.join(folder,stem+'.png'))).toString('base64');}catch{}
    entries.push({...info,id:name,thumbnail,updatedAt:stat.mtimeMs});
   }catch{/* A damaged user file must not hide the other saves. */}}
   return entries.sort((a,b)=>b.updatedAt-a.updatedAt);
  },
  async load(id){const d=JSON.parse(await fs.readFile(file(id),'utf8'));if(d.version!==1)throw Error('Неизвестный формат проекта');return d;}
 };
}
module.exports={createLibrary};
