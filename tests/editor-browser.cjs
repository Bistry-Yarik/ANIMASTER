const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const root=path.join(__dirname,'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'animaster-ui-'));
const executable=process.env.BROWSER_EXECUTABLE||['/usr/bin/chromium',path.join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe')].find(p=>fs.existsSync(p));
const identity={x:0,y:0,scale:1,opacity:1,rotation:0};
let browser;
(async()=>{
 assert(executable,'Set BROWSER_EXECUTABLE to Chrome/Chromium');
 browser=await chromium.launch({executablePath:executable,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1100},acceptDownloads:true});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(root,'index.html'),'utf8')}):route.abort());
 await page.goto('http://localhost:5173');await page.waitForSelector('.layer');await page.locator('#newProject').click();
 const fixture=async data=>{await page.locator('#projectFile').setInputFiles({name:'test.animaster',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});await page.waitForFunction(()=>document.querySelector('#status').textContent==='Проект открыт.');};
 const cell=f=>page.locator('#tracks .track').first().locator('.cell').nth(f);
 const pixel=(x,y)=>page.evaluate(([x,y])=>{const canvas=document.querySelector('#stage'),g=canvas.getContext('2d');return [...g.getImageData(Math.round(x*canvas.width/960),Math.round(y*canvas.height/540),1,1).data];},[x,y]);
 const solid=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=960;c.height=540;const g=c.getContext('2d');g.fillStyle='#ff00ff';g.fillRect(0,0,960,540);return c.toDataURL();});
 const video='data:video/mp4;base64,'+fs.readFileSync(path.join(__dirname,'fixtures/chroma-motion.mp4')).toString('base64');
 await fixture({version:1,name:'Video chroma',fps:4,total:4,loop:true,layers:[{kind:'image',name:'Background',visible:true,keys:{0:identity},canvas:solid,src:solid,mime:'image/png',drawings:{}},{kind:'video',name:'Video',visible:true,keys:{0:identity},tweens:[1,2,3],canvas:solid,src:video,mime:'video/mp4',drawings:{}}]});
 await page.locator('[data-tool=remove]').click();let box=await page.locator('#stage').boundingBox();
 await page.mouse.click(box.x+900*box.width/960,box.y+300*box.height/540);
 let color=await pixel(900,300);assert(color[0]>240&&color[2]>240&&color[1]<10,'video background should show magenta layer');
 color=await pixel(100,200);assert(color[0]>220&&color[1]<40&&color[2]<40,'foreground must remain red');
 await cell(3).click();await page.waitForFunction(()=>{const c=document.querySelector('#stage'),d=c.getContext('2d').getImageData(400*c.width/960,200*c.height/540,1,1).data;return d[0]>220&&d[1]<40&&d[2]<40;});
 color=await pixel(50,200);assert(color[0]>240&&color[2]>240,'video must keep moving after removal on A frames');
 await page.locator('#restoreVideoBg').click();color=await pixel(900,300);assert(color[1]>220&&color[0]<40);
 await page.keyboard.press('z');color=await pixel(900,300);assert(color[0]>240&&color[2]>240,'undo restores chroma effect');
 let downloadPromise=page.waitForEvent('download');await page.locator('#save').click();let download=await downloadPromise;
 const projectPath=path.join(temp,'chroma.animaster');await download.saveAs(projectPath);assert(JSON.parse(fs.readFileSync(projectPath,'utf8')).layers[1].chroma.enabled);
 await page.locator('#projectFile').setInputFiles(projectPath);await page.waitForFunction(()=>document.querySelector('#status').textContent==='Проект открыт.');
 color=await pixel(900,300);assert(color[0]>240&&color[2]>240,'project round-trip retains chroma');
 await page.locator('#export').click();await page.locator('#video').click();await page.waitForFunction(()=>!document.querySelector('#videoResult').hidden);
 await page.locator('#videoPreview').evaluate(v=>v.currentTime=.75);await page.waitForTimeout(150);
 color=await page.locator('#videoPreview').evaluate(v=>{const c=document.createElement('canvas');c.width=960;c.height=540;const g=c.getContext('2d');g.drawImage(v,0,0);return [...g.getImageData(900,300,1,1).data];});
 assert(color[0]>220&&color[2]>220&&color[1]<30,'export retains chroma compositing');await page.locator('#renderClose').click();
 console.log('PASS video chroma: moving video, A frames, restore/undo, save/open and exported video');

 const corners=[{x:160,y:80},{x:960,y:0},{x:960,y:540},{x:0,y:540}];
 await fixture({version:1,name:'Corner interpolation',fps:4,total:4,loop:true,layers:[{kind:'image',name:'Shape',visible:true,freeCorners:true,keys:{0:identity,2:{...identity,corners}},tweens:[1,3],canvas:solid,src:solid,mime:'image/png',drawings:{}}]});
 await cell(1).click();color=await pixel(20,20);assert.equal(color[3],0,'A-frame corner should move halfway');assert.equal((await pixel(500,270))[3],255);
 await cell(3).click();assert.equal((await pixel(20,20))[3],0,'loop A frame should interpolate corners too');
 await cell(0).click();await page.locator('[data-tool=move]').click();box=await page.locator('#stage').boundingBox();const margin=10*960/box.width;
 await page.mouse.move(box.x+margin*box.width/960,box.y+margin*box.height/540);await page.mouse.down();await page.mouse.move(box.x+(margin+60)*box.width/960,box.y+(margin+40)*box.height/540);await page.mouse.up();
 downloadPromise=page.waitForEvent('download');await page.locator('#save').click();download=await downloadPromise;const warpedPath=path.join(temp,'warped.animaster');await download.saveAs(warpedPath);const saved=JSON.parse(fs.readFileSync(warpedPath,'utf8'));
 assert(Math.abs(saved.layers[0].keys[0].corners[0].x-60)<1);assert(Math.abs(saved.layers[0].keys[0].corners[0].y-40)<1);assert.equal(saved.layers[0].keys[0].scale,1,'corner dragging must not scale entire layer');
 await page.locator('#projectFile').setInputFiles(warpedPath);await page.waitForFunction(()=>document.querySelector('#status').textContent==='Проект открыт.');assert(await page.locator('#freeCorners').isChecked());
 await page.locator('#resetCorners').click();await page.locator('[data-tool=pencil]').click();assert.equal((await pixel(20,20))[3],255,'reset restores rectangle');
 console.log('PASS free corners: perspective raster, direct corner drag, A/loop interpolation, project round-trip and reset');

 const before=await page.locator('.layer').count();
 for(let i=0;i<3;i++){await page.locator('#templates').click();assert.equal(await page.locator('.template-card').count(),3);await page.locator('.template-card').nth(i).click();await page.waitForFunction(n=>document.querySelectorAll('.layer').length===n,before+i+1);assert.equal(await page.locator('.layer').count(),before+i+1);}
 assert.deepEqual(await page.locator('.layer-name').allTextContents(),['Карта Африки','Карта Европы','Карта мира','Shape']);
 const count=await page.locator('.layer').count();await page.locator('#helpButton').click();assert(await page.locator('#tutorialTitle').isVisible());await page.locator('#tutorialDialog').evaluate(d=>{d.tabIndex=-1;d.focus();});await page.keyboard.press('Space');assert.equal(await page.locator('.layer').count(),count,'tutorial must not trigger editing shortcuts');
 for(let i=0;i<9;i++){assert((await page.locator('#tutorialCounter').textContent()).includes(String(i+1)));await page.locator('#tutorialNext').click();}
 assert(!(await page.locator('#tutorialDialog').isVisible()));
 await page.setViewportSize({width:760,height:620});await page.locator('#templates').click();assert(await page.locator('#templatesTitle').isVisible());await page.locator('#templatesDialog .close').click();
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile should not scroll horizontally');
 for(let i=1;i<await page.locator('.layer').count();i++)await page.locator('.layer').nth(i).locator('button').first().click();
 if(process.env.SCREENSHOT_DIR){fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1100});await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'desktop.png'),fullPage:true});}
 assert.deepEqual(errors,[]);console.log('PASS three offline map templates, nine tutorial steps and responsive layout; no browser errors');
})().then(async()=>{await browser?.close();}).catch(async error=>{console.error(error);await browser?.close();process.exitCode=1;});
