const {app,BrowserWindow,session}=require('electron');
const path=require('node:path');
app.setName('ANIMASTER');
const singleInstance=app.requestSingleInstanceLock();
if(!singleInstance)app.quit();
let window;
function createWindow(){
 window=new BrowserWindow({title:'ANIMASTER',width:1440,height:1000,minWidth:760,minHeight:620,backgroundColor:'#18191e',icon:path.join(__dirname,'../assets/icon.png'),show:false,autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',(event,url)=>{if(url!==window.webContents.getURL())event.preventDefault();});
 window.once('ready-to-show',()=>window.show());
 window.on('closed',()=>{window=null;});
 window.loadFile(path.join(__dirname,'../index.html'));
}
if(singleInstance){
 app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
 app.whenReady().then(()=>{
  const trusted=contents=>contents&&window&&contents===window.webContents;
  session.defaultSession.setPermissionRequestHandler((contents,permission,callback,details)=>callback(Boolean(trusted(contents)&&permission==='media'&&details.mediaTypes?.every(type=>type==='audio'))));
  session.defaultSession.setPermissionCheckHandler((contents,permission,origin,details)=>Boolean(trusted(contents)&&permission==='media'&&details.mediaType==='audio'));
  session.defaultSession.on('will-download',(event,item)=>item.setSaveDialogOptions({title:'Сохранить — ANIMASTER',defaultPath:path.join(app.getPath('downloads'),path.basename(item.getFilename()))}));
  createWindow();
  app.on('activate',()=>{if(!window)createWindow();});
 });
 app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
}
