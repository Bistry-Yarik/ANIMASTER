const {_electron}=require('playwright-core');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'animaster-native-')),folder=path.join(temp,'animations'),downloads=path.join(temp,'downloads'),profile=path.join(temp,'profile');let app;
 const start=async()=>{app=await _electron.launch({executablePath:require('electron'),args:[...(process.platform==='linux'?['--no-sandbox','--ozone-platform=headless','--disable-gpu']:[]),path.join(__dirname,'..')],env:{...process.env,ANIMASTER_LIBRARY_DIR:folder,ANIMASTER_DOWNLOAD_DIR:downloads,ANIMASTER_PROFILE_DIR:profile},timeout:25000});const page=await app.firstWindow();await page.locator('#libraryTitle').waitFor();return page;};
 try{
  let page=await start();assert.equal(await page.evaluate(()=>window.animasterLibrary.folder()),folder);await page.locator('#newProject').click();await page.locator('#projectName').evaluate(e=>e.value='Native library');await page.locator('#saveLocal').click();await page.locator('#writeLocal').click();await page.waitForFunction(()=>document.querySelector('#localSaveInfo').textContent.startsWith('Сохранено:'));
  const files=fs.readdirSync(folder).filter(n=>n.endsWith('.animaster'));assert.equal(files.length,1);assert.equal(JSON.parse(fs.readFileSync(path.join(folder,files[0]))).name,'Native library');assert(fs.readdirSync(folder).some(n=>n.endsWith('.png')));
  await page.locator('#saveDialog .close').click();await page.locator('#save').click();for(let i=0;i<60&&(!fs.existsSync(downloads)||!fs.readdirSync(downloads).length);i++)await new Promise(r=>setTimeout(r,100));assert(fs.readdirSync(downloads).some(n=>n.endsWith('.animaster')));
  await app.close();app=null;page=await start();await page.locator('.save-card').filter({hasText:'Native library'}).click();await page.waitForFunction(()=>document.querySelector('#status').textContent==='Проект открыт.');assert.equal(await page.locator('#projectName').inputValue(),'Native library');
  console.log('PASS Electron native folder, preview file, direct Downloads, startup gallery and restore after restart');
 }finally{await app?.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
