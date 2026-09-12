import { mountCharacters, setCharacterMood } from './characters.js';
import { unlockSound, playSound, soundEnabled, toggleSound } from './sounds.js';
import { API_ORIGIN } from './config.js';

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const avatarNames = { plum: 'Зубик', lime: 'Кваки', peach: 'Буба', sky: 'Глазик' };
const state = { mode: 'duel', avatar: 'plum', availability: null, availabilityTimer: null, availabilityLoading: false, session: null, room: null, selected: null, pending: false, renderKey: '', pollTimer: null, syncing: false, serverOffset: 0, lastTick: null, lastPhase: '', draftToken: null, pointer: null };
const makeToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');
const serverTime = () => performance.now() + state.serverOffset;
const self = () => state.room?.players.find(p => p?.slot === state.room.role);
const opponent = () => state.room?.players.find(p => p && p.slot !== state.room.role);
const character = (kind, extra = '') => `<canvas data-character="${escape(kind)}" ${extra} role="img" aria-label="Персонаж ${escape(avatarNames[kind] || '')}"></canvas>`;
function showError(message) { $('error').textContent = message; $('error').hidden = !message; }
function saveSession(session) { state.session = session; try { if (session) localStorage.setItem('among8-session', JSON.stringify(session)); else localStorage.removeItem('among8-session'); } catch {} }
function soundButton() { $('sound-toggle').textContent = soundEnabled() ? '♪' : '♪̸'; $('sound-toggle').setAttribute('aria-pressed', String(soundEnabled())); $('sound-toggle').setAttribute('aria-label', soundEnabled() ? 'Выключить звук' : 'Включить звук'); }

async function request(path, body, token = state.session?.token) {
  const started = performance.now();
  const response = await fetch(`${API_ORIGIN}${path}`, {
    method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000),
  });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'Не получилось связаться с комнатой.'); error.status = response.status; throw error; }
  if (data.serverNow) state.serverOffset = data.serverNow - (started + performance.now()) / 2;
  return data;
}

