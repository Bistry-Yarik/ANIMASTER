const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('animasterLibrary',Object.freeze({
 list:()=>ipcRenderer.invoke('library:list'),
 save:record=>ipcRenderer.invoke('library:save',record),
 load:id=>ipcRenderer.invoke('library:load',id),
 folder:()=>ipcRenderer.invoke('library:folder'),
 openFolder:()=>ipcRenderer.invoke('library:open-folder'),
 chooseFolder:()=>ipcRenderer.invoke('library:choose-folder')
}));
