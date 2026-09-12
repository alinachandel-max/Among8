import { mountCharacters, setCharacterMood } from './characters.js';
import { unlockSound, playSound, soundEnabled, toggleSound, revealSound } from './sounds.js';
import { API_ORIGIN } from './config.js';
import { questionIcon } from './question-icons.js';

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const avatarNames = { plum: 'Зубик', lime: 'Кваки', peach: 'Буба', sky: 'Глазик' };
const state = { mode: 'solo', practice: false, questionSet: 1, avatar: 'plum', availability: null, availabilityTimer: null, availabilityLoading: false, session: null, room: null, selected: null, pending: false, renderKey: '', pollTimer: null, syncing: false, serverOffset: 0, lastTick: null, lastPhase: '', draftToken: null, pointer: null };
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
    const room = await request(join ? `/api/rooms/${code}/join` : '/api/rooms', { avatar: state.avatar, mode: state.mode, questionSet: state.questionSet }, state.draftToken);
    saveSession({ code: room.code, token: state.draftToken, mode: room.mode, questionSet: room.questionSet });
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
  document.querySelectorAll('[data-question-set]').forEach(button => {
    button.disabled = busy || validCode;
    button.setAttribute('aria-pressed', String(Number(button.dataset.questionSet) === (availability?.questionSet || state.questionSet)));
  });
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
  $('join-details').hidden = state.mode === 'solo';
  $('character-status').textContent = availability?.message || (validCode && !availability ? 'Проверяем свободных персонажей…' : occupied.length ? `${occupied.map(id => avatarNames[id]).join(', ')} уже занят${occupied.length > 1 ? 'ы' : ''}. Выбери свободного персонажа.` : '');
  $('selected-character').textContent = state.avatar ? `Ты — ${avatarNames[state.avatar]}` : 'Выбери персонажа';
  updateHeroCharacter(occupied);
}
function updateHeroCharacter(occupied = []) {
  const [hero, rival] = document.querySelectorAll('.intro-duo canvas');
  const placeholder = $('hero-placeholder');
  hero.hidden = !state.avatar;
  placeholder.hidden = !!state.avatar;
  if (state.avatar) hero.dataset.character = state.avatar;
  rival.dataset.character = occupied[0] || (state.avatar === 'peach' ? 'plum' : 'peach');
  mountCharacters();
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
    if ([401, 403, 404].includes(error.status)) recoverSession();
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
    return true;
  } catch (error) { if ([401, 403, 404].includes(error.status)) recoverSession(); else { showError(action === 'leave' ? 'Нет связи. Повтори выход.' : 'Нет связи. Попробуй ещё раз.'); schedulePoll(50); } return false; }
  finally { state.pending = false; updateLive(); }
}