async function enterRoom(join) {
  if (state.pending) return;
  if (!$('setup-form').reportValidity()) return;
  if (!state.avatar) { showError('Выбери свободного персонажа.'); return; }
  const code = $('room-code').value.trim().toUpperCase().replace(/\s/g, '');
  if (join && !/^[A-Z2-9]{8}$/.test(code)) { showError('Введи код из 8 символов из приглашения.'); $('room-code').focus(); return; }
  unlockSound(); showError(''); state.pending = true; setSetupBusy(true);
  state.draftToken ||= makeToken();
  try {
    const room = await request(join ? `/api/rooms/${code}/join` : '/api/rooms', { avatar: state.avatar, mode: state.mode }, state.draftToken);
    saveSession({ code: room.code, token: state.draftToken, mode: room.mode });
    history.replaceState(null, '', `?room=${room.code}`); state.pending = false;
    applyRoom(room); schedulePoll(100); playSound('start');
  } catch (error) { showError(error.name === 'TimeoutError' ? 'Комната долго отвечает. Нажми ещё раз — вторая комната не создастся.' : error.message || 'Проверь подключение и попробуй ещё раз.'); if (join && error.status === 409) checkAvailability(); }
  finally { state.pending = false; setSetupBusy(false); }
}
function setSetupBusy(busy) { updateCharacterChoices(busy); }
const invitationCode = () => state.mode === 'duel' ? $('room-code').value.trim().toUpperCase().replace(/\s/g, '') : '';
function updateCharacterChoices(busy = state.pending) {
  const code = invitationCode(), validCode = /^[A-Z2-9]{8}$/.test(code);
  const availability = state.availability?.code === code ? state.availability : null;
  const occupied = availability?.occupied || [];
  if (occupied.includes(state.avatar)) state.avatar = null;
  $('avatar-options').querySelectorAll('button').forEach(button => {
    const name = avatarNames[button.dataset.avatar], taken = occupied.includes(button.dataset.avatar);
    button.disabled = busy || taken || validCode && state.availabilityLoading && !availability;
    button.classList.toggle('occupied', taken);
    button.setAttribute('aria-pressed', String(button.dataset.avatar === state.avatar));
    button.setAttribute('aria-label', taken ? `${name} занят` : `Персонаж ${name}`);
    button.querySelector('.avatar-status').textContent = taken ? 'Занят' : '';
  });
  const blockedRoom = validCode && (!availability || !availability.canJoin);
  $('create-button').disabled = busy || !state.avatar || blockedRoom;
  $('join-button').disabled = busy || !state.avatar || blockedRoom;
  $('create-button').textContent = state.mode === 'solo' ? 'Играть одному →' : validCode ? 'Присоединиться к дуэли →' : 'Создать дуэль →';
  $('join-button').hidden = state.mode === 'solo' || validCode;
  $('character-status').textContent = availability?.message || (validCode && !availability ? 'Проверяем свободных персонажей…' : occupied.length ? `${occupied.map(id => avatarNames[id]).join(', ')} уже занят${occupied.length > 1 ? 'ы' : ''}. Выбери свободного персонажа.` : '');
}
async function checkAvailability() {
  clearTimeout(state.availabilityTimer);
  const code = invitationCode();
  if ($('setup').hidden || !/^[A-Z2-9]{8}$/.test(code)) { state.availability = null; state.availabilityLoading = false; updateCharacterChoices(); return; }
  state.availabilityLoading = true; updateCharacterChoices();
  try {
    const availability = await request(`/api/rooms/${code}/availability`);
    if (invitationCode() !== code || $('setup').hidden) return;
    state.availability = availability;
  } catch (error) {
    if (invitationCode() !== code || $('setup').hidden) return;
    state.availability = { code, occupied: [], canJoin: false, message: error.status === 404 ? error.message : 'Не удалось проверить комнату. Пробуем снова…' };
  } finally {
    if (invitationCode() === code && !$('setup').hidden) {
      state.availabilityLoading = false; updateCharacterChoices();
      state.availabilityTimer = setTimeout(checkAvailability, 2000);
    }
  }
}
function schedulePoll(delay = 850) { clearTimeout(state.pollTimer); if (state.session) state.pollTimer = setTimeout(sync, delay); }
async function sync() {
  if (!state.session || state.syncing) return;
  state.syncing = true; const session = state.session;
  try {
    const room = await request(`/api/rooms/${session.code}`, undefined, session.token);
    if (state.session !== session) return;
    $('connection').hidden = true; applyRoom(room);
  } catch (error) {
    if (state.session !== session) return;
    $('connection').hidden = false;
    $('connection').textContent = error.status === 404 ? 'Комната больше недоступна. Можно создать новую дуэль.' : 'Восстанавливаем связь… Таймер продолжает идти на сервере.';
    if (error.status === 404 || error.status === 403) { state.session = null; $('room-view').insertAdjacentHTML('beforeend', '<button id="return-home" class="button secondary">Новая дуэль</button>'); $('return-home').onclick = returnHome; }
  } finally { state.syncing = false; schedulePoll(document.hidden ? 2200 : 850); }
}

async function act(action, body = {}) {
  if (state.pending || !state.session) return;
  state.pending = true; showError(''); updateLive(); const session = state.session;
  try {
    const room = await request(`/api/rooms/${session.code}/${action}`, body);
    if (state.session !== session) return;
    applyRoom(room);
    if (action === 'answer') playSound('lock');
  } catch (error) { showError(error.message || 'Не удалось отправить ответ. Попробуй ещё раз.'); schedulePoll(50); }
  finally { state.pending = false; updateLive(); }
}

