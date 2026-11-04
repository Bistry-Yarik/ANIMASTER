import {readFile,writeFile} from 'node:fs/promises';
const read=path=>readFile(new URL(path,import.meta.url),'utf8');
const [shell,css,engine,app,logo]=await Promise.all(['src/shell.html','src/style.css','src/engine.js','src/app.js','logo.svg'].map(read));
const icon='data:image/svg+xml;base64,'+Buffer.from(logo).toString('base64');
const code=engine.replaceAll('export function ','function ')+'\n'+app.replace(/^import .*?;\s*/, '');
const html=shell.replace('<link rel="stylesheet" href="/src/style.css">',()=>'<style>'+css+'</style>').replaceAll('/logo.svg',icon).replace('<script type="module" src="/src/app.js"></script>',()=>'<script type="module">'+code.replaceAll('</script','<\\/script')+'</script>');
await writeFile(new URL('index.html',import.meta.url),html);
console.log('Built standalone index.html (styles, icon and application included)');