function applyRoom(room) {
  if (state.room && room.code === state.room.code && room.serverNow < state.room.serverNow) return;
  const oldRound = state.room ? `${state.room.code}:${state.room.round}:${state.room.phase === 'finished'}` : '';
  const newRound = `${room.code}:${room.round}:${room.phase === 'finished'}`;
  if (oldRound !== newRound && room.phase === 'playing') { state.selected = null; state.lastTick = null; showError(''); }
  state.room = room;
  if (room.phase === 'reveal' || room.phase === 'finished' || self()?.answered) state.selected = self()?.answer ?? null;
  state.questionSet = room.questionSet || 1;
  document.body.classList.toggle('in-game', ['playing', 'reveal'].includes(room.phase));
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
    if (room.phase === 'reveal') { playSound(room.players.some(p => p && p.answer === null) ? 'tick' : revealSound(room.history.at(-1), room.mode)); setCharacterMood('surprise'); $('live').textContent = `${room.players.filter(Boolean).map(p => `${p.name}: ${p.answer === null ? 'нет ответа' : p.answer + ' процентов'}`).join('. ')}. Реальность: ${room.question.answer} процентов.`; }
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
  $('room-view').innerHTML = `<div class="lobby"><p class="eyebrow">НАБОР ${room.questionSet || 1} · 10 ВОПРОСОВ</p><h1 tabindex="-1">${room.players[1] ? 'Оба здесь. Начинаем?' : 'Позови своего соперника'}</h1><div class="versus-line">${playerMarkup(room.players[0], room.role === 'host')}<span class="versus">vs</span>${playerMarkup(room.players[1], room.role === 'guest')}</div><div class="invite"><p>Код вашей комнаты</p><div class="invite-code">${room.code}</div><button id="copy-invite" class="button secondary">Скопировать приглашение</button><input id="invite-fallback" readonly hidden aria-label="Ссылка для приглашения"><p id="invite-status" class="small" role="status"></p></div><button id="start-match" class="button primary" ${room.role !== 'host' || !room.players[1] ? 'disabled' : ''}>${room.role === 'host' ? 'Начать дуэль' : 'Ждём, когда создатель начнёт'}</button><button id="leave-room" class="text-button">Выйти из комнаты</button></div>`;
  $('copy-invite').onclick = copyInvite; $('start-match').onclick = () => { unlockSound(); act('start'); }; $('leave-room').onclick = leaveRoom;
}
async function copyInvite() {
  const url = new URL(location.href); url.search = `?room=${state.room.code}`; url.hash = '';
  try { await navigator.clipboard.writeText(url.href); $('invite-status').textContent = 'Ссылка скопирована. Отправь её другу.'; }
  catch { $('invite-fallback').hidden = false; $('invite-fallback').value = url.href; $('invite-fallback').select(); $('invite-status').textContent = 'Скопируй ссылку из поля выше.'; }
}
const orderedPlayers = () => [self(), opponent()].filter(Boolean);
function renderBoard() {
  const room = state.room, revealed = room.phase === 'reveal', q = room.question;
  const progress = state.practice ? 'Пробный вопрос' : `${room.round + 1} / 10`;
  const population = [q.scope, q.ageMin ? `${q.ageMin} лет и старше` : ''].filter(Boolean).join(' · ');
  const toolbar = revealed ? `<div class="field-endpoints"><span id="zero">0%</span><span>Твой ответ</span><span id="hundred">100%</span></div>` : `<div class="selector-toolbar"><button id="zero" class="end" aria-label="Выбрать 0 процентов">0%</button><button id="minus" class="step" aria-label="Уменьшить на один">−</button><span>1 клетка = 1%</span><button id="plus" class="step" aria-label="Увеличить на один">+</button><button id="hundred" class="end" aria-label="Выбрать 100 процентов">100%</button></div>`;
  $('room-view').innerHTML = `<div class="board ${revealed ? 'is-revealed' : 'is-choosing'} ${state.practice ? 'practice' : ''}"><div class="question"><div class="question-meta"><span class="round-count">${progress}</span><button class="info-link" id="question-info">Инфо</button></div><h1 tabindex="-1">${escape(q.text)}</h1><p class="population-scope">${escape(population)}</p></div><div class="field-head"><div id="answer-values" class="answers ${revealed ? 'round-scores' : 'single'}"></div><div class="field-timer" ${revealed || state.practice ? 'hidden' : ''}><span id="timer" class="timer">15</span><span>сек.</span></div></div><div id="squares" class="squares" data-theme="${escape(q.icon || 'spark')}" role="slider" tabindex="${revealed ? '-1' : '0'}" aria-label="Твой ответ в процентах" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-valuetext="Ответ не выбран">${Array.from({ length: 100 }, (_, i) => `<span class="square" data-value="${i + 1}" aria-hidden="true">${questionIcon(q.icon)}</span>`).join('')}</div>${toolbar}<div class="actions"><button id="main-action" class="button primary" disabled>Ответить</button><p id="opponent-status" class="opponent-status" role="status"></p></div>${revealed ? revealMarkup() : ''}<button id="leave-room" class="text-button" ${state.practice && revealed ? 'hidden' : ''}>${state.practice ? 'Пропустить' : 'Выйти'}</button></div>`;
  if (revealed) {
    const record = room.history.at(-1);
    $('answer-values').innerHTML = orderedPlayers().map(p => answerMarkup(p.slot === room.role ? 'self' : 'other', `${p.slot === room.role ? 'Ты' : 'Друг'} · ${p.name}`, p.answer, state.practice ? null : record[p.slot])).join('') + answerMarkup('actual', 'Реальность', q.answerLabel);
    for (const p of orderedPlayers()) if (p.answer !== null) mark(p.answer, p.slot === room.role ? 'self' : 'other');
    mark(q.answer, 'actual');
    $('main-action').onclick = () => state.practice ? finishPractice() : act('ready', { round: room.round });
  } else {
    $('answer-values').innerHTML = answerMarkup('self', `Ты · ${self().name}`, state.selected, null, true);
    wireSelector(); $('main-action').onclick = submit;
  }
  $('question-info').onclick = openInfo;
  $('leave-room').onclick = state.practice ? finishPractice : leaveRoom;
}
function answerMarkup(kind, name, value, result = null, editable = false) {
  const label = value === null ? '—' : String(value).replace('%', '');
  const score = result ? `<div class="answer-result"><span class="answer-error">${result.error === null ? 'Нет ответа' : `±${result.error}`}</span><strong class="answer-gain">+${result.score}</strong></div>` : '';
  return `<div class="answer-item ${kind}"><p><i class="answer-tag" aria-hidden="true"></i>${escape(name)}</p><div class="answer-number"><span${editable ? ' id="my-value"' : ''}>${escape(label)}</span>${value === null ? '' : '<small>%</small>'}</div>${score}</div>`;
}
function revealMarkup() {
  const room = state.room, record = room.history.at(-1), error = record[room.role].error;
  const missed = orderedPlayers().some(p => p.answer === null);
  const disappointed = !missed && revealSound(record, room.mode) === 'disappointed';
  const soloTitle = error === null ? 'Время вышло' : error <= 2 ? 'Почти идеально' : error <= 5 ? 'Очень близко' : error <= 10 ? 'Неплохо' : error <= 20 ? 'Мир немного другой' : 'Вот это сюрприз';
  const title = state.practice ? 'Вот и весь принцип!' : room.mode === 'solo' ? soloTitle : missed ? 'Не все успели' : disappointed ? 'Мир удивил обоих' : record.host.score === record.guest.score ? 'Поровну!' : `${escape(room.players[record.host.score > record.guest.score ? 0 : 1].name)} ближе!`;
  return `<section class="result-box" data-reaction="${disappointed ? 'disappointed' : 'close'}"><h2>${title}</h2></section>`;
}
function mark(value, kind) {
  const target = value === 0 ? $('zero') : $('squares').querySelector(`[data-value="${value}"]`);
  if (!target) return;
  target.classList.add(`mark-${kind}`);
  const marker = document.createElement('i'); marker.className = `field-marker ${kind}`; marker.setAttribute('aria-hidden', 'true'); target.append(marker);
}
function openInfo() {
  const q = state.room?.question, revealed = state.room && state.room.phase !== 'playing';
  $('info-content').innerHTML = `${q ? `<h2>${escape(q.text)}</h2><p>${escape(q.context)}</p>${revealed ? `<p>${escape(q.explanation)}</p><p class="small">${escape(q.sourceName)} · ${q.year_kind === 'reference' ? 'Справочная оценка' : q.year}</p><a href="${escape(q.sourceUrl)}" target="_blank" rel="noopener noreferrer">Источник ↗</a>` : `<p class="small">${q.year_kind === 'reference' ? 'Справочная оценка' : `Данные: ${q.year}`}</p>`}` : '<h2>Как играть</h2><p>Выбери процент и нажми «Ответить». Чем ближе к реальности, тем больше баллов.</p>'}<details class="rules-details"><summary>Правила и баллы</summary><p>Одна клетка — 1%. На ответ 15 секунд. Выбранный процент нужно отправить кнопкой. Пропуск — 0 баллов.</p><p>Ошибка в процентных пунктах:<br>0–2 → 100 баллов · 3–5 → 80<br>6–10 → 60 · 11–15 → 40<br>16–20 → 20 · больше 20 → 0</p><p>Средняя ошибка считается только по отправленным ответам. Данные округлены до целого процента. Скорость ответа не даёт бонуса.</p></details>`;
  $('info-dialog').showModal();
}
function startPractice() {
  if (state.session) return;
  clearTimeout(state.availabilityTimer); state.practice = true; state.selected = null;
  const question = { id: 'practice', text: 'Какой процент поверхности Земли покрыт водой?', scope: 'Вся поверхность Земли', icon: 'drop', year: 2018, year_kind: 'reference', answer: 71, answerLabel: '≈71%', context: 'Считаем площадь поверхности Земли, включая сушу и океаны.', explanation: 'Вода покрывает около 71% поверхности нашей планеты.', sourceName: 'USGS', sourceUrl: 'https://www.usgs.gov/water-science-school/science/freshwater-lakes-and-rivers-and-water-cycle' };
  state.room = { code: 'practice', mode: 'solo', role: 'host', round: 0, phase: 'playing', question, players: [{ slot: 'host', name: avatarNames[state.avatar], avatar: state.avatar, answer: null, answered: false, score: 0, ready: false }], history: [] };
  $('setup').hidden = true; $('room-view').hidden = false; document.body.classList.add('in-game'); renderBoard(); updateLive();
  $('room-view').querySelector('h1').focus({ preventScroll: true });
}
function finishPractice() {
  try { localStorage.setItem('among8-practice', 'done'); } catch {}
  state.practice = false; state.room = null; state.selected = null; state.renderKey = '';
  document.body.classList.remove('in-game'); $('room-view').hidden = true; $('room-view').innerHTML = ''; $('setup').hidden = false;
  chooseMode($('room-code').value ? 'duel' : state.mode); mountCharacters(); window.scrollTo(0, 0);
}
function recoverSession() {
  saveSession(null); clearTimeout(state.pollTimer); clearTimeout(state.availabilityTimer);
  state.room = null; state.renderKey = ''; state.pending = false; state.draftToken = null;
  $('connection').hidden = true; showError(''); $('setup').hidden = true; $('room-view').hidden = false; document.body.classList.remove('in-game');
  $('room-view').innerHTML = '<div class="lobby"><h1 tabindex="-1">Комната недоступна</h1><button id="return-home" class="button primary">Начать новую игру</button></div>';
  $('return-home').onclick = returnHome; $('room-view').querySelector('h1').focus();
}
function canAnswer() { const r = state.room; return r?.phase === 'playing' && (state.practice || serverTime() >= r.startAt && serverTime() < r.deadline) && !self()?.answered && !state.pending; }
function select(value, withSound = true) {
  if (!canAnswer()) return;
  if (withSound) { unlockSound(); playSound('tap'); }
  state.selected = Math.max(0, Math.min(100, Math.round(value))); updateSelection();
}
function updateSelection() {
  if ($('my-value')) { $('my-value').textContent = state.selected ?? '—'; const number = $('my-value').parentElement; if (state.selected !== null && !number.querySelector('small')) number.insertAdjacentHTML('beforeend', '<small>%</small>'); }
  const grid = $('squares'); if (!grid) return;
  grid.querySelectorAll('.square').forEach((cell, i) => cell.classList.toggle('filled', state.selected !== null && i < state.selected));
  grid.setAttribute('aria-valuenow', String(state.selected ?? 0)); grid.setAttribute('aria-valuetext', state.selected === null ? 'Ответ не выбран' : `${state.selected} процентов`);
  if ($('main-action') && state.room.phase === 'playing') {
    $('main-action').disabled = !canAnswer() || state.selected === null;
    if (canAnswer()) $('main-action').textContent = state.selected === null ? 'Выбери процент' : `Ответить: ${state.selected}%`;
  }
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
  grid.onpointermove = event => { if (event.pointerId === state.pointer) select(pointerValue(event), false); };
  const end = event => { if (state.pointer === event.pointerId) { state.pointer = null; if (grid.hasPointerCapture(event.pointerId)) grid.releasePointerCapture(event.pointerId); } };
  grid.onpointerup = end; grid.onpointercancel = end; grid.onlostpointercapture = () => { state.pointer = null; };
  grid.onkeydown = event => { const changes = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 }; if (event.key in changes) { event.preventDefault(); select((state.selected ?? 0) + changes[event.key]); } else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); select(event.key === 'Home' ? 0 : 100); } else if (event.key === 'Enter' && !event.repeat) { event.preventDefault(); submit(); } };
  $('zero').onclick = () => select(0); $('hundred').onclick = () => select(100); $('minus').onclick = () => select((state.selected ?? 1) - 1); $('plus').onclick = () => select((state.selected ?? 0) + 1);
}
function submit() {
  if (!canAnswer() || state.selected === null) return;
  if (!state.practice) { act('answer', { value: state.selected, round: state.room.round }); return; }
  const me = self(), error = Math.abs(state.selected - state.room.question.answer);
  me.answer = state.selected; me.answered = true; state.room.phase = 'reveal'; state.room.revealAt = performance.now();
  state.room.history = [{ host: { answer: me.answer, error, score: 0 }, guest: { answer: null, error: null, score: 0 } }];
  renderBoard(); playSound('reveal'); updateLive();
}

