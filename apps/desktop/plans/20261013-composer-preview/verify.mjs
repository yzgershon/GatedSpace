import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const root=dirname(fileURLToPath(import.meta.url));
const output=resolve(root, '../../../../.tmp/composer-20261013-qa');
await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{const file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';if(!['index.html','style.css','preview.js','controls.js','controls.css'].includes(file))return void res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html');res.end(await readFile(resolve(root,file)));});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage();const errors=[];const checks=[];
page.on('pageerror',error=>errors.push(error.message));
try {
 for(const [width,height] of [[320,600],[390,844],[640,780],[1100,800],[1500,900]]) {
  await page.setViewportSize({width,height});await page.goto(`http://127.0.0.1:${server.address().port}`);
  for(const id of ['.session-settings-icon[aria-label="Model and effort"]','.session-settings-icon[aria-label="Permissions"]','#mic','#send']) {
   const info=await page.locator(id).evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};});
   assert.ok(info.x>=0&&info.y>=0&&info.right<=width&&info.bottom<=height&&info.hit,`${id} clipped at ${width}x${height}: ${JSON.stringify(info)}`);
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(width===640||width===1500)await page.screenshot({path:resolve(output,`composer-${width}.png`)});
  await page.getByRole('button',{name:'Model and effort',exact:true}).click();
  await page.getByLabel('Codex model',{exact:true}).selectOption('GPT-6 Luna');
  await page.getByRole('slider',{name:'Reasoning effort'}).fill('1');
  assert.match(await page.getByRole('button',{name:'Model and effort',exact:true}).getAttribute('title'),/Luna.*Medium/);
  await page.getByRole('button',{name:'Fast mode',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Fast mode',exact:true}).getAttribute('aria-pressed'),'true');
  if(width===640)await page.screenshot({path:resolve(output,'actual-effort-menu.png')});
  await page.getByRole('button',{name:'Reset effort to default',exact:true}).click();
  assert.equal(await page.getByRole('slider',{name:'Reasoning effort'}).getAttribute('aria-valuetext'),'Extra High');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Permissions',exact:true}).click();
  await page.getByText('Read only',{exact:true}).click();
  assert.equal(await page.getByRole('radio',{name:/Read only/}).isChecked(),true);
  if(width===640)await page.screenshot({path:resolve(output,'actual-permissions-menu.png')});
  await page.keyboard.press('Escape');
  await page.locator('#draft').fill('A draft. ');
  await page.locator('#draft').press('End');
  await page.getByRole('button',{name:'Start Flow dictation demo',exact:true}).click();
  await page.getByRole('button',{name:'Finish Flow dictation demo',exact:true}).click();
  assert.match(await page.locator('#draft').inputValue(),/^A draft\. Keep the composer/);
  await page.locator('#send').click();
  assert.equal(await page.locator('#queued-message').isVisible(),true);
  await page.getByRole('button',{name:'Edit queued message',exact:true}).click();
  assert.match(await page.locator('#draft').inputValue(),/^A draft\./);
  assert.equal(await page.locator('#queued-message').isVisible(),false);
  await page.locator('#draft').fill('');
  await page.getByRole('button',{name:'Expanded preview',exact:true}).click();
  const pill=await page.locator('.activity-pill').boundingBox();assert.ok(pill&&pill.x>=0&&pill.x+pill.width<=width&&pill.y+pill.height<=height);
  await page.getByRole('button',{name:'Show session activity'}).click();assert.equal(await page.locator('#activity-details').isVisible(),true);
  await page.locator('#state').selectOption('complete');
  assert.equal(await page.locator('#activity-state').textContent(),'Task complete');
  assert.equal(await page.locator('#pill-stop').isVisible(),false);
  await page.keyboard.press('Escape');
  if(width===640||width===1500)await page.screenshot({path:resolve(output,`expanded-${width}.png`)});
  await page.locator('#state').selectOption('question');
  assert.equal(await page.locator('#question-card').isVisible(),true);
  await page.getByRole('button',{name:/Other Write your own/}).click();
  await page.getByLabel('Your answer',{exact:true}).fill('Width 83 mm');
  await page.getByRole('button',{name:'Send custom answer'}).click();
  assert.equal(await page.locator('#question-card').isVisible(),false);
  assert.equal(await page.locator('#activity-detail').textContent(),'Continuing with your answer');
  await page.locator('#return-session').click();assert.match(await page.locator('#chat-log').textContent(),/Width 83 mm/);
  await page.locator('#provider').selectOption('Claude');assert.equal(await page.locator('#shell').getAttribute('data-provider'),'Claude');
  await page.getByRole('button',{name:'Model and effort',exact:true}).click();
  assert.equal(await page.getByLabel('Claude model',{exact:true}).inputValue(),'Claude Opus');
  await page.getByRole('slider',{name:'Reasoning effort'}).fill('3');
  assert.equal(await page.getByRole('slider',{name:'Reasoning effort'}).getAttribute('aria-valuetext'),'Max');
  await page.keyboard.press('Escape');
  checks.push({width,height,controlsVisible:true,modelPermissions:true,flowDemo:true,queueMainComposerEdit:true,pill:true,questionCustomReply:true});
 }
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#expanded-view').click();
 assert.equal(await page.locator('#activity-state').evaluate(e=>getComputedStyle(e).animationName),'none');
 assert.deepEqual(errors,[]);
 await writeFile(resolve(output,'results.json'),JSON.stringify({ok:true,checks,reducedMotion:true,errors},null,2));console.log(JSON.stringify({ok:true,checks:checks.length,reducedMotion:true}));
} catch(error) {await page.screenshot({path:resolve(output,'failure.png')});console.error(error);process.exitCode=1;}
finally {await browser.close();server.close();}