function applyRoom(room) {
  if (state.room && room.code === state.room.code && room.serverNow < state.room.serverNow) return;
  const oldRound = state.room ? `${state.room.code}:${state.room.round}:${state.room.phase === 'finished'}` : '';
  const newRound = `${room.code}:${room.round}:${room.phase === 'finished'}`;
  if (oldRound !== newRound && room.phase === 'playing') { state.selected = null; state.lastTick = null; showError(''); }
  state.room = room;
    const key = `${room.code}:${room.phase}:${room.round}:${room.players.map(p => `${p?.name}:${p?.avatar}`).join(':')}`;
  if (key !== state.renderKey) {
    showError('');
    state.renderKey = key; $('setup').hidden = true; $('room-view').hidden = false;
    clearTimeout(state.availabilityTimer);
    if (room.phase === 'waiting') renderLobby();
    else if (room.phase === 'closed') renderClosed();
    else if (room.phase === 'finished') renderFinal();
    else renderBoard();
    mountCharacters(); $('room-view').querySelector('h1')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (room.phase === 'reveal') { playSound('reveal'); setCharacterMood('surprise'); $('live').textContent = `${room.players.filter(Boolean).map(p => `${p.name}: ${p.answer === null ? 'нет ответа' : p.answer + ' процентов'}`).join('. ')}. Реальность: ${room.question.answer} процентов.`; }
    if (room.phase === 'finished') { playSound('win'); setCharacterMood('happy'); }
  }
  if (self()?.answer !== null && self()?.answer !== undefined) state.selected = self().answer;
  updateLive();
}

