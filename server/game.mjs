export const ROUND_MS = 15_000;
export const AVATAR_NAMES = { plum: 'Зубик', lime: 'Кваки', peach: 'Буба', sky: 'Глазик' };
export const AVATARS = Object.keys(AVATAR_NAMES);
const TTL_MS = 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();
const score = error => error <= 2 ? 100 : error <= 5 ? 80 : error <= 10 ? 60 : error <= 15 ? 40 : error <= 20 ? 20 : 0;
class GameError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new GameError(status, message); };
async function hash(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(x => x.toString(16).padStart(2, '0')).join(''); }
function roomCode() { const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return [...crypto.getRandomValues(new Uint8Array(8))].map(n => chars[n % chars.length]).join(''); }
function shuffledIds(questions) {
  const result = questions.map(q => q.id);
  for (let i = result.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
async function readBody(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415, 'Нужен формат JSON.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'Пустой запрос.');
  let size = 0; const chunks = [];
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 4096) { await reader.cancel(); fail(413, 'Слишком большой запрос.'); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(400, 'Не удалось прочитать запрос.'); }
}
function identity(body) {
  if (!AVATARS.includes(body?.avatar)) fail(400, 'Выбери персонажа.');
  return { name: AVATAR_NAMES[body.avatar], avatar: body.avatar };
}

export function createGameHandler({ questions, clock = Date.now, countdownMs = 3000, roundMs = ROUND_MS }) {
  const byId = new Map(questions.map(q => [q.id, q]));
  const getRoom = (db, code) => db.prepare('SELECT * FROM rooms WHERE code = ?').bind(code).first();

  async function rateLimit(db, request, now, action) {
    const ip = request.headers.get('cf-connecting-ip') || 'local';
    const bucket = Math.floor(now / 3_600_000);
    const key = await hash(`${bucket}:${action}:${ip}`);
    await db.prepare('INSERT INTO rate_limits (id, hits, expires_at) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET hits = hits + 1').bind(key, (bucket + 2) * 3_600_000).run();
    const row = await db.prepare('SELECT hits FROM rate_limits WHERE id = ?').bind(key).first();
    if (row.hits > (action === 'create' ? 30 : 180)) fail(429, 'Слишком много попыток. Попробуй чуть позже.');
  }

  async function settle(db, room, now) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (room.phase !== 'playing' || (room.deadline > now && (room.host_answer === null || room.mode !== 'solo' && room.guest_answer === null))) return room;
      const question = byId.get(JSON.parse(room.question_ids)[room.round]);
      const hostError = room.host_answer === null ? null : Math.abs(room.host_answer - question.answer);
      const guestError = room.guest_answer === null ? null : Math.abs(room.guest_answer - question.answer);
      const record = { round: room.round, questionId: question.id, actual: question.answer,
        host: { answer: room.host_answer, error: hostError, score: hostError === null ? 0 : score(hostError) },
        guest: { answer: room.guest_answer, error: guestError, score: guestError === null ? 0 : score(guestError) } };
      const result = await db.prepare(`UPDATE rooms SET phase = 'reveal', reveal_at = ?, host_ready = 0, guest_ready = 0,
        host_score = host_score + ?, guest_score = guest_score + ?, history = json_insert(history, '$[#]', json(?))
        WHERE code = ? AND phase = 'playing' AND round = ? AND host_answer IS ? AND guest_answer IS ?`)
        .bind(now, record.host.score, record.guest.score, JSON.stringify(record), room.code, room.round, room.host_answer, room.guest_answer).run();
      room = await getRoom(db, room.code);
      if (result.meta.changes) return room;
    }
    return room;
  }

  function view(room, role, now) {
    const revealed = room.phase === 'reveal' || room.phase === 'finished';
    const q = byId.get(JSON.parse(room.question_ids)[room.round]);
    const players = ['host', 'guest'].map(slot => room[`${slot}_hash`] ? {
      slot, name: AVATAR_NAMES[room[`${slot}_avatar`]], avatar: room[`${slot}_avatar`], score: room[`${slot}_score`],
      answered: room[`${slot}_answer`] !== null,
      answer: revealed || role === slot ? room[`${slot}_answer`] : null,
      ready: !!room[`${slot}_ready`], connected: now - room[`${slot}_seen_at`] < 12_000,
    } : null);
    let question = null;
    if (room.phase !== 'waiting') {
      const { id, category, question: text, context, year, year_kind } = q;
      question = { id, category, text, context, year, year_kind };
      if (revealed) Object.assign(question, { answer: q.answer, answerLabel: q.answer_label || `${q.answer}%`, explanation: q.explanation, sourceName: q.source_short || q.source_name, sourceUrl: q.source_url });
    }
    return { code: room.code, mode: room.mode, role, phase: room.phase, round: room.round, totalRounds: questions.length,
      serverNow: now, startAt: room.start_at, deadline: room.deadline, revealAt: room.reveal_at,
      players, question, history: JSON.parse(room.history), expiresAt: room.expires_at };
  }

  async function handle(request, env) {
    const db = env.DB;
    if (!db) fail(503, 'Комнаты временно недоступны. Попробуй ещё раз.');
    const url = new URL(request.url); const now = clock();
    if (url.pathname === '/api/health' && request.method === 'GET') {
      await db.prepare('SELECT 1 FROM rooms LIMIT 1').first();
      return { ok: true, roundMs, questions: questions.length };
    }
    const availability = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{8})\/availability$/);
    if (availability && request.method === 'GET') {
      const room = await getRoom(db, availability[1]);
      if (!room || room.expires_at <= now) fail(404, 'Комната не найдена или срок приглашения истёк.');
      const occupied = [room.host_avatar, ...(room.guest_hash ? [room.guest_avatar] : [])];
      const canJoin = room.mode === 'duel' && room.phase === 'waiting' && !room.guest_hash;
      return { code: room.code, occupied, canJoin,
        message: canJoin ? '' : room.mode === 'solo' ? 'Это одиночная игра. Создай свою дуэль.' : room.phase === 'closed' ? 'Эта дуэль уже закрыта.' : 'В этой комнате уже два игрока.' };
    }
    const rawToken = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
    if (!/^[a-f0-9]{64}$/.test(rawToken)) fail(401, 'Открой комнату заново.');
    const tokenHash = await hash(rawToken);
    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      const body = await readBody(request); const person = identity(body);
      const mode = body.mode === 'solo' ? 'solo' : 'duel';
      const existing = await db.prepare('SELECT * FROM rooms WHERE host_hash = ? AND expires_at > ?').bind(tokenHash, now).first();
      if (existing) return view(existing, 'host', now);
      await rateLimit(db, request, now, 'create');
      await db.batch([
        db.prepare('DELETE FROM rooms WHERE expires_at < ?').bind(now),
        db.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(now),
      ]);
      for (let attempt = 0; attempt < 4; attempt++) {
        const code = roomCode();
        await db.prepare(`INSERT OR IGNORE INTO rooms (code, mode, host_hash, host_name, host_avatar, host_seen_at, question_ids, created_at, expires_at, phase, start_at, deadline)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(code, mode, tokenHash, person.name, person.avatar, now, JSON.stringify(shuffledIds(questions)), now, now + TTL_MS,
          mode === 'solo' ? 'playing' : 'waiting', mode === 'solo' ? now + countdownMs : 0, mode === 'solo' ? now + countdownMs + roundMs : 0).run();
        const room = await db.prepare('SELECT * FROM rooms WHERE host_hash = ? AND expires_at > ?').bind(tokenHash, now).first();
        if (room) return view(room, 'host', now);
      }
      fail(503, 'Не получилось создать комнату. Попробуй ещё раз.');
    }
    const route = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{8})(?:\/(join|start|answer|ready|rematch|leave))?$/);
    if (!route) fail(404, 'Комната не найдена.');
    const [, code, action] = route;
    let room = await getRoom(db, code);
    if (!room || room.expires_at <= now) fail(404, 'Комната не найдена или срок приглашения истёк.');
    if (action === 'join' && request.method === 'POST') {
      const person = identity(await readBody(request));
      if (room.host_hash === tokenHash) return view(await settle(db, room, now), 'host', now);
      if (room.guest_hash === tokenHash) return view(await settle(db, room, now), 'guest', now);
      if (room.mode === 'solo') fail(409, 'Это одиночная игра. Создай дуэль, чтобы играть вдвоём.');
      await rateLimit(db, request, now, 'join');
      if (room.phase !== 'waiting' || room.guest_hash) fail(409, 'В этой комнате уже два игрока. Создай свою дуэль.');
      if (room.host_avatar === person.avatar) fail(409, `${person.name} уже занят. Выбери другого персонажа.`);
      await db.prepare(`UPDATE rooms SET guest_hash = ?, guest_name = ?, guest_avatar = ?, guest_seen_at = ?
        WHERE code = ? AND phase = 'waiting' AND guest_hash IS NULL AND host_avatar <> ?`).bind(tokenHash, person.name, person.avatar, now, code, person.avatar).run();
      room = await getRoom(db, code);
      if (room.guest_hash !== tokenHash) fail(409, 'Кто-то уже занял второе место.');
      return view(room, 'guest', now);
    }
    const role = room.host_hash === tokenHash ? 'host' : room.guest_hash === tokenHash ? 'guest' : null;
    if (!role) fail(403, 'Ты не участник этой комнаты. Войди по приглашению.');
    // Only whitelisted role strings enter SQL identifiers; user input is always bound.
    await db.prepare(`UPDATE rooms SET ${role}_seen_at = ? WHERE code = ?`).bind(now, code).run();
    room[`${role}_seen_at`] = now;
    room = await settle(db, room, now);
    if (!action && request.method === 'GET') return view(room, role, now);
    if (request.method !== 'POST') fail(405, 'Действие недоступно.');
    if (action === 'start') {
      if (role !== 'host') fail(403, 'Начать дуэль может создатель комнаты.');
      if (!room.guest_hash) fail(409, 'Сначала дождись второго игрока.');
      await db.prepare(`UPDATE rooms SET phase = 'playing', start_at = ?, deadline = ? WHERE code = ? AND phase = 'waiting'`)
        .bind(now + countdownMs, now + countdownMs + roundMs, code).run();
    } else if (action === 'answer') {
      const body = await readBody(request);
      if (!Number.isInteger(body.value) || body.value < 0 || body.value > 100 || !Number.isInteger(body.round)) fail(400, 'Выбери целый процент от 0 до 100.');
      if (body.round !== room.round) fail(409, 'Этот вопрос уже завершён.');
      if (room[`${role}_answer`] !== null) {
        if (room[`${role}_answer`] === body.value) return view(room, role, now);
        fail(409, 'Ответ уже зафиксирован.');
      }
      if (room.phase !== 'playing' || now < room.start_at || now >= room.deadline) fail(409, 'Время ответа закончилось или ещё не началось.');
      await db.prepare(`UPDATE rooms SET ${role}_answer = ? WHERE code = ? AND phase = 'playing' AND round = ?
        AND ${role}_answer IS NULL AND start_at <= ? AND deadline > ?`).bind(body.value, code, body.round, now, now).run();
    } else if (action === 'ready' || action === 'rematch') {
      const body = await readBody(request);
      if (body.round !== room.round) fail(409, 'Состояние игры обновилось.');
      const expectedPhase = action === 'ready' ? 'reveal' : 'finished';
      if (room.phase !== expectedPhase) return view(room, role, now);
      if (now < room.reveal_at + 1000) fail(409, 'Сначала посмотри результат вопроса.');
      await db.prepare(`UPDATE rooms SET ${role}_ready = 1 WHERE code = ? AND phase = ? AND round = ?`).bind(code, expectedPhase, room.round).run();
      if (action === 'rematch') {
        await db.prepare(`UPDATE rooms SET phase = 'playing', round = 0, question_ids = ?, history = '[]', host_score = 0, guest_score = 0,
          host_answer = NULL, guest_answer = NULL, host_ready = 0, guest_ready = 0, start_at = ?, deadline = ?
          WHERE code = ? AND phase = 'finished' AND host_ready = 1 AND (mode = 'solo' OR guest_ready = 1)`).bind(JSON.stringify(shuffledIds(questions)), now + countdownMs, now + countdownMs + roundMs, code).run();
      } else if (room.round === questions.length - 1) {
        await db.prepare(`UPDATE rooms SET phase = 'finished', host_ready = 0, guest_ready = 0
          WHERE code = ? AND phase = 'reveal' AND round = ? AND host_ready = 1 AND (mode = 'solo' OR guest_ready = 1)`).bind(code, room.round).run();
      } else {
        await db.prepare(`UPDATE rooms SET phase = 'playing', round = round + 1, host_answer = NULL, guest_answer = NULL,
          host_ready = 0, guest_ready = 0, start_at = ?, deadline = ? WHERE code = ? AND phase = 'reveal' AND round = ?
          AND host_ready = 1 AND (mode = 'solo' OR guest_ready = 1)`).bind(now + countdownMs, now + countdownMs + roundMs, code, room.round).run();
      }
    } else if (action === 'leave') {
      await db.prepare(`UPDATE rooms SET phase = 'closed' WHERE code = ?`).bind(code).run();
    } else fail(404, 'Действие не найдено.');
    room = await settle(db, await getRoom(db, code), now);
    return view(room, role, now);
  }

  return async (request, env) => {
    const origin = request.headers.get('origin');
    const allowed = new Set([new URL(request.url).origin, 'https://alinachandel-max.github.io', ...(env.ALLOWED_ORIGINS || '').split(',').filter(Boolean)]);
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' };
    if (origin && !allowed.has(origin)) return Response.json({ error: 'Этот адрес не разрешён.' }, { status: 403, headers });
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '3600' } });
    try { return Response.json(await handle(request, env), { headers }); }
    catch (error) {
      if (!(error instanceof GameError)) console.error('Game storage error', error.message);
      return Response.json({ error: error instanceof GameError ? error.message : 'Не удалось связаться с комнатой. Попробуй ещё раз.' }, { status: error.status || 503, headers });
    }
  };
}
