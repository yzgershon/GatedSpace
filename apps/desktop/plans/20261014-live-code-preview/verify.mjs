import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory=dirname(fileURLToPath(import.meta.url));
const output=resolve(directory,'checks');await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
 if(!['index.html','preview.js','preview.css'].includes(name))return void res.writeHead(404).end();
 res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');
 res.end(await readFile(resolve(directory,'dist',name)));
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:940}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const checks=[];
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.locator('.cm-line').first().waitFor();
 assert.ok(await page.locator('.cm-line span').count()>20);
 await page.getByLabel('Message draft').fill('Keep the icons compact.');
 await page.getByRole('button',{name:'Conversation Return to chat'}).click();
 await page.getByRole('button',{name:'Live code Watch edits'}).click();
 assert.equal(await page.getByLabel('Message draft').inputValue(),'Keep the icons compact.');
 checks.push('Layout toggle keeps the same draft; CodeMirror renders syntax colors and line numbers');
 await page.getByLabel('Play demo',{exact:true}).click();
 const frames=[];
 for(let sample=0;sample<5;sample++){await page.waitForTimeout(65);frames.push(await page.getByLabel('Current code',{exact:true}).textContent());}
 assert.ok(new Set(frames).size>=4,'Typing must update repeatedly within an edit');
 assert.ok(!frames.at(-1).includes('{session.title}'),'An entire edit must not appear at once');
 assert.equal(await page.locator('.live-code-caret').count(),1);
 await page.getByLabel('Pause demo',{exact:true}).click();
 const paused=await page.getByLabel('Current code',{exact:true}).textContent();
 await page.waitForTimeout(180);
 assert.equal(await page.getByLabel('Current code',{exact:true}).textContent(),paused);
 checks.push('Fast character streaming, visible caret and pause preserve a partially typed edit');

 await page.getByLabel('Next edit',{exact:true}).click();
 await page.getByLabel('Next edit',{exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[role=tab][aria-selected=true]')?.textContent.includes('session-tabs.css'));
 await page.getByRole('tab',{name:'SessionTabs.tsx',exact:false}).click();
 assert.equal(await page.getByRole('button',{name:'Follow changes',exact:true}).getAttribute('aria-pressed'),'false');
 await page.getByRole('button',{name:'Diff',exact:true}).click();
 assert.equal(await page.locator('.cm-editor').count(),2);
 await page.screenshot({path:resolve(output,'diff-wide.png')});
 await page.getByRole('button',{name:'Code',exact:true}).click();
 checks.push('Live edits follow the active file, manual selection pauses following, and Diff shows before/after');
 await page.getByLabel('Preview session state').selectOption('question');
 await page.getByRole('button',{name:'Keep this width'}).click();
 await page.getByLabel('Pause demo',{exact:true}).click();
 await page.getByLabel('Preview session state').selectOption('complete');
 assert.ok(await page.getByText('Example changes are ready to review.').isVisible());
 checks.push('Question, working, paused and complete states remain reachable');
 await page.getByRole('button',{name:'Model and effort',exact:true}).click();
 await page.getByLabel('Codex model',{exact:true}).selectOption('Claude Opus');
 assert.equal(await page.getByLabel('Codex model',{exact:true}).inputValue(),'Claude Opus');
 await page.keyboard.press('Escape');
 const brain=await page.getByRole('button',{name:'Model and effort',exact:true}).locator('svg').evaluate(el=>el.getBoundingClientRect().width);
 assert.equal(brain,18);
 checks.push('Production model/effort menu and compact 18px composer icons');
 const separator=page.getByRole('separator',{name:'Resize conversation'});
 await separator.focus();await page.keyboard.press('ArrowLeft');
 assert.equal(await separator.getAttribute('aria-valuenow'),'380');
 await page.getByLabel('Preview agent').selectOption('Claude');
 await page.getByLabel('Send demo message').click();
 assert.ok(await page.getByText('Keep the icons compact.',{exact:true}).isVisible());
 await page.getByLabel('Try simulated dictation').click();
 await page.getByLabel('Stop simulated dictation').click();
 assert.equal(await page.getByLabel('Message draft').inputValue(),'Keep the buttons compact.');
 checks.push('Conversation resizing, Claude preview, local messaging and simulated dictation');
 await page.getByLabel('Restart demo').click();await page.getByLabel('Next edit',{exact:true}).click();
 for(const width of [1440,1100,800,680,620,520,360]){
  await page.setViewportSize({width,height:940});await page.waitForTimeout(150);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Page overflow at ${width}`);
  if(width>=620) assert.ok(await page.getByLabel('Message draft').evaluate(el=>el.getBoundingClientRect().bottom<innerHeight),`Composer cropped at ${width}`);
  if(width>=620){const code=await page.getByLabel('Live code editor').boundingBox(),chat=await page.getByLabel('Agent conversation').boundingBox();assert.ok(chat.x>code.x+code.width,'Chat stays beside code');}
  const main=page.locator('.workspace-shell');assert.ok(await main.evaluate(el=>el.scrollWidth<=el.clientWidth+1),`Workspace overflow at ${width}`);
  await page.screenshot({path:resolve(output,`live-code-${width}.png`),fullPage:true});
 }
 checks.push('Responsive layouts from 360 to 1440 pixels; side-by-side from 620 pixels');
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await page.locator('.status-indicator').evaluate(el=>getComputedStyle(el).animationName),'none');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({checks,errors}));
 await writeFile(resolve(output,'results.json'),JSON.stringify({checks,errors},null,2));
}finally{await browser.close();server.close();}