function playerMarkup(player, isSelf, final = false) {
  if (!player) return '<div class="player"><div class="empty-character"><span>?</span></div><strong>Ждём соперника</strong><span class="badge">По твоей ссылке</span></div>';
  return `<div class="player ${player.slot}">${character(player.avatar)}<strong>${escape(player.name)}</strong><span class="badge">${isSelf ? 'Это ты' : 'Твой соперник'}</span>${final ? `<p class="final-points">${player.score}<small> / 1000</small></p>` : ''}</div>`;
}
function renderLobby() {
  const room = state.room;
  $('room-view').innerHTML = `<div class="lobby"><p class="eyebrow">КОМНАТА ДЛЯ ДВОИХ</p><h1 tabindex="-1">${room.players[1] ? 'Оба здесь. Начинаем?' : 'Позови своего соперника'}</h1><div class="versus-line">${playerMarkup(room.players[0], room.role === 'host')}<span class="versus">vs</span>${playerMarkup(room.players[1], room.role === 'guest')}</div><div class="invite"><p>Код вашей комнаты</p><div class="invite-code">${room.code}</div><button id="copy-invite" class="button secondary">Скопировать приглашение</button><input id="invite-fallback" readonly hidden aria-label="Ссылка для приглашения"><p id="invite-status" class="small" role="status"></p></div><button id="start-match" class="button primary" ${room.role !== 'host' || !room.players[1] ? 'disabled' : ''}>${room.role === 'host' ? 'Начать дуэль' : 'Ждём, когда создатель начнёт'}</button><p class="small">На каждый вопрос — 15 секунд.<br>Не успел отправить ответ — 0 баллов.</p><button id="leave-room" class="text-button">Выйти из комнаты</button></div>`;
  $('copy-invite').onclick = copyInvite; $('start-match').onclick = () => { unlockSound(); act('start'); }; $('leave-room').onclick = leaveRoom;
}
async function copyInvite() {
  const url = new URL(location.href); url.search = `?room=${state.room.code}`; url.hash = '';
  try { await navigator.clipboard.writeText(url.href); $('invite-status').textContent = 'Ссылка скопирована. Отправь её другу.'; }
  catch { $('invite-fallback').hidden = false; $('invite-fallback').value = url.href; $('invite-fallback').select(); $('invite-status').textContent = 'Скопируй ссылку из поля выше.'; }
}
function renderBoard() {
  const room = state.room, revealed = room.phase === 'reveal', q = room.question;
  const mini = p => p ? `<div class="mini-player">${character(p.avatar)}<div><strong>${escape(p.name)}${p.slot === room.role ? ' · ты' : ''}</strong><span class="points" data-player-score="${p.slot}">${p.score} баллов</span></div></div>` : '<div class="solo-label">ОДИНОЧНАЯ<br>ИГРА</div>';
  $('room-view').innerHTML = `<div class="board"><div class="board-top">${mini(room.players[0])}<div class="timer-wrap"><div id="timer" class="timer" aria-label="Осталось секунд">15</div><div class="round-count">${String(room.round + 1).padStart(2, '0')} / 10</div></div>${mini(room.players[1])}</div><div class="time-track"><i id="time-fill"></i></div><div class="question"><div class="question-meta"><span class="eyebrow">${escape(q.category)}</span><span>${q.year_kind === 'publication' ? 'Исследование' : 'Данные'} · ${q.year}</span></div><h1 tabindex="-1">${escape(q.text)}</h1><p class="question-context">${escape(q.context)}</p></div><div id="answer-values" class="answers ${revealed ? '' : 'single'}"></div><div id="squares" class="squares" role="slider" tabindex="${revealed ? '-1' : '0'}" aria-label="Твой ответ в процентах" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-valuetext="Ответ не выбран">${Array.from({ length: 100 }, (_, i) => `<span class="square" data-value="${i + 1}" aria-hidden="true"></span>`).join('')}</div><div class="ends"><button id="zero" class="end" aria-label="Выбрать 0 процентов">0%</button><span>1 квадрат = 1%</span><button id="hundred" class="end" aria-label="Выбрать 100 процентов">100%</button></div>${revealed ? revealMarkup() : '<div class="adjust"><button id="minus" class="step" aria-label="Уменьшить на один">−</button><p>Коснись шкалы или проведи по ней<br>Стрелки ← → тоже работают</p><button id="plus" class="step" aria-label="Увеличить на один">+</button></div><p id="countdown-note" class="countdown-note"></p>'}<div class="actions"><button id="main-action" class="button primary" disabled>${revealed ? room.round === 9 ? 'Посмотреть результат' : 'Следующий вопрос' : 'Ответить'}</button><p id="opponent-status" class="opponent-status"></p></div><button id="leave-room" class="text-button">Выйти из дуэли</button></div>`;
  if (revealed) {
    $('answer-values').innerHTML = room.players.filter(Boolean).map(p => answerMarkup(p.slot, p.name, p.answer)).join('') + answerMarkup('actual', 'Реальность', q.answerLabel);
    for (const p of room.players.filter(Boolean)) if (p.answer !== null) mark(p.answer, p.slot);
    mark(q.answer, 'actual');
    $('main-action').onclick = () => act('ready', { round: room.round });
  } else {
    $('answer-values').innerHTML = answerMarkup('host', 'Твой ответ', state.selected);
    wireSelector(); $('main-action').onclick = submit;
  }
  $('leave-room').onclick = leaveRoom;
}
function answerMarkup(kind, name, value) {
  const label = value === null ? '—' : String(value).replace('%', '');
  return `<div class="answer-item ${kind}"><div class="answer-number"><span${name === 'Твой ответ' ? ' id="my-value"' : ''}>${escape(label)}</span>${value === null && state.room.phase === 'reveal' ? '' : '<small>%</small>'}</div><p><i class="answer-tag" aria-hidden="true"></i>${escape(name)}</p></div>`;
}
function revealMarkup() {
  const room = state.room, record = room.history.at(-1);
  const left = record.host.score, right = record.guest.score;
  const error = record.host.error;
  const soloTitle = error === null ? 'Мир подождёт. А таймер — нет' : error <= 2 ? 'Почти идеально' : error <= 5 ? 'Очень близко' : error <= 10 ? 'Неплохо' : error <= 20 ? 'Мир немного другой' : 'Вот это сюрприз';
  const title = room.mode === 'solo' ? soloTitle : left === right ? 'Этот раунд — на равных' : `${escape(room.players[left > right ? 0 : 1].name)} ближе к реальности`;
  return `<section class="result-box"><h2>${title}</h2><div class="round-scores">${room.players.filter(Boolean).map(p => `<div class="round-score"><div><strong>${escape(p.name)}</strong><div class="error-points">${record[p.slot].error === null ? 'Время вышло · нет ответа' : `Ошибка ${record[p.slot].error} п.п.`}</div></div><span class="gain">+${record[p.slot].score}</span></div>`).join('')}</div><p class="explanation">${escape(room.question.explanation)}</p><div class="source"><span>${escape(room.question.sourceName)} · ${room.question.year}</span><a href="${escape(room.question.sourceUrl)}" target="_blank" rel="noopener noreferrer">Подробнее ↗</a></div></section>`;
}
function mark(value, kind) { const target = value === 0 ? $('zero') : $('squares').querySelector(`[data-value="${value}"]`); target?.classList.add(`mark-${kind}`); }
function canAnswer() { const r = state.room; return r?.phase === 'playing' && serverTime() >= r.startAt && serverTime() < r.deadline && !self()?.answered && !state.pending; }
function select(value) {
  if (!canAnswer()) return;
  state.selected = Math.max(0, Math.min(100, Math.round(value))); updateSelection();
}
function updateSelection() {
  if ($('my-value')) $('my-value').textContent = state.selected ?? '—';
  const grid = $('squares'); if (!grid) return;
  grid.querySelectorAll('.square').forEach((cell, i) => cell.classList.toggle('filled', state.selected !== null && i < state.selected));
  grid.setAttribute('aria-valuenow', String(state.selected ?? 0)); grid.setAttribute('aria-valuetext', state.selected === null ? 'Ответ не выбран' : `${state.selected} процентов`);
  if ($('main-action') && state.room.phase === 'playing') $('main-action').disabled = !canAnswer() || state.selected === null;
}
function wireSelector() {
  const grid = $('squares');
  const pointerValue = event => {
    const rect = grid.getBoundingClientRect(), cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const row = Math.max(0, Math.min(100 / cols - 1, Math.floor((event.clientY - rect.top) / (rect.height / (100 / cols)))));
    if (event.clientX < rect.left && row === 0) return 0;
    return row * cols + Math.max(0, Math.min(cols - 1, Math.floor((event.clientX - rect.left) / (rect.width / cols)))) + 1;
  };
  grid.onpointerdown = event => { if (!canAnswer() || !event.isPrimary || event.button !== 0) return; event.preventDefault(); state.pointer = event.pointerId; grid.setPointerCapture(event.pointerId); grid.focus({ preventScroll: true }); select(pointerValue(event)); unlockSound(); };
  grid.onpointermove = event => { if (event.pointerId === state.pointer) select(pointerValue(event)); };
  const end = event => { if (state.pointer === event.pointerId) { state.pointer = null; if (grid.hasPointerCapture(event.pointerId)) grid.releasePointerCapture(event.pointerId); } };
  grid.onpointerup = end; grid.onpointercancel = end; grid.onlostpointercapture = () => { state.pointer = null; };
  grid.onkeydown = event => { const changes = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 }; if (event.key in changes) { event.preventDefault(); select((state.selected ?? 0) + changes[event.key]); } else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); select(event.key === 'Home' ? 0 : 100); } else if (event.key === 'Enter' && !event.repeat) { event.preventDefault(); submit(); } };
  $('zero').onclick = () => select(0); $('hundred').onclick = () => select(100); $('minus').onclick = () => select((state.selected ?? 1) - 1); $('plus').onclick = () => select((state.selected ?? 0) + 1);
}
function submit() { if (canAnswer() && state.selected !== null) act('answer', { value: state.selected, round: state.room.round }); }

