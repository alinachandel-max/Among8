const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.AMONG8_URL || 'http://127.0.0.1:8082';
const out = path.join(__dirname, 'artifacts'); fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const errors = [];
    async function player(width) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
      page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
      return { page, context };
    }
    const { page: host, context: hostContext } = await player(390);
    const { page: guest } = await player(430);
    await host.goto(base); await host.locator('[data-avatar="plum"]').waitFor();
    await host.screenshot({ path: path.join(out, 'setup-390.png'), fullPage: true });
    await host.locator('[data-avatar="plum"]').click();
    await host.locator('#create-button').click(); await host.locator('.invite-code').waitFor();
    const code = (await host.locator('.invite-code').innerText()).trim();
    await guest.goto(`${base}/?room=${code}`); await guest.locator('[data-avatar="peach"]').click();
    await guest.locator('#create-button').click(); await guest.locator('.invite-code').waitFor();
    await host.getByRole('heading', { name: 'Оба здесь. Начинаем?' }).waitFor();
    await host.screenshot({ path: path.join(out, 'lobby-390.png'), fullPage: true });
    await host.locator('#start-match').click();
    const ready = p => p.waitForFunction(() => document.querySelector('#squares')?.getAttribute('aria-disabled') === 'false', { timeout: 10000 });
    const next = async () => {
      await host.waitForFunction(() => document.querySelector('#main-action')?.disabled === false);
      await guest.waitForFunction(() => document.querySelector('#main-action')?.disabled === false);
      await host.locator('#main-action').click(); await guest.locator('#main-action').click();
    };
    await Promise.all([ready(host), ready(guest)]);
    assert.equal(await host.locator('.square').count(), 100);
    await host.locator('.square[data-value="37"]').click(); await guest.locator('.square[data-value="65"]').click();
    await host.locator('#main-action').click(); await host.getByRole('button', { name: 'Ответ принят', exact: true }).waitFor();
    assert.equal(await guest.locator('.answers .answer-item').count(), 1, 'No opponent/reality before reveal');
    await guest.locator('#main-action').click(); await host.locator('.result-box').waitFor(); await guest.locator('.result-box').waitFor();
    assert.equal(await host.locator('.answers .answer-item').count(), 3);
    assert.deepEqual(await host.locator('.answers .answer-number > span').allTextContents(), await guest.locator('.answers .answer-number > span').allTextContents());
    for (const width of [360, 390, 430, 768, 1440]) {
      await host.setViewportSize({ width, height: 900 });
      assert.equal(await host.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await host.screenshot({ path: path.join(out, `reveal-${width}.png`), fullPage: true });
    }
    await host.setViewportSize({ width: 390, height: 900 });
    await next(); await Promise.all([ready(host), ready(guest)]);
    await host.reload(); await host.locator('.board').waitFor();
    assert.match(await host.locator('.round-count').innerText(), /02\/10/, 'Reload resumes the same question');
    await host.locator('.result-box').waitFor({ timeout: 23000 });
    await guest.locator('.result-box').waitFor({ timeout: 23000 });
    assert.match(await host.locator('.round-scores').innerText(), /Время вышло/);
    for (let round = 2; round < 10; round++) {
      await next(); await Promise.all([ready(host), ready(guest)]);
      await host.locator('#zero').click(); await guest.locator('#hundred').click();
      await Promise.all([host.locator('#main-action').click(), guest.locator('#main-action').click()]);
      await host.locator('.result-box').waitFor(); await guest.locator('.result-box').waitFor();
    }
    await next(); await host.locator('.final').waitFor(); await guest.locator('.final').waitFor();
    assert.deepEqual(await host.locator('.final-points').allTextContents(), await guest.locator('.final-points').allTextContents());
    await host.screenshot({ path: path.join(out, 'duel-final.png'), fullPage: true });
    await host.locator('#rematch').click(); await guest.locator('#rematch').click();
    await host.locator('.board').waitFor(); assert.match(await host.locator('.round-count').innerText(), /01\/10/);
    await host.locator('#leave-room').click(); await guest.getByRole('heading', { name: 'Дуэль завершена' }).waitFor();
    console.log('Duel passed: 10 rounds, timeout, reconnection, rematch, synchronized reveal.');

    await host.locator('[data-mode="solo"]').click();
    assert.equal(await host.locator('#room-code').isVisible(), false);
    await host.locator('#create-button').click();
    for (let round = 0; round < 10; round++) {
      await ready(host); await host.locator('.square[data-value="68"]').click(); await host.locator('#main-action').click();
      await host.locator('.result-box').waitFor(); assert.equal(await host.locator('.answers .answer-item').count(), 2);
      await host.waitForFunction(() => !document.querySelector('#main-action').disabled); await host.locator('#main-action').click();
    }
    await host.locator('.solo-final').waitFor(); await host.screenshot({ path: path.join(out, 'solo-final.png'), fullPage: true });
    await host.locator('#rematch').click(); await host.locator('.board').waitFor();
    await host.locator('#sound-toggle').click(); assert.equal(await host.locator('#sound-toggle').getAttribute('aria-pressed'), 'false');
    await host.reload(); await host.locator('.board').waitFor(); assert.equal(await host.locator('#sound-toggle').getAttribute('aria-pressed'), 'false');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed: true, duelRounds: 10, soloRounds: 10, timeout: true, reload: true, rematch: true, soundToggle: true, viewports: [360, 390, 430, 768, 1440], errors }, null, 2));
    console.log('Solo passed: 10 rounds, rematch, persistent sound preference. No browser errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
