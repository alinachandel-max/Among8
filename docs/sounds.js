let context; let enabled = true;
try { enabled = localStorage.getItem('among8-sound') !== 'off'; } catch {}
export function soundEnabled() { return enabled; }
export function toggleSound() { enabled = !enabled; try { localStorage.setItem('among8-sound', enabled ? 'on' : 'off'); } catch {} if (enabled) unlockSound(); return enabled; }
export function unlockSound() { if (!enabled) return; try { context ||= new (window.AudioContext || window.webkitAudioContext)(); if (context.state === 'suspended') context.resume().catch(() => {}); } catch {} }
export function playSound(kind) {
  if (!enabled || !context) return;
  if (context.state === 'suspended') { context.resume().then(() => { if (context.state === 'running') scheduleNotes(kind); }).catch(() => {}); return; }
  if (context.state === 'running') scheduleNotes(kind);
}
export function revealSound(record, mode) {
  const players = mode === 'solo' ? [record.host] : [record.host, record.guest];
  return players.every(p => p.error === null || p.error > 10) ? 'disappointed' : 'reveal';
}
function scheduleNotes(kind) {
  const notes = { tap: [[440, .045]], lock: [[440, .06], [660, .09]], tick: [[620, .06]], start: [[392, .08], [523, .12]], reveal: [[330, .07], [440, .07], [660, .13]], disappointed: [[330, .11], [247, .14], [165, .23]], win: [[392, .12], [494, .12], [587, .12], [784, .25]] }[kind] || [];
  let offset = 0;
  for (const [frequency, duration] of notes) { const oscillator = context.createOscillator(), gain = context.createGain(), at = context.currentTime + offset; oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, at); gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(.065, at + .007); gain.gain.exponentialRampToValueAtTime(.001, at + duration); oscillator.connect(gain); gain.connect(context.destination); oscillator.start(at); oscillator.stop(at + duration + .01); offset += duration; }
}