function updateLive() {
  const room = state.room; if (!room) return;
  const me = self(), other = opponent();
  if (room.phase === 'waiting' && $('start-match')) $('start-match').disabled = state.pending || room.role !== 'host' || !room.players[1];
  if (!['playing', 'reveal', 'finished'].includes(room.phase)) return;
  if (room.phase === 'playing') {
    const now = serverTime(), counting = now < room.startAt, remaining = Math.max(0, Math.ceil((room.deadline - now) / 1000));
    $('timer').textContent = counting ? Math.max(1, Math.ceil((room.startAt - now) / 1000)) : remaining;
    $('timer').classList.toggle('urgent', !counting && remaining <= 5);
    $('timer').setAttribute('aria-label', counting ? 'Отсчёт до начала' : `Осталось ${remaining} секунд`);
    $('time-fill').style.setProperty('--remaining', String(counting ? 1 : Math.max(0, Math.min(1, (room.deadline - now) / 15000))));
    $('countdown-note').textContent = counting ? 'Сейчас начнём. Приготовься!' : remaining === 0 ? 'Время вышло. Сравниваем ответы…' : me.answered ? 'Твой ответ зафиксирован' : '';
    $('main-action').textContent = state.pending ? 'Отправляем…' : me.answered ? 'Ответ принят' : remaining === 0 ? 'Время вышло' : 'Ответить';
    $('squares').setAttribute('aria-disabled', String(!canAnswer()));
    for (const id of ['zero', 'hundred', 'minus', 'plus']) if ($(id)) $(id).disabled = !canAnswer();
    updateSelection();
    $('opponent-status').textContent = room.mode === 'solo' ? 'Чем ближе к реальности — тем больше баллов' : !other.connected ? `${other.name}: восстанавливаем связь. Можно вернуться в комнату.` : other.answered ? `${other.name}: ответ принят` : `${other.name} выбирает ответ`;
    const tick = counting ? `start-${Math.ceil((room.startAt - now) / 1000)}` : String(remaining);
    if (tick !== state.lastTick) { if (counting || remaining > 0 && remaining <= 5 && !me.answered) playSound('tick'); if (!counting && state.lastTick?.startsWith('start')) playSound('start'); state.lastTick = tick; }
  } else if (room.phase === 'reveal') {
    $('timer').textContent = '✓'; $('timer').setAttribute('aria-label', 'Ответы раскрыты'); $('time-fill').style.setProperty('--remaining', '0');
    $('main-action').disabled = state.pending || me.ready || serverTime() < room.revealAt + 1000;
    $('main-action').textContent = me.ready ? 'Ждём соперника…' : room.round === 9 ? 'Посмотреть результат' : 'Следующий вопрос';
    $('opponent-status').textContent = room.mode === 'solo' ? 'Немного времени на открытие' : other.ready ? `${other.name}: можно продолжать` : 'Продолжим, когда вы оба будете готовы';
    $('zero').disabled = true; $('hundred').disabled = true; $('squares').setAttribute('aria-disabled', 'true'); updateSelection();
  } else if ($('rematch')) {
    $('rematch').disabled = state.pending || me.ready; $('rematch').textContent = room.mode === 'solo' ? 'Сыграть ещё раз' : me.ready ? 'Ждём согласия соперника…' : 'Сыграть реванш';
    $('rematch-status').textContent = room.mode === 'solo' ? 'Те же факты, новый порядок' : other.ready ? `${other.name} предлагает реванш` : 'Реванш начнётся, когда согласитесь оба';
  }
}

