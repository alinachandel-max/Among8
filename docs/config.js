// Same-origin on Sites; set to the backend origin when publishing on GitHub Pages.
export const API_ORIGIN = location.hostname.endsWith('.github.io')
  ? 'https://among8-duel.alinachandel.chatgpt.site'
  : '';
