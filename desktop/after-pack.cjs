// Pure JS resource editing lets Linux build Windows icons without Wine.
const fs=require('node:fs/promises');
const path=require('node:path');
module.exports=async function afterPack(context){
 if(context.electronPlatformName!=='win32')return;
 const PE=await import('pe-library');
 const ResEdit=await import('resedit');
 const exePath=path.join(context.appOutDir,context.packager.appInfo.productFilename+'.exe');
 const exe=PE.NtExecutable.from(await fs.readFile(exePath),{ignoreCert:true});
 const resources=PE.NtExecutableResource.from(exe);
 const icon=ResEdit.Data.IconFile.from(await fs.readFile(path.join(context.packager.projectDir,'assets/icon.ico')));
 const groups=ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
 for(const group of groups)ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries,group.id,group.lang,icon.icons.map(item=>item.data));
 if(!groups.length)ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries,101,1033,icon.icons.map(item=>item.data));
 for(const version of ResEdit.Resource.VersionInfo.fromEntries(resources.entries)){
  version.setStringValues({lang:1033,codepage:1200},{FileDescription:'ANIMASTER — animation studio',ProductName:'ANIMASTER',CompanyName:'ANIMASTER',OriginalFilename:'ANIMASTER.exe',InternalName:'ANIMASTER'});
  version.setFileVersion(0,1,0,0,1033);version.setProductVersion(0,1,0,0,1033);version.outputToResourceEntries(resources.entries);
 }
 resources.outputResource(exe);
 await fs.writeFile(exePath,Buffer.from(exe.generate()));
};