function renderFinal() {
  if (state.room.mode === 'solo') { renderSoloFinal(); return; }
  const room = state.room, [a, b] = room.players; const title = a.score === b.score ? 'Интуиция на равных!' : `${escape(a.score > b.score ? a.name : b.name)} выигрывает!`;
  const stat = slot => { const valid = room.history.map(r => r[slot].error).filter(e => e !== null); return { average: valid.length ? (valid.reduce((a, b) => a + b, 0) / valid.length).toLocaleString('ru-RU', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : '—', missed: 10 - valid.length }; };
  $('room-view').innerHTML = `<div class="final"><p class="eyebrow">10 ВОПРОСОВ. ОДНА ДУЭЛЬ.</p><h1 tabindex="-1">${title}</h1><div class="versus-line">${room.players.map((p, i) => `${i ? '<span class="versus">vs</span>' : ''}<div>${playerMarkup(p, p.slot === room.role, true)}<p class="final-average">Средняя ошибка: ${stat(p.slot).average} п.п.<br>Без ответа: ${stat(p.slot).missed}</p></div>`).join('')}</div><div class="summary"><p>Мир оказался немного другим.<br>Зато теперь вы знаете его чуть лучше.<br>Средняя ошибка — по отправленным ответам.</p></div><button id="rematch" class="button primary">Сыграть реванш</button><p id="rematch-status" class="small"></p><button id="share-result" class="button secondary">Поделиться результатом</button><p id="share-status" class="small" role="status"></p><button id="leave-room" class="text-button">Новая дуэль с другим другом</button></div>`;
  $('rematch').onclick = () => act('rematch', { round: room.round }); $('share-result').onclick = shareResult; $('leave-room').onclick = leaveRoom;
}
async function shareResult() {
  const text = `Among8 — игра на интуицию\n\n${state.room.players.filter(Boolean).map(p => `${p.name}: ${p.score} / 1000`).join('\n')}\n\nНасколько хорошо ты знаешь мир?`;
  try { if (navigator.share) await navigator.share({ title: 'Among8', text, url: location.href.split('?')[0] }); else { await navigator.clipboard.writeText(text); $('share-status').textContent = 'Результат скопирован.'; } }
  catch (error) { if (error.name !== 'AbortError') { $('share-status').textContent = text; } }
}
function renderClosed() { $('room-view').innerHTML = '<div class="lobby"><h1 tabindex="-1">Дуэль завершена</h1><p class="lead">Один из игроков вышел из комнаты.</p><button id="return-home" class="button primary">Создать новую дуэль</button></div>'; $('return-home').onclick = returnHome; }
async function leaveRoom() { if (state.pending) return; await act('leave'); returnHome(); }
function returnHome() { const previous = self(); if (previous) { state.avatar = previous.avatar; $('avatar-options').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.avatar === state.avatar))); } clearTimeout(state.pollTimer); saveSession(null); Object.assign(state, { room: null, renderKey: '', selected: null, pending: false, draftToken: null }); $('room-view').hidden = true; $('room-view').innerHTML = ''; $('setup').hidden = false; $('connection').hidden = true; $('room-code').value = ''; showError(''); history.replaceState(null, '', location.pathname); chooseMode(state.mode); mountCharacters(); window.scrollTo({ top: 0, behavior: 'instant' }); }

