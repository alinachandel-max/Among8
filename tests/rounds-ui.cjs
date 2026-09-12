const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const questions = JSON.parse(fs.readFileSync(path.join(__dirname, '../server/questions.json')));
const base = process.env.AMONG8_URL || 'http://127.0.0.1:8082';
const out = path.join(__dirname, 'artifacts'); fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  try {
    // Data-backed render fixtures isolate layout from the real 15-second clock.
    const context = await browser.newContext({ viewport: { width: 360, height: 740 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => { localStorage.setItem('among8-session', JSON.stringify({ code: 'ABCDEFGH', token: 'a'.repeat(64) })); localStorage.setItem('among8-sound', 'off'); });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    let question = questions[0], phase = 'playing'; let maxBottom = 0;
    await page.route('**/api/rooms/ABCDEFGH', async route => {
      const q = question, now = Date.now(), revealed = phase === 'reveal';
      const metric = value => ({ answer: value, error: Math.abs(value - q.answer), score: Math.abs(value - q.answer) <= 2 ? 100 : Math.abs(value - q.answer) <= 5 ? 80 : Math.abs(value - q.answer) <= 10 ? 60 : Math.abs(value - q.answer) <= 15 ? 40 : Math.abs(value - q.answer) <= 20 ? 20 : 0 });
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 'ABCDEFGH', mode: 'duel', questionSet: q.question_set, role: 'host', phase, round: 0, totalRounds: 10, serverNow: now, startAt: now - 1000, deadline: now + 14000, revealAt: now - 2000,
        players: [{ slot: 'host', name: 'Кваки', avatar: 'lime', score: revealed ? metric(37).score : 0, answer: revealed ? 37 : null, answered: revealed, ready: false, connected: true }, { slot: 'guest', name: 'Буба', avatar: 'peach', score: revealed ? metric(68).score : 0, answer: revealed ? 68 : null, answered: revealed, ready: false, connected: true }],
        question: { id: q.id, text: q.question, context: q.context, scope: q.scope, ageMin: q.age_min, shortNote: q.short_note, icon: q.icon, year: q.year, year_kind: q.year_kind, ...(revealed ? { answer: q.answer, answerLabel: q.answer_label || `${q.answer}%`, explanation: q.explanation, sourceName: q.source_short, sourceUrl: q.source_url } : {}) },
        history: revealed ? [{ round: 0, questionId: q.id, actual: q.answer, host: metric(37), guest: metric(68) }] : [],
      }) });
    });
    for (const q of questions) {
      question = q; phase = 'playing'; await page.goto(base); await page.locator('#squares').waitFor();
      assert.equal(await page.locator('#squares .cell-emoji').count(), 100);
      assert.equal(await page.locator('#squares svg').count(), 0);
      assert.equal(await page.locator('.board-top, .mini-player').count(), 0);
      assert.equal(await page.locator('.cell-emoji:visible').count(), 0);
      assert.equal(await page.locator('#squares').getAttribute('data-theme'), q.icon);
      if (q.age_min) assert.equal(await page.locator('.age-label').innerText(), `${q.age_min} ЛЕТ И СТАРШЕ`);
      await page.locator('.square[data-value="37"]').click(); assert.equal(await page.locator('.square.filled .cell-emoji:visible').count(), 37);
      assert.equal(await page.locator('.square:not(.filled) .cell-emoji:visible').count(), 0);
      await page.locator('#squares').focus(); await page.keyboard.press('Home');
      assert.equal(await page.locator('.cell-emoji:visible').count(), 0);
      await page.keyboard.press('End'); assert.equal(await page.locator('.cell-emoji:visible').count(), 100);
      await page.locator('.square[data-value="37"]').click();
      const field = await page.locator('#squares').boundingBox(); const title = await page.locator('.question h1').boundingBox();
      assert(field.height >= 300 && field.width >= 300, 'Field should dominate mobile gameplay');
      assert(field.height > title.height * 3);
      const leave = await page.locator('#leave-room').boundingBox(); assert(leave.y > field.y + field.height, 'Exit belongs at the bottom');
      assert.equal(await page.locator('.square.filled .cell-emoji').first().getAttribute('data-symbol'), q.icon);
      let box = await page.locator('#main-action').boundingBox(); assert(box.y + box.height <= 740, `Question ${q.id}: submit below fold ${box.y + box.height}`);
      phase = 'reveal'; await page.reload(); await page.locator('.result-box').waitFor();
      assert.equal(await page.locator('.fact-details').getAttribute('open'), null);
      assert.equal(await page.locator('.explanation').isVisible(), false);
      box = await page.locator('#main-action').boundingBox(); maxBottom = Math.max(maxBottom, box.y + box.height);
      assert(box.y + box.height <= 740, `Question ${q.id}: next below fold ${box.y + box.height}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if ([7, 12, 16, 18].includes(q.id)) await page.screenshot({ path: path.join(out, `compact-${q.icon}-360.png`), fullPage: true, animations: 'disabled' });
    }
    question = questions[7]; phase = 'reveal';
    for (const width of [390, 430, 768, 1440]) {
      await page.setViewportSize({ width, height: 800 }); await page.reload(); await page.locator('.result-box').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const box = await page.locator('#main-action').boundingBox(); assert(box.y + box.height <= 800);
      await page.screenshot({ path: path.join(out, `compact-reveal-${width}.png`), fullPage: true, animations: 'disabled' });
    }
    await context.close();
    console.log(`20 question layouts passed; lowest primary button ends at ${Math.round(maxBottom)}px on a 740px viewport.`);

    if (process.env.LAYOUT_ONLY === '1') { assert.deepEqual(errors, []); return; }

    // Real database + two independent clients; native audio is instrumented, not replaced.
    const hostContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await hostContext.addInitScript(() => {
      window.soundNotes = [];
      const Audio = window.AudioContext || window.webkitAudioContext;
      const create = Audio.prototype.createOscillator;
      Audio.prototype.createOscillator = function () { const oscillator = create.call(this); const set = oscillator.frequency.setValueAtTime.bind(oscillator.frequency); oscillator.frequency.setValueAtTime = (value, at) => { window.soundNotes.push(value); return set(value, at); }; return oscillator; };
    });
    const guestContext = await browser.newContext({ viewport: { width: 360, height: 740 } });
    const host = await hostContext.newPage(), guest = await guestContext.newPage();
    for (const p of [host, guest]) p.on('pageerror', e => errors.push(e.message));
    await host.goto(base); await host.locator('[data-question-set="2"]').click();
    await host.waitForFunction(() => window.soundNotes.length > 0);
    const beforeAvatar = await host.evaluate(() => soundNotes.length); await host.locator('[data-avatar="lime"]').click();
    await host.waitForFunction(n => soundNotes.length > n, beforeAvatar);
    await host.screenshot({ path: path.join(out, 'round-picker-390.png'), fullPage: true, animations: 'disabled' });
    await host.locator('#create-button').click(); await host.locator('.invite-code').waitFor(); const code = (await host.locator('.invite-code').innerText()).trim();
    await guest.goto(`${base.replace(/\/$/, '')}/?room=${code}`);
    await guest.waitForFunction(() => document.querySelector('[data-question-set="2"]').getAttribute('aria-pressed') === 'true');
    assert.equal(await guest.locator('[data-question-set="1"]').isDisabled(), true);
    await guest.locator('[data-avatar="peach"]').click(); await guest.locator('#create-button').click();
    await host.getByRole('heading', { name: 'Оба здесь. Начинаем?' }).waitFor(); await host.locator('#start-match').click();
    for (const p of [host, guest]) await p.waitForFunction(() => document.querySelector('#squares')?.getAttribute('aria-disabled') === 'false');
    const current = await host.evaluate(async () => { const s = JSON.parse(localStorage.getItem('among8-session')); const response = await fetch('/api/rooms/' + s.code, { headers: { Authorization: 'Bearer ' + s.token } }); const r = await response.json(); return { id: r.question.id, set: r.questionSet }; });
    assert.equal(current.set, 2); assert(current.id >= 11);
    const actual = questions.find(q => q.id === current.id).answer; const wrong = actual > 50 ? '#zero' : '#hundred';
    await host.locator(wrong).click(); await guest.locator(wrong).click();
    const beforeReveal = await host.evaluate(() => soundNotes.length);
    await host.locator('#main-action').click(); await guest.locator('#main-action').click();
    for (const p of [host, guest]) await p.locator('.result-box').waitFor();
    assert.equal(await host.locator('.result-box').getAttribute('data-reaction'), 'disappointed');
    await host.waitForFunction(n => soundNotes.slice(n).includes(165), beforeReveal);
    const notes = await host.evaluate(n => soundNotes.slice(n), beforeReveal); assert(notes.includes(330) && notes.includes(247) && notes.includes(165));
    const beforeInfo = await host.evaluate(() => soundNotes.length); await host.locator('.fact-details summary').click();
    await host.waitForFunction(n => soundNotes.length > n, beforeInfo); assert.equal(await host.locator('.explanation').isVisible(), true);
    await host.locator('#sound-toggle').click(); const muted = await host.evaluate(() => soundNotes.length); await host.locator('.fact-details summary').click();
    assert.equal(await host.evaluate(() => soundNotes.length), muted);
    await host.reload(); await host.locator('.result-box').waitFor(); assert.match(await host.locator('.round-count').innerText(), /Раунд 2/);
    await host.locator('#leave-room').click(); await host.locator('[data-mode="solo"]').click(); await host.locator('#create-button').click(); await host.locator('.board').waitFor();
    assert.match(await host.locator('.round-count').innerText(), /Раунд 2/); await host.locator('#leave-room').click();
    assert.deepEqual(errors, []);
    const result = { passed: true, questionLayouts: 20, viewports: [360, 390, 430, 768, 1440], mobileHeight: 740, lowestPrimaryButton: Math.round(maxBottom), set2Duel: true, guestInheritsSet: true, soloSet2: true, thematicIcons: true, ageLabels: true, clickSounds: true, disappointmentSound: true, mute: true, errors };
    fs.writeFileSync(path.join(out, 'rounds-ui-results.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
