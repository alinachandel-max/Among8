import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGameHandler } from '../server/game.mjs';
import { openDatabase } from '../scripts/sqlite-adapter.mjs';
const questions = JSON.parse(fs.readFileSync(new URL('../server/questions.json', import.meta.url), 'utf8'));
const actual = id => questions.find(q => q.id === id).answer;
const token = n => String(n).padStart(64, 'a');
function setup() {
  const db = openDatabase(); let now = 1_000_000;
  const api = createGameHandler({ questions, clock: () => now });
  const call = async (n, path, body, extra = {}) => {
    const response = await api(new Request('https://game.test/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + token(n), 'Content-Type': 'application/json', ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { DB: db });
    return { status: response.status, ...(await response.json()) };
  };
  const create = (n = 1, mode = 'duel') => call(n, '/rooms', { name: 'Алина', avatar: 'plum', mode });
  return { db, call, create, advance: milliseconds => { now += milliseconds; }, now: () => now };
}

test('duel: protected answers, exactly once scoring, readiness, full match and rematch', async () => {
  const { db, call, create, advance } = setup();
  try {
    let room = await create(); const path = '/rooms/' + room.code;
    assert.equal(room.status, 200); assert.equal(room.question, null);
    assert.equal((await create()).code, room.code, 'Create retry is idempotent');
    assert.equal((await call(2, path + '/join', { name: 'Бека', avatar: 'peach' })).players.length, 2);
    assert.equal((await call(3, path)).status, 403);
    assert.equal((await call(3, path + '/join', { name: 'Третий', avatar: 'sky' })).status, 409);
    assert.equal((await call(2, path + '/start', {})).status, 403);
    room = await call(1, path + '/start', {});
    assert.equal(room.deadline - room.startAt, 15000);
    assert.equal(room.question.answer, undefined);
    assert.equal((await call(1, path + '/answer', { round: 0, value: 50 })).status, 409, 'No answer during countdown');
    for (let round = 0; round < 10; round++) {
      advance(3000); const value = actual(room.question.id);
      room = await call(1, path + '/answer', { round, value });
      const guestView = await call(2, path);
      assert.equal(guestView.players[0].answered, true);
      assert.equal(guestView.players[0].answer, null, 'Opponent answer stays secret');
      assert.equal(guestView.question.answer, undefined, 'Reality stays secret');
      room = await call(2, path + '/answer', { round, value });
      assert.equal(room.phase, 'reveal'); assert.equal(room.history.length, round + 1);
      assert.equal(room.players[0].score, (round + 1) * 100);
      const duplicates = await Promise.all([call(1, path + '/answer', { round, value }), call(2, path)]);
      assert(duplicates.every(r => r.players[0].score === (round + 1) * 100));
      assert.equal((await call(1, path + '/ready', { round })).status, 409);
      advance(1001);
      room = await call(1, path + '/ready', { round }); assert.equal(room.phase, 'reveal');
      room = await call(2, path + '/ready', { round });
      assert.equal(room.phase, round === 9 ? 'finished' : 'playing');
    }
    assert.deepEqual(room.players.map(p => p.score), [1000, 1000]);
    room = await call(1, path + '/rematch', { round: 9 }); assert.equal(room.phase, 'finished');
    room = await call(2, path + '/rematch', { round: 9 });
    assert.equal(room.round, 0); assert.equal(room.phase, 'playing'); assert.deepEqual(room.players.map(p => p.score), [0, 0]); assert.equal(room.history.length, 0);
  } finally { db.close(); }
});

test('timeout at 15 seconds, invalid answers, zero is a real answer and deadline survives reload', async () => {
  const { db, call, create, advance } = setup();
  try {
    const created = await create(); const path = '/rooms/' + created.code;
    await call(2, path + '/join', { name: 'Бека', avatar: 'lime' });
    let room = await call(1, path + '/start', {}); const deadline = room.deadline; advance(3000);
    for (const value of [-1, 101, 1.1, '50', null]) assert.equal((await call(1, path + '/answer', { round: 0, value })).status, 400);
    assert.equal((await call(1, path)).deadline, deadline);
    room = await call(1, path + '/answer', { round: 0, value: 0 }); assert.equal(room.players[0].answer, 0);
    assert.equal((await call(1, path + '/answer', { round: 0, value: 1 })).status, 409);
    advance(15000);
    assert.equal((await call(2, path + '/answer', { round: 0, value: 50 })).status, 409);
    room = await call(2, path); assert.equal(room.phase, 'reveal'); assert.equal(room.history[0].guest.answer, null); assert.equal(room.history[0].guest.error, null); assert.equal(room.history[0].guest.score, 0);
  } finally { db.close(); }
});

test('solo: no opponent, all ten rounds and immediate solo replay', async () => {
  const { db, call, create, advance } = setup();
  try {
    let room = await create(1, 'solo'); const path = '/rooms/' + room.code;
    assert.equal(room.mode, 'solo'); assert.equal(room.phase, 'playing'); assert.equal(room.players[1], null);
    assert.equal((await call(2, path + '/join', { name: 'Бека', avatar: 'peach' })).status, 409);
    for (let round = 0; round < 10; round++) {
      advance(3000);
      room = await call(1, path + '/answer', { round, value: actual(room.question.id) });
      assert.equal(room.phase, 'reveal');
      advance(1001); room = await call(1, path + '/ready', { round });
    }
    assert.equal(room.phase, 'finished'); assert.equal(room.players[0].score, 1000);
    room = await call(1, path + '/rematch', { round: 9 }); assert.equal(room.phase, 'playing'); assert.equal(room.round, 0);
  } finally { db.close(); }
});

test('concurrent joins and submits keep two seats and one score record', async () => {
  const { db, call, create, advance } = setup();
  try {
    let room = await create(); const path = '/rooms/' + room.code;
    const joined = await Promise.all([2, 3].map(n => call(n, path + '/join', { name: 'Игрок ' + n, avatar: 'sky' })));
    assert.equal(joined.filter(r => r.status === 200).length, 1); const guest = joined[0].status === 200 ? 2 : 3;
    room = await call(1, path + '/start', {}); advance(3000); const value = actual(room.question.id);
    await Promise.all([call(1, path + '/answer', { round: 0, value }), call(guest, path + '/answer', { round: 0, value })]);
    room = await call(1, path); assert.equal(room.history.length, 1); assert.deepEqual(room.players.map(p => p.score), [100, 100]);
    advance(1001); await Promise.all([call(1, path + '/ready', { round: 0 }), call(guest, path + '/ready', { round: 0 })]);
    room = await call(1, path); assert.equal(room.round, 1);
    assert.equal((await call(1, path + '/answer', { round: 0, value })).status, 409);
  } finally { db.close(); }
});

test('origin, names, secrets and expired room boundaries', async () => {
  const { db, call, create, advance } = setup();
  try {
    assert.equal((await call(1, '/rooms', { name: 'Алина', avatar: 'plum' }, { Origin: 'https://evil.test' })).status, 403);
    assert.equal((await call(1, '/rooms', { avatar: 'unknown' })).status, 400);
    const room = await create(); assert(!JSON.stringify(room).includes(token(1))); assert.equal(room.host_hash, undefined); assert.equal(room.question_ids, undefined);
    advance(24 * 3600 * 1000 + 1); assert.equal((await call(1, '/rooms/' + room.code)).status, 404);
  } finally { db.close(); }
});

test('character names are canonical; occupied character cannot take the second seat', async () => {
  const { db, call, advance } = setup();
  try {
    let room = await call(1, '/rooms', { avatar: 'lime', name: 'Произвольное имя' });
    const path = '/rooms/' + room.code;
    assert.equal(room.players[0].name, 'Кваки');
    const availability = await call(9, path + '/availability', undefined, { Authorization: '' });
    assert.deepEqual(availability.occupied, ['lime']); assert.equal(availability.canJoin, true);
    assert.equal(availability.players, undefined); assert.equal(availability.question, undefined);
    const conflict = await call(2, path + '/join', { avatar: 'lime' });
    assert.equal(conflict.status, 409); assert.match(conflict.error, /Кваки уже занят/);
    assert.equal((await call(1, path)).players[1], null, 'Conflict must not consume the guest seat');
    room = await call(2, path + '/join', { avatar: 'peach', name: 'Другое имя' });
    assert.deepEqual(room.players.map(p => p.name), ['Кваки', 'Буба']);
    assert.equal((await call(2, path + '/join', { avatar: 'peach' })).status, 200, 'Own reconnect is idempotent');
    const full = await call(9, path + '/availability'); assert.equal(full.canJoin, false); assert.deepEqual(full.occupied, ['lime', 'peach']);
    // Existing room records may have old nicknames; responses must still use characters.
    db.raw.prepare('UPDATE rooms SET host_name = ? WHERE code = ?').run('Алина', room.code);
    room = await call(1, path); assert.equal(room.players[0].name, 'Кваки');
    room = await call(1, path + '/start', {}); advance(3000);
    await call(1, path + '/answer', { round: 0, value: 37 }); room = await call(2, path + '/answer', { round: 0, value: 68 });
    assert.equal(room.phase, 'reveal'); assert.deepEqual(room.players.map(p => p.name), ['Кваки', 'Буба']);
  } finally { db.close(); }
});

test('simultaneous attempts at the host character leave it occupied and guest seat free', async () => {
  const { db, call } = setup();
  try {
    const room = await call(1, '/rooms', { avatar: 'lime' }); const path = '/rooms/' + room.code;
    const attempts = await Promise.all([2, 3].map(n => call(n, path + '/join', { avatar: 'lime' })));
    assert(attempts.every(r => r.status === 409)); assert.equal((await call(1, path)).players[1], null);
    assert.equal((await call(2, path + '/join', { avatar: 'sky' })).status, 200);
    const solo = await call(3, '/rooms', { avatar: 'lime', mode: 'solo' });
    assert.equal(solo.status, 200); assert.equal(solo.players[0].name, 'Кваки', 'Availability is room-local');
  } finally { db.close(); }
});
