import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
// LOCAL GUEST QA ONLY. No Telegram identity, owner, payment or backend persistence proof.
const base = 'http://127.0.0.1:4180';
const out = process.env.UX_EVIDENCE_OUT || 'artifacts/ux-evidence';
const axePath = process.env.AXE_PATH || 'node_modules/axe-core/axe.min.js';
await fs.mkdir(out, {recursive:true});
const hash = async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
const sources = ['index.html','js/app.js','css/styles.css','js/arc-app.js','css/arc-styles.css'];
const sourceHashes = async () => Object.fromEntries(await Promise.all(sources.map(async p=>[p,await hash(p)])));
const report = { scope:'LOCAL GUEST; explicitly mocked moon only; no auth/owner or production proof', started:new Date().toISOString(), sourceStart:await sourceHashes(), axeSha256:await hash(axePath), measurements:[], requests:[], errors:[], failures:[] };
const browser = await chromium.launch({headless:true});
const selectors = 'button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[tabindex="0"]';
async function settle(page) {
  await page.evaluate(async()=>{await document.fonts.ready; await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  // Wait for actual finite transitions, not an arbitrary sleep; ambient infinite animation excluded.
  await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
}
async function capture(page,name,width,height) {
  await page.evaluate(()=>window.scrollTo(0,0)); await settle(page);
  const result={name,width,height};
  result.geometry=await page.evaluate(sel=>{
    const visible=e=>e.checkVisibility({checkVisibilityCSS:true}) && e.getClientRects().length && getComputedStyle(e).visibility!=='hidden' && !e.closest('[hidden],[aria-hidden="true"]');
    const identify=e=>({tag:e.tagName,id:e.id,text:(e.getAttribute('aria-label')||e.innerText||e.getAttribute('placeholder')||'').trim().slice(0,140)});
    const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
    const controls=[...document.querySelectorAll(sel)].filter(visible).map(e=>({...identify(e),...box(e),disabled:!!e.disabled}));
    const roots=[...document.querySelectorAll('[data-screen-root]')].filter(visible);
    return {viewportWidth:innerWidth,documentWidth:document.documentElement.scrollWidth,roots:roots.map(e=>({id:e.id,textLength:e.innerText.trim().length})),activeTabs:[...document.querySelectorAll('.bottom-tab.is-active')].map(e=>({tab:e.dataset.tab,ariaCurrent:e.getAttribute('aria-current'),ariaSelected:e.getAttribute('aria-selected')})),controls,tapFailures:controls.filter(e=>e.width<44 || e.height<44),overflowElements:[...document.querySelectorAll('body *')].filter(visible).filter(e=>{const r=e.getBoundingClientRect();return r.right>innerWidth+1||r.left< -1;}).map(e=>({...identify(e),...box(e)}))};
  },selectors);
  await page.screenshot({path:`${out}/${width}-${name}.png`,fullPage:false});
  await page.screenshot({path:`${out}/${width}-${name}-full.png`,fullPage:true});
  const axe=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
  result.accessibility={violations:axe.violations,incomplete:axe.incomplete,passes:axe.passes.map(p=>({id:p.id,nodes:p.nodes.length})),contrastPassed:axe.passes.find(p=>p.id==='color-contrast')||null};
  result.lastCTA=await page.evaluate(sel=>{
    const root=document.querySelector('[data-screen-root]:not([hidden])');
    const items=[...(root?.querySelectorAll(sel)||[])].filter(e=>e.checkVisibility({checkVisibilityCSS:true}) && e.getClientRects().length && getComputedStyle(e).visibility!=='hidden'&&!e.closest('[hidden],[aria-hidden="true"]'));
    const last=items.at(-1); if(!last)return null;
    last.scrollIntoView({block:'end',behavior:'instant'}); return {id:last.id,text:(last.innerText||last.getAttribute('aria-label')||'').slice(0,120)};
  },selectors);
  await settle(page);
  if(result.lastCTA) result.lastCTA.geometry=await page.evaluate(sel=>{
    const root=document.querySelector('[data-screen-root]:not([hidden])');const last=[...root.querySelectorAll(sel)].filter(e=>e.checkVisibility({checkVisibilityCSS:true}) && e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('[hidden],[aria-hidden="true"]')).at(-1);
    const r=last.getBoundingClientRect(),nav=document.querySelector('#bottomTabs').getBoundingClientRect();
    const hit=document.elementFromPoint(r.x+r.width/2,Math.min(innerHeight-1,r.y+r.height/2));
    return {top:r.top,bottom:r.bottom,navTop:nav.top,viewportHeight:innerHeight,aboveNav:r.bottom<=nav.top+1,hitTest:hit===last||last.contains(hit)};
  },selectors);
  await page.screenshot({path:`${out}/${width}-${name}-last-cta.png`});
  for(const f of result.geometry.tapFailures)report.failures.push({name,width,type:'tap-target-below-44',...f});
  if(result.geometry.documentWidth>width+1)report.failures.push({name,width,type:'horizontal-overflow',documentWidth:result.geometry.documentWidth});
  if(result.geometry.roots.length!==1||!result.geometry.roots[0].textLength)report.failures.push({name,width,type:'empty-or-multiple-screen'});
  if(result.lastCTA&&!result.lastCTA.geometry.aboveNav)report.failures.push({name,width,type:'last-cta-nav-overlap',...result.lastCTA});
  for(const v of axe.violations)report.failures.push({name,width,type:'axe',rule:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))});
  report.measurements.push(result);
}
try {
for(const [width,height] of [[320,700],[360,800],[390,844]]) {
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  const page=await context.newPage();
  page.on('pageerror',e=>report.errors.push({width,message:e.message}));
  await page.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());
    if(u.pathname.startsWith('/api/')) {
      report.requests.push({width,path:u.pathname,method:req.method(),mock:true});
      if(u.pathname==='/api/moon/today'&&req.method()==='GET')return route.fulfill({json:{ok:true,today:{date:'2026-10-25',moon_phase:'Растущая Луна',moon_sign_ru:'Овен',moon_sign_emoji:'♈',moon_day:14,moon_phase_angle:160,favorable:'Локальный QA-пример календаря'},days:[]}});
      return route.fulfill({status:503,json:{ok:false,error:'LOCAL_QA_UNMOCKED_ENDPOINT'}});
    }
    if(u.origin!==base || !['GET','HEAD'].includes(req.method())) {report.requests.push({width,path:u.origin+u.pathname,method:req.method(),blocked:true});return route.abort('blockedbyclient');}
    return route.continue();
  });
  try {
    await page.goto(base);await page.locator('.onb-skip').click();await page.locator('#screen-day').waitFor({state:'visible'});
    await page.addScriptTag({path:axePath});
    for(const tab of ['home','arc','stars','history','profile']) {
      await page.locator(`[data-tab="${tab}"]`).click();
      await page.locator(`[data-screen-root="${tab}"]`).waitFor({state:'visible'});
      if(tab==='arc')await page.locator('#arcSpreadTabs').waitFor({state:'visible'});
      await capture(page,tab,width,height);
    }
    for(const panel of ['chart','compat']) {
      await page.locator('[data-tab="profile"]').click();
      // Existing profile shortcut; no injected routing or forced interaction.
      await page.locator(panel==='chart'?'#todayChartBtn':'#todayCompatBtn').click();
      const panelId=panel==='chart'?'panelChart':'panelCompat';
      await page.locator(`#${panelId}`).waitFor({state:'visible'});
      await capture(page,panel,width,height);
      await page.locator(`#${panelId} .panel-close`).click();
    }
  } catch(e) {report.errors.push({width,message:e.stack});report.failures.push({width,type:'execution-error',message:e.message});}
  await context.close();
}
} finally {
  await browser.close();report.sourceEnd=await sourceHashes();report.sourceChanged=JSON.stringify(report.sourceStart)!==JSON.stringify(report.sourceEnd);
  report.finished=new Date().toISOString();await fs.writeFile(`${out}/measurements.json`,JSON.stringify(report,null,2));
  const summary={out,screens:report.measurements.length,failures:report.failures.length,errors:report.errors,sourceChanged:report.sourceChanged};
  await fs.writeFile(`${out}/summary.json`,JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
}
if(report.failures.length||report.errors.length||report.sourceChanged)process.exitCode=1;
