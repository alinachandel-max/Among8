// Small original SVG symbols. Every symbol is still one percentage point.
const paths = {
  bulb: '<path fill="currentColor" stroke="none" d="M12 2a7 7 0 0 0-4 12.74V17h8v-2.26A7 7 0 0 0 12 2Zm-3 17h6v2H9z"/>',
  wifi: '<path d="M3 8a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="20" r="1.5" fill="currentColor" stroke="none"/>',
  hand: '<path d="M7 12V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-6a1.5 1.5 0 0 1 3 0v6-4a1.5 1.5 0 0 1 3 0v8c0 4-2 7-6 7-3 0-5-1-7-4l-3-4c-1-2 1-3 2-2l2 2Z"/>',
  book: '<path d="M12 5C9 3 5 3 2 4v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-3-1-7-1-10 1Zm0 0v15M5 8h3M16 8h3M5 12h3M16 12h3"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M7 14c2 4 8 4 10 0"/><circle cx="8" cy="9" r="1" fill="currentColor"/><circle cx="16" cy="9" r="1" fill="currentColor"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M15 7H11a3 3 0 0 0 0 6h2a2 2 0 0 1 0 4H9M12 5v14"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4M11 19h2"/>',
  spark: '<path fill="currentColor" stroke="none" d="m12 1 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z"/>',
  drop: '<path fill="currentColor" stroke="none" d="M12 1C10 5 4 10 4 15a8 8 0 0 0 16 0c0-5-6-10-8-14Z"/>',
  food: '<path d="M4 2v7c0 3 6 3 6 0V2M7 2v20M18 2c-4 5-4 10 0 10V2Zm0 10v10"/>',
  wave: '<path d="M2 7c3-5 6 5 10 0s7 5 10 0M2 12c3-5 6 5 10 0s7 5 10 0M2 17c3-5 6 5 10 0s7 5 10 0"/>',
  coffee: '<path d="M4 8h12v7a6 6 0 0 1-12 0Zm12 1h2a3 3 0 0 1 0 6h-2M3 22h16M7 2v3M12 2v3"/>',
  tree: '<path fill="currentColor" stroke="none" d="m12 1 7 9h-4l7 9h-8v4h-4v-4H2l7-9H5Z"/>',
  paw: '<ellipse cx="6" cy="8" rx="2.5" ry="3.5" fill="currentColor" stroke="none"/><ellipse cx="12" cy="5" rx="2.5" ry="3.5" fill="currentColor" stroke="none"/><ellipse cx="18" cy="8" rx="2.5" ry="3.5" fill="currentColor" stroke="none"/><path fill="currentColor" stroke="none" d="M12 11c-4 0-9 7-7 10 2 2 5-1 7-1s5 3 7 1c2-3-3-10-7-10Z"/>',
  car: '<path d="m4 11 2-7h12l2 7M3 11h18v8H3ZM7 11h10M6 15h2M16 15h2M5 19v3M19 19v3"/>',
  moon: '<path fill="currentColor" stroke="none" d="M21 16A10 10 0 0 1 8 3a10 10 0 1 0 13 13Z"/>',
  bee: '<ellipse cx="12" cy="15" rx="7" ry="5"/><path d="M9 11v8M14 11v8M6 12C-1 4 11 1 11 10M17 12c8-8-4-11-4-2M19 15h3"/>',
  air: '<path d="M2 8h14c5 0 5-6 1-6M2 12h18c4 0 4 5 0 5M2 17h10c4 0 4 5 0 5"/>',
  home: '<path d="m2 11 10-9 10 9M5 9v13h14V9M10 22v-8h4v8"/>',
};
export function questionIcon(kind) {
  const name = Object.hasOwn(paths, kind) ? kind : 'spark';
  return `<svg data-symbol="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