function renderSoloFinal() {
  const room = state.room, p = room.players[0], valid = room.history.map(r => r.host.error).filter(e => e !== null);
  const average = valid.length ? (valid.reduce((a, b) => a + b, 0) / valid.length).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—';
  const verdict = p.score >= 900 ? 'Ты пугающе хорошо понимаешь мир.' : p.score >= 750 ? 'Твоя интуиция работает.' : p.score >= 550 ? 'Мир иногда удивляет тебя.' : p.score >= 350 ? 'Реальность оказалась страннее.' : 'Похоже, Земля устроена совсем не так, как кажется.';
  $('room-view').innerHTML = `<div class="final solo-final"><p class="eyebrow">10 ВОПРОСОВ О МИРЕ</p><h1 tabindex="-1">${escape(p.name)}, вот твой результат</h1>${playerMarkup(p, true, true)}<p class="final-average">Средняя ошибка: ${average} п.п.<br>Без ответа: ${10 - valid.length}</p><div class="summary"><h2>${verdict}</h2><p>Средняя ошибка считается по отправленным ответам.<br>За пропущенные вопросы — 0 баллов.</p></div><button id="rematch" class="button primary">Сыграть ещё раз</button><p id="rematch-status" class="small"></p><button id="share-result" class="button secondary">Поделиться результатом</button><p id="share-status" class="small" role="status"></p><button id="leave-room" class="text-button">Выбрать другой режим</button></div>`;
  $('rematch').onclick = () => act('rematch', { round: room.round }); $('share-result').onclick = shareResult; $('leave-room').onclick = leaveRoom;
}
function chooseMode(mode) {
  state.mode = mode; state.draftToken = null;
  document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  $('room-code').hidden = mode === 'solo'; $('room-label').hidden = mode === 'solo'; $('join-button').hidden = mode === 'solo';
  $('create-button').textContent = mode === 'solo' ? 'Играть одному →' : 'Создать дуэль →';
  if (mode === 'solo') $('room-code').value = '';
  document.querySelector('.intro-duo').classList.toggle('is-solo', mode === 'solo');
  document.querySelector('.setup h1').innerHTML = mode === 'solo' ? 'Насколько хорошо<br>ты знаешь мир?' : 'Чья интуиция<br>ближе к правде?';
  document.querySelector('.setup .eyebrow').textContent = mode === 'solo' ? 'ТВОЯ ИНТУИЦИЯ. И РЕАЛЬНОСТЬ.' : 'ВЫ ДВОЕ. И РЕАЛЬНОСТЬ.';
  showError('');
  checkAvailability();
}