function updateLive() {
  const room = state.room; if (!room) return;
  const me = self(), other = opponent();
  if (state.practice) {
    const revealed = room.phase === 'reveal'; updateSelection();
    $('main-action').disabled = revealed ? performance.now() < room.revealAt + 700 : state.selected === null;
    $('main-action').textContent = revealed ? 'Играть' : state.selected === null ? 'Выбери процент' : `Ответить: ${state.selected}%`;
    $('squares').setAttribute('aria-disabled', String(revealed));
    return;
  }
  if (room.phase === 'waiting' && $('start-match')) $('start-match').disabled = state.pending || room.role !== 'host' || !room.players[1];
  if (!['playing', 'reveal', 'finished'].includes(room.phase)) return;
  if (room.phase === 'playing') {
    const now = serverTime(), counting = now < room.startAt, remaining = Math.max(0, Math.ceil((room.deadline - now) / 1000));
    $('timer').textContent = counting ? Math.max(1, Math.ceil((room.startAt - now) / 1000)) : remaining;
    $('timer').classList.toggle('urgent', !counting && remaining <= 5);
    $('timer').setAttribute('aria-label', counting ? 'Отсчёт до начала' : `Осталось ${remaining} секунд`);
    $('time-fill')?.style.setProperty('--remaining', String(counting ? 1 : Math.max(0, Math.min(1, (room.deadline - now) / 15000))));
    $('main-action').textContent = state.pending ? 'Отправляем…' : me.answered ? 'Ответ принят' : remaining === 0 ? 'Время вышло' : counting ? 'Приготовься…' : state.selected === null ? 'Выбери процент' : `Ответить: ${state.selected}%`;
    $('squares').setAttribute('aria-disabled', String(!canAnswer()));
    for (const id of ['zero', 'hundred', 'minus', 'plus']) if ($(id)) $(id).disabled = !canAnswer();
    updateSelection();
    $('opponent-status').textContent = room.mode === 'solo' ? '' : !other.connected ? `${other.name} не в сети` : other.answered ? `${other.name} ответил` : `${other.name} выбирает`;
    const tick = counting ? `start-${Math.ceil((room.startAt - now) / 1000)}` : String(remaining);
    if (tick !== state.lastTick) { if (counting || remaining > 0 && remaining <= 5 && !me.answered) playSound('tick'); if (!counting && state.lastTick?.startsWith('start')) playSound('start'); state.lastTick = tick; }
  } else if (room.phase === 'reveal') {
    $('main-action').disabled = state.pending || me.ready || serverTime() < room.revealAt + 1000;
    $('main-action').textContent = me.ready ? 'Ждём соперника…' : room.round === 9 ? 'Результат' : 'Следующий вопрос';
    $('opponent-status').textContent = room.mode === 'solo' ? '' : other.ready ? `${other.name}: можно продолжать` : 'Ждём двоих';
    $('zero')?.setAttribute('aria-disabled', 'true'); $('hundred')?.setAttribute('aria-disabled', 'true'); $('squares').setAttribute('aria-disabled', 'true'); updateSelection();
  } else if ($('rematch')) {
    $('rematch').disabled = state.pending || me.ready; $('rematch').textContent = room.mode === 'solo' ? 'Сыграть ещё раз' : me.ready ? 'Ждём друга…' : 'Сыграть реванш';
    $('rematch-status').textContent = room.mode === 'solo' ? 'Те же факты, новый порядок' : other.ready ? `${other.name} предлагает реванш` : 'Новая игра по согласию обоих';
  }
}

