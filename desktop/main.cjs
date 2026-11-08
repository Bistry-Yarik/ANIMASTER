const {app,BrowserWindow,session,ipcMain,dialog,shell,clipboard}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const {readClipboardFiles}=require('./clipboard.cjs');
const {createLibrary}=require('./library.cjs');
app.setName('AMS');
app.setPath('userData',path.join(app.getPath('appData'),'ANIMASTER'));
if(process.env.ANIMASTER_PROFILE_DIR){fs.mkdirSync(process.env.ANIMASTER_PROFILE_DIR,{recursive:true});app.setPath('userData',process.env.ANIMASTER_PROFILE_DIR);}
const singleInstance=app.requestSingleInstanceLock();
if(!singleInstance)app.quit();
let window;
function createWindow(){
 window=new BrowserWindow({title:'AMS — Animaster Steam 2.0',width:1440,height:1000,minWidth:760,minHeight:620,backgroundColor:'#18191e',icon:path.join(__dirname,'../assets/icon.png'),show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
 window.setMenu(null);
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',(event,url)=>{if(url!==window.webContents.getURL())event.preventDefault();});
 window.once('ready-to-show',()=>window.show());
 window.on('closed',()=>{window=null;});
 window.loadFile(path.join(__dirname,'../index.html'));
}
if(singleInstance){
 app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
 app.whenReady().then(async()=>{
  const trusted=contents=>contents&&window&&contents===window.webContents;
  session.defaultSession.setPermissionRequestHandler((contents,permission,callback,details)=>callback(Boolean(trusted(contents)&&permission==='media'&&details.mediaTypes?.every(type=>type==='audio'))));
  session.defaultSession.setPermissionCheckHandler((contents,permission,origin,details)=>Boolean(trusted(contents)&&permission==='media'&&details.mediaType==='audio'));
  let folder=process.env.ANIMASTER_LIBRARY_DIR||path.join(app.getPath('documents'),'ANIMASTER','Анимации');
  const settings=path.join(app.getPath('userData'),'library-settings.json');
  if(!process.env.ANIMASTER_LIBRARY_DIR)try{const saved=JSON.parse(await fsp.readFile(settings,'utf8'));if(typeof saved.folder==='string')folder=saved.folder;}catch{}
  const handle=(channel,fn)=>ipcMain.handle(channel,(event,...args)=>{if(!trusted(event.sender)||event.senderFrame!==window.webContents.mainFrame)throw Error('Доступ запрещён');return fn(...args);});
  handle('clipboard:files',()=>readClipboardFiles(clipboard));handle('clipboard:text',()=>clipboard.readText());
  handle('library:list',()=>createLibrary(folder).list());handle('library:save',record=>createLibrary(folder).save(record));handle('library:load',id=>createLibrary(folder).load(id));handle('library:folder',()=>folder);
  handle('library:open-folder',async()=>{await fsp.mkdir(folder,{recursive:true});const error=await shell.openPath(folder);if(error)throw Error(error);});
  handle('library:choose-folder',async()=>{const result=await dialog.showOpenDialog(window,{title:'Папка анимаций ANIMASTER',defaultPath:folder,properties:['openDirectory','createDirectory']});if(!result.canceled){folder=result.filePaths[0];await fsp.mkdir(app.getPath('userData'),{recursive:true});await fsp.writeFile(settings,JSON.stringify({folder}));}return folder;});
  session.defaultSession.on('will-download',(event,item)=>{const dir=process.env.ANIMASTER_DOWNLOAD_DIR||app.getPath('downloads');fs.mkdirSync(dir,{recursive:true});const name=path.basename(item.getFilename()),extension=path.extname(name),stem=path.basename(name,extension);let target=path.join(dir,name),n=1;while(fs.existsSync(target))target=path.join(dir,`${stem} (${n++})${extension}`);item.setSavePath(target);});
  createWindow();
  app.on('activate',()=>{if(!window)createWindow();});
 });
 app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
}
