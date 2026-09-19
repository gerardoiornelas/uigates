import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.AUDIT_PLAYWRIGHT || pathToFileURL(path.resolve('../gerardoiornelas-portfolio/node_modules/playwright/index.mjs')).href);
const root=process.cwd(),out=path.join(root,'audits/pacman-2026-09-18');
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}try{res.setHeader('Content-Type',file.endsWith('.mjs')?'text/javascript':file.endsWith('.html')?'text/html':'text/plain');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
const checks=[], errors=[];
async function check(name,fn){await fn();checks.push({name,pass:true});}
try{
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1100,height:900}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/examples/pacman-audit/index.html`);
  await check('canvas rendered at desktop size',async()=>{await page.locator('canvas').waitFor();assert.equal(await page.locator('canvas').getAttribute('width'),'456');});
  await check('keyboard movement earns points',async()=>{await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>Number(document.querySelector('#score').textContent)>0);});
  await check('space pauses with visible status',async()=>{await page.keyboard.press('Space');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('PAUSED'));});
  await page.screenshot({path:path.join(out,'pacman-desktop.png'),fullPage:true});
  await check('new game resets displayed score',async()=>{await page.getByRole('button',{name:'New game'}).click();assert.equal(await page.locator('#score').textContent(),'0');});
  await check('direction button moves player',async()=>{await page.getByRole('button',{name:'Move left',exact:true}).click();await page.waitForFunction(()=>Number(document.querySelector('#score').textContent)>0);});
  await check('mobile layout stays in viewport',async()=>{await page.setViewportSize({width:390,height:844});const b=await page.locator('canvas').boundingBox();assert(b.x>=0&&b.x+b.width<=390);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));});
  await page.getByRole('button',{name:'Pause game',exact:true}).click();
  await page.screenshot({path:path.join(out,'pacman-mobile.png'),fullPage:true});
  await check('no browser runtime errors',async()=>assert.deepEqual(errors,[]));
  fs.writeFileSync(path.join(out,'browser-checks.json'),JSON.stringify({browser:await browser.version(),checks,errors},null,2)+'\n');
  console.log(JSON.stringify(checks,null,2));
}finally{if(browser)await browser.close();server.close();}