function renderFinal() {
  if (state.room.mode === 'solo') { renderSoloFinal(); return; }
  const room = state.room, [a, b] = room.players; const title = a.score === b.score ? 'Интуиция на равных!' : `${escape(a.score > b.score ? a.name : b.name)} выигрывает!`;
  const stat = slot => { const valid = room.history.map(r => r[slot].error).filter(e => e !== null); return { average: valid.length ? (valid.reduce((a, b) => a + b, 0) / valid.length).toLocaleString('ru-RU', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : '—', missed: 10 - valid.length }; };
  $('room-view').innerHTML = `<div class="final"><p class="eyebrow">НАБОР ${room.questionSet || 1} · РЕЗУЛЬТАТ</p><h1 tabindex="-1">${title}</h1><div class="versus-line">${room.players.map((p, i) => `${i ? '<span class="versus">vs</span>' : ''}<div>${playerMarkup(p, p.slot === room.role, true)}<p class="final-average">Средняя ошибка: ${stat(p.slot).average} п.п.<br>Без ответа: ${stat(p.slot).missed}</p></div>`).join('')}</div><button id="rematch" class="button primary">Сыграть реванш</button><p id="rematch-status" class="small"></p><button id="share-result" class="button secondary">Поделиться результатом</button><p id="share-status" class="small" role="status"></p><textarea id="share-fallback" readonly hidden aria-label="Результат для копирования"></textarea><button id="leave-room" class="text-button">Новая дуэль с другим другом</button></div>`;
  $('rematch').onclick = () => act('rematch', { round: room.round }); $('share-result').onclick = shareResult; $('leave-room').onclick = leaveRoom;
}
async function shareResult() {
  const room = state.room;
  const text = `Among8 · набор ${room.questionSet || 1}\n\n${room.players.filter(Boolean).map(p => `${p.name}: ${p.score} / 1000`).join('\n')}\n\nНасколько хорошо ты знаешь мир?`;
  const url = location.href.split('?')[0];
  try { if (navigator.share) { await navigator.share({ title: 'Among8', text, url }); return; } }
  catch (error) { if (error.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); if (state.room === room && $('share-status')) $('share-status').textContent = 'Скопировано'; }
  catch { if (state.room !== room || !$('share-fallback')) return; $('share-fallback').hidden = false; $('share-fallback').value = `${text}\n${url}`; $('share-fallback').focus(); $('share-fallback').select(); $('share-status').textContent = 'Скопируй текст'; }
}
function renderClosed() { $('room-view').innerHTML = '<div class="lobby"><h1 tabindex="-1">Дуэль завершена</h1><p class="lead">Один из игроков вышел из комнаты.</p><button id="return-home" class="button primary">Создать новую дуэль</button></div>'; $('return-home').onclick = returnHome; }
async function leaveRoom() {
  if (state.pending) return;
  if (state.room?.mode === 'duel' && !['closed', 'finished'].includes(state.room.phase) && !window.confirm('Выйти из дуэли?')) return;
  if (await act('leave')) returnHome();
}
function returnHome() { document.body.classList.remove('in-game'); const previous = self(); if (previous) { state.avatar = previous.avatar; $('avatar-options').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.avatar === state.avatar))); } clearTimeout(state.pollTimer); saveSession(null); Object.assign(state, { room: null, renderKey: '', selected: null, pending: false, draftToken: null }); $('room-view').hidden = true; $('room-view').innerHTML = ''; $('setup').hidden = false; $('connection').hidden = true; $('room-code').value = ''; showError(''); history.replaceState(null, '', location.pathname); chooseMode(state.mode); mountCharacters(); window.scrollTo({ top: 0, behavior: 'instant' }); }

