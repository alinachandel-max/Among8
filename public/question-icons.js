// Native emoji appear only inside selected cells; each cell is still one percent.
const emoji = {
  bulb: '💡', wifi: '🌐', hand: '✋', book: '📖', smile: '😄', coin: '💰',
  phone: '📱', spark: '✨', drop: '💧', food: '🍽️', wave: '💧', coffee: '☕',
  tree: '🌳', paw: '🐾', car: '🚗', moon: '😴', bee: '🐝', air: '🔵', home: '🏠', recycle: '♻️', pizza: '🍕',
};
export function questionIcon(kind) {
  const name = Object.hasOwn(emoji, kind) ? kind : 'spark';
  return `<span class="cell-emoji" data-symbol="${name}" aria-hidden="true">${emoji[name]}</span>`;
}
