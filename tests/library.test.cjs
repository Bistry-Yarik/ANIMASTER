const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createLibrary}=require('../desktop/library.cjs');
const thumbnail='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
test('project library persists multiple projects and updates rather than duplicates',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'animaster-library-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));const library=createLibrary(folder);
 await library.save({id:'project-a',data:{version:1,projectId:'project-a',name:'Первая'},thumbnail});await library.save({id:'project-b',data:{version:1,projectId:'project-b',name:'Вторая'},thumbnail});
 assert.equal((await library.list()).length,2);assert.equal((await library.load('project-a.animaster')).name,'Первая');
 await library.save({id:'project-a',data:{version:1,projectId:'project-a',name:'Изменённая'},thumbnail});const entries=await library.list();assert.equal(entries.length,2);assert.equal(entries.find(e=>e.id==='project-a.animaster').name,'Изменённая');assert.equal(entries[0].thumbnail,thumbnail);assert((await fs.readFile(path.join(folder,'project-a.png'))).length>20);
});
test('library rejects path traversal and keeps readable projects beside damaged files',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'animaster-library-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));const library=createLibrary(folder);
 await library.save({id:'safe',data:{version:1,name:'Безопасное'},thumbnail});await fs.writeFile(path.join(folder,'broken.animaster'),'broken');await fs.writeFile(path.join(folder,'manual.animaster'),JSON.stringify({version:1,name:'Внешний файл'}));
 assert.equal((await library.list()).length,2);await assert.rejects(library.load('../outside.animaster'));await assert.rejects(library.save({id:'../../outside',data:{version:1,name:'Bad'},thumbnail}));assert.equal((await library.load('manual.animaster')).name,'Внешний файл');
});