function initialize() {
  $('avatar-options').innerHTML = Object.entries(avatarNames).map(([kind, name]) => `<button class="avatar-option" type="button" data-avatar="${kind}" aria-label="Персонаж ${name}" aria-pressed="${kind === state.avatar}">${character(kind, 'aria-hidden="true"')}<span>${name}</span><span class="avatar-status"></span></button>`).join('');
  $('avatar-options').onclick = event => { const button = event.target.closest('[data-avatar]'); if (!button || button.disabled) return; state.avatar = button.dataset.avatar; updateCharacterChoices(); unlockSound(); playSound('tap'); };
  $('room-code').oninput = () => { clearTimeout(state.availabilityTimer); state.availability = null; updateCharacterChoices(); state.availabilityTimer = setTimeout(checkAvailability, 180); };
  $('setup-form').onsubmit = event => { event.preventDefault(); enterRoom(!!$('room-code').value.trim()); };
  $('join-button').onclick = () => enterRoom(true);
  document.querySelectorAll('[data-mode]').forEach(b => { b.onclick = () => chooseMode(b.dataset.mode); });
  $('sound-toggle').onclick = () => { toggleSound(); soundButton(); }; soundButton();
  document.addEventListener('keydown', event => { if (event.repeat && ['Enter', ' '].includes(event.key)) event.preventDefault(); });
  const code = new URLSearchParams(location.search).get('room')?.toUpperCase();
  if (code) { $('room-code').value = code; $('create-button').textContent = 'Присоединиться к дуэли →'; $('join-button').hidden = true; }
  checkAvailability();
  try { const saved = JSON.parse(localStorage.getItem('among8-session')); if (saved?.code && /^[a-f0-9]{64}$/.test(saved.token) && (!code || code === saved.code)) { saveSession(saved); state.draftToken = saved.token; sync(); } } catch {}
  mountCharacters();
  setInterval(updateLive, 100);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { unlockSound(); schedulePoll(0); } });
  registerGameTools();
}

function registerGameTools() {
  if (!document.modelContext?.registerTool) return;
  const lifecycle = new AbortController();
  const tools = [{
    name: 'read_game_state', title: 'Состояние игры',
    description: 'Прочитать текущее видимое состояние Among8 без секретов сессии и скрытых ответов.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: () => ({ mode: state.room?.mode || state.mode, room: state.room, selected: state.selected }),
  }, {
    name: 'submit_percentage_answer', title: 'Ответить процентом',
    description: 'Отправить выбранный процент за текущего игрока. Ответ фиксируется до раскрытия раунда.',
    inputSchema: { type: 'object', properties: { value: { type: 'integer', minimum: 0, maximum: 100 } }, required: ['value'], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input) {
      if (!Number.isInteger(input?.value) || input.value < 0 || input.value > 100 || !canAnswer()) throw new Error('Сейчас нельзя отправить этот ответ.');
      select(input.value); await act('answer', { value: input.value, round: state.room.round });
      if (self()?.answer !== input.value) throw new Error('Ответ пока не подтверждён сервером.');
      return { accepted: true, value: input.value, phase: state.room.phase };
    },
  }];
  for (const tool of tools) { try { Promise.resolve(document.modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch {} }
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
}
initialize();