function renderSoloFinal() {
  const room = state.room, p = room.players[0], valid = room.history.map(r => r.host.error).filter(e => e !== null);
  const average = valid.length ? (valid.reduce((a, b) => a + b, 0) / valid.length).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—';
  const verdict = p.score >= 900 ? 'Ты пугающе хорошо понимаешь мир.' : p.score >= 750 ? 'Твоя интуиция работает.' : p.score >= 550 ? 'Мир иногда удивляет тебя.' : p.score >= 350 ? 'Реальность оказалась страннее.' : 'Похоже, Земля устроена совсем не так, как кажется.';
  $('room-view').innerHTML = `<div class="final solo-final"><p class="eyebrow">НАБОР ${room.questionSet || 1} · РЕЗУЛЬТАТ</p><h1 tabindex="-1">${escape(p.name)}, вот твой результат</h1>${playerMarkup(p, true, true)}<p class="final-average">Средняя ошибка: ${average} п.п.<br>Без ответа: ${10 - valid.length}</p><div class="summary"><h2>${verdict}</h2></div><button id="rematch" class="button primary">Сыграть ещё раз</button><p id="rematch-status" class="small"></p><button id="share-result" class="button secondary">Поделиться результатом</button><p id="share-status" class="small" role="status"></p><textarea id="share-fallback" readonly hidden aria-label="Результат для копирования"></textarea><button id="leave-room" class="text-button">Выбрать другой режим</button></div>`;
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

  showError('');
  checkAvailability();
}

