// CHZZK public dp_1 pack, verified 2026-10-13. See docs/EMOTE_OVERLAY.md.
// Keep only image references, not copies or subscription/channel-specific assets.
const base = 'https://ssl.pstatic.net/static/nng/glive/icon/';
export const CHZZK_EMOTE_SAMPLES = Object.freeze([
  ['d_1', 'cha01.png'],
  ['d_41', 'b_01.gif'],
  ['d_2', 'cha02.png'],
  ['d_42', 'b_02.gif'],
  ['d_11', 'txt01.png'],
  ['d_21', 'a_01.png'],
  ['d_73', 'c_01.png'],
  ['d_3', 'cha03.png'],
].map(([id, file]) => Object.freeze({
  url: `${base}${file}`, name: `치지직 기본 이모티콘 ${id}`, provider: 'chzzk', sample: true,
})));

const sampleUrls = new Set(CHZZK_EMOTE_SAMPLES.map(item => item.url));

export function isChzzkEmoteSampleUrl(url) {
  return sampleUrls.has(url);
}

export function createChzzkEmoteSamples(count = 8) {
  const length = Number.isFinite(count) ? Math.max(0, Math.min(30, Math.floor(count))) : 8;
  return Array.from({ length }, (_, index) => ({ ...CHZZK_EMOTE_SAMPLES[index % CHZZK_EMOTE_SAMPLES.length] }));
}

export function chzzkEmoteSampleFallbacks(url) {
  if (!isChzzkEmoteSampleUrl(url)) return [];
  return CHZZK_EMOTE_SAMPLES.filter(item => item.url !== url && item.url.endsWith('.png')).slice(0, 2).map(item => item.url);
}
