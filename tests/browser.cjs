const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const base = process.env.AMONG8_URL || 'http://127.0.0.1:8082';
const out = path.join(__dirname, 'artifacts'); fs.mkdirSync(out, { recursive: true });
const questions = JSON.parse(fs.readFileSync(path.join(__dirname, '../server/questions.json')));
const score = e => e <= 2 ? 100 : e <= 5 ? 80 : e <= 10 ? 60 : e <= 15 ? 40 : e <= 20 ? 20 : 0;
(async () => {
 const b = await chromium.launch({ headless: true, channel: 'chrome' });
 const errors = [], results = { viewports: [], seen: [] };
 async function client(width = 390, height = 844, practiced = true) {
  const c = await b.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
  await c.addInitScript(practiced => { if (practiced) localStorage.setItem('among8-practice', 'done'); }, practiced);
  const p = await c.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept()); return { c, p };
 }
 const capture = (p, name) => p.screenshot({ path: path.join(out, name + '.png'), fullPage: true, animations: 'disabled' });
 const ready = p => p.waitForFunction(() => document.querySelector('#squares')?.getAttribute('aria-disabled') === 'false');
 const reveal = p => p.locator('.result-box').waitFor({ timeout: 23000 });
 const pick = (p, value) => p.locator(value ? `[data-value="${value}"]` : '#zero').click();
 const next = async p => { await p.waitForFunction(() => document.querySelector('#main-action') && !document.querySelector('#main-action').disabled); await p.locator('#main-action').click(); };
 async function question(p) { const text = await p.locator('.question h1').innerText(); const q = questions.find(q => q.question === text); assert(q && !q.archived); results.seen.push(q.id); return q; }
 try {
  const { p: trial } = await client(360, 640, false); await trial.goto(base); await trial.locator('.practice').waitFor();
  assert.equal(await trial.locator('.square').count(), 100); assert.equal(await trial.locator('.field-timer').isVisible(), false);
  await capture(trial, 'practice-empty-360'); await pick(trial, 37); await trial.getByRole('button', { name: 'Ответить: 37%' }).click(); await reveal(trial);
  assert.deepEqual(await trial.locator('.answer-number>span').allTextContents(), ['37', '≈71']);
  await capture(trial, 'practice-reveal-360'); await next(trial); await trial.locator('#setup').waitFor();
  assert.equal(await trial.evaluate(() => localStorage.getItem('among8-practice')), 'done');
  await trial.locator('[data-avatar="lime"]').click(); assert.equal(await trial.locator('#selected-character').innerText(), 'Ты — Кваки');
  assert.equal(await trial.locator('.intro-duo canvas').first().getAttribute('data-character'), 'lime'); await capture(trial, 'setup-360');
  await trial.locator('#info-open').click(); assert.equal(await trial.locator('dialog').isVisible(), true); await trial.keyboard.press('Escape');
  const { p: solo, c: sc } = await client(); await solo.goto(base); await solo.locator('#create-button').click();
  let expected = 0;
  for (let i = 0; i < 10; i++) {
   await ready(solo); const q = await question(solo);
   if (i === 1) { await pick(solo, 50); await reveal(solo); assert.equal(await solo.locator('.square.filled').count(), 0); assert.equal(await solo.locator('.answer-item.self .answer-number>span').innerText(), '—'); await capture(solo, 'timeout-cleared'); }
   else { let value = i === 0 ? 0 : q.answer; await pick(solo, value); await solo.locator('#main-action').click(); await reveal(solo); expected += score(Math.abs(value - q.answer)); assert.equal(await solo.locator('.square.filled').count(), value); }
   assert.equal(await solo.locator('.answer-item.actual .answer-number>span').innerText(), q.answer_label?.replace('%', '') || String(q.answer));
   await solo.locator('#question-info').click(); assert.equal(await solo.locator('#info-content a').getAttribute('href'), q.source_url); await solo.locator('#info-close').click();
   await capture(solo, `solo-${q.id}`);
   if (i === 0) for (const v of [{width:360,height:640},{width:390,height:844},{width:430,height:932},{width:768,height:1024},{width:1440,height:900},{width:844,height:390}]) {
    await solo.setViewportSize(v); const m = await solo.evaluate(() => { const cell = document.querySelector('.square').getBoundingClientRect(), grid = document.querySelector('#squares').getBoundingClientRect(), button = document.querySelector('#main-action').getBoundingClientRect(); return { width: innerWidth, height: innerHeight, horizontalOverflow: document.documentElement.scrollWidth > innerWidth, buttonBottom: button.bottom, cellWidth: cell.width, gridWidth:grid.width }; });
    assert.equal(m.horizontalOverflow, false); assert(m.buttonBottom <= v.height + 1, `CTA outside ${v.width}x${v.height}: ${m.buttonBottom}`); results.viewports.push(m); await capture(solo, `reveal-${v.width}x${v.height}`);
   }
   await solo.setViewportSize({width:390,height:844}); await next(solo);
  }
  await solo.locator('.solo-final').waitFor(); assert.match(await solo.locator('.final-points').innerText(), new RegExp('^'+expected));
  await solo.evaluate(() => {Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{throw Error('QA denied')}});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('QA denied')}}})});
  await solo.locator('#share-result').click(); await solo.locator('#share-fallback').waitFor(); assert.match(await solo.locator('#share-fallback').inputValue(), /Among8/); await capture(solo,'share-fallback');
  await solo.locator('#rematch').click(); await ready(solo); await sc.setOffline(true); await solo.locator('#leave-room').click(); await solo.locator('#error').waitFor(); assert(await solo.evaluate(()=>!!localStorage.getItem('among8-session'))); assert(await solo.locator('.board').isVisible()); await sc.setOffline(false); await solo.locator('#leave-room').click(); await solo.locator('#setup').waitFor(); assert.equal(await solo.evaluate(()=>localStorage.getItem('among8-session')),null);
  console.log('Solo + practice + layout + offline exit passed.');
  const {p:host}=await client(), {p:guest,c:gc}=await client(360,640); await host.goto(base); await host.locator('[data-mode="duel"]').click(); await host.locator('[data-question-set="2"]').click(); await host.locator('[data-avatar="lime"]').click(); await host.locator('#create-button').click(); await host.locator('.invite-code').waitFor(); const code=await host.locator('.invite-code').innerText();
  await guest.goto(base+'/?room='+code); await guest.waitForFunction(()=>document.querySelector('[data-avatar="lime"]').disabled); await guest.locator('[data-avatar="peach"]').click(); await guest.locator('#create-button').click(); await host.getByRole('heading',{name:'Оба здесь. Начинаем?'}).waitFor(); await host.locator('#start-match').click();
  for(let i=0;i<10;i++){
   await Promise.all([ready(host),ready(guest)]);const q=await question(host);await pick(host,q.answer);await pick(guest,i===0?37:q.answer);const ownColor=await guest.locator('.answer-item.self').evaluate(e=>getComputedStyle(e).color);
   if(i===0)await capture(guest,'guest-before');await host.locator('#main-action').click();await guest.locator('#main-action').click();await Promise.all([reveal(host),reveal(guest)]);
   assert.equal(await guest.locator('.answer-item').first().getAttribute('class'),'answer-item self');assert.equal(await guest.locator('.answer-item.self').evaluate(e=>getComputedStyle(e).color),ownColor);assert.match(await guest.locator('.answer-item.self p').innerText(),/Ты · Буба/);
   if(i===0){await capture(guest,'guest-after');assert.equal(await guest.locator('.square.filled').count(),37);}
   if(i===1){await guest.reload();await reveal(guest);assert.match(await guest.locator('.round-count').innerText(),/2 \/ 10/);}
   await capture(host,`duel-${q.id}`);await next(host);
   if(i===9){await host.locator('.final').waitFor();assert(await guest.locator('.result-box').isVisible());await host.locator('#rematch').click();await next(guest);await guest.locator('.final').waitFor();await guest.reload();await guest.locator('.final').waitFor();await guest.locator('#rematch').click();await Promise.all([ready(host),ready(guest)]);}
   else await next(guest);
  }
  await host.locator('#leave-room').click();await guest.getByRole('heading',{name:'Дуэль завершена'}).waitFor();
  const {p:expired,c:ec}=await client();await ec.addInitScript(()=>localStorage.setItem('among8-session',JSON.stringify({code:'ABCDEFGH',token:'a'.repeat(64)})));await expired.route('**/api/rooms/ABCDEFGH**',r=>r.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Комната недоступна'})}));await expired.goto(base+'/?room=ABCDEFGH');await expired.locator('#return-home').waitFor();assert.equal(await expired.evaluate(()=>localStorage.getItem('among8-session')),null);await expired.locator('#return-home').click();await expired.locator('#create-button').waitFor();assert(await expired.locator('#create-button').isEnabled());
  assert.equal(new Set(results.seen).size,20);assert.deepEqual(errors,[]);results.passed=true;console.log('Duel + stable identity + independent final + rematch + recovery passed.');
 } finally {results.errors=errors;fs.writeFileSync(path.join(out,'qa-results.json'),JSON.stringify(results,null,2));await b.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