function initialize() {
  $('avatar-options').innerHTML = Object.entries(avatarNames).map(([kind, name]) => `<button class="avatar-option" type="button" data-avatar="${kind}" aria-label="Персонаж ${name}" aria-pressed="${kind === state.avatar}">${character(kind, 'aria-hidden="true"')}<span>${name}</span><span class="avatar-status"></span></button>`).join('');
  $('avatar-options').onclick = event => { const button = event.target.closest('[data-avatar]'); if (!button || button.disabled) return; state.avatar = button.dataset.avatar; updateCharacterChoices(); };
  $('room-code').oninput = () => { clearTimeout(state.availabilityTimer); state.availability = null; updateCharacterChoices(); state.availabilityTimer = setTimeout(checkAvailability, 180); };
  $('setup-form').onsubmit = event => { event.preventDefault(); enterRoom(!!$('room-code').value.trim()); };
  $('join-button').onclick = () => enterRoom(true);
  document.querySelectorAll('[data-mode]').forEach(b => { b.onclick = () => chooseMode(b.dataset.mode); });
  $('sound-toggle').onclick = () => { toggleSound(); soundButton(); if (soundEnabled()) playSound('tap'); }; soundButton();
  document.querySelectorAll('[data-question-set]').forEach(button => { button.onclick = () => { if (button.disabled) return; state.questionSet = Number(button.dataset.questionSet); state.draftToken = null; updateCharacterChoices(); }; });
  document.addEventListener('click', event => {
    const control = event.target.closest('button, a, summary, input');
    if (!control || control.disabled || control.matches('#sound-toggle, #zero, #hundred, #minus, #plus')) return;
    unlockSound(); playSound('tap');
  }, true);
  document.addEventListener('keydown', event => { if (event.repeat && ['Enter', ' '].includes(event.key)) event.preventDefault(); });
  const code = new URLSearchParams(location.search).get('room')?.toUpperCase();
  if (code) { $('room-code').value = code; $('create-button').textContent = 'Присоединиться к дуэли →'; $('join-button').hidden = true; }
  chooseMode(code ? 'duel' : 'solo');
  $('join-details').open = !!code;
  $('info-open').onclick = openInfo;
  $('info-close').onclick = () => $('info-dialog').close();
  $('practice-again').onclick = startPractice;
  document.querySelector('header .brand').onclick = event => { event.preventDefault(); if (state.practice) finishPractice(); else if (state.session) leaveRoom(); else window.scrollTo(0, 0); };
  try { const saved = JSON.parse(localStorage.getItem('among8-session')); if (saved?.code && /^[a-f0-9]{64}$/.test(saved.token) && (!code || code === saved.code)) { saveSession(saved); state.draftToken = saved.token; sync(); } } catch {}
  let practiced = false; try { practiced = localStorage.getItem('among8-practice') === 'done'; } catch {}
  if (!state.session && !practiced) startPractice();
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
