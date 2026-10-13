import { songbookError } from './songbook.js';

export const SONGBOOK_OVERLAY_SIZES = Object.freeze({ landscape: { width: 1920, height: 1080 }, portrait: { width: 1080, height: 1920 } });
export const DEFAULT_SONGBOOK_OVERLAY = {
  accent: '#88e5cc', text: '#ffffff', background: '#171b1d', opacity: 82,
  scale: 1, maxRows: 5, artwork: true, requester: true, keyShift: false, hideEmpty: false,
  layouts: {
    landscape: { current: { x: 3, y: 77, width: 42, visible: true }, queue: { x: 75, y: 8, width: 22, visible: true } },
    portrait: { current: { x: 6, y: 79, width: 88, visible: true }, queue: { x: 12, y: 9, width: 76, visible: true } },
  },
};

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export function songbookOverlayRect(config, orientation, block) {
  const canvas = SONGBOOK_OVERLAY_SIZES[orientation] || SONGBOOK_OVERLAY_SIZES.landscape;
  const layout = config.layouts[orientation][block];
  const width = canvas.width * layout.width / 100;
  const height = Math.min(canvas.height, (block === 'current' ? 220 : 96 + 78 * config.maxRows + 44) * config.scale);
  return { x: clamp(canvas.width * layout.x / 100, 0, canvas.width - width), y: clamp(canvas.height * layout.y / 100, 0, canvas.height - height), width, height };
}

export function songbookOverlayCapacity(config, orientation) {
  const height = songbookOverlayRect(config, orientation, 'queue').height;
  return Math.max(1, Math.min(config.maxRows, Math.floor((height / config.scale - 140) / 78)));
}

export function normalizeSongbookOverlay(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw songbookError('오버레이 설정을 확인해 주세요.');
  const base = DEFAULT_SONGBOOK_OVERLAY;
  const number = (v, fallback, min, max) => {
    if (v === undefined) v = fallback;
    if (typeof v !== 'number' || !Number.isFinite(v)) throw songbookError('오버레이 숫자 설정을 확인해 주세요.');
    return Math.round(clamp(v, min, max) * 100) / 100;
  };
  const bool = (v, fallback) => {
    if (v !== undefined && typeof v !== 'boolean') throw songbookError('오버레이 표시 설정을 확인해 주세요.');
    return v ?? fallback;
  };
  const color = (v, fallback) => {
    if (v === undefined) return fallback;
    if (typeof v !== 'string' || !/^#[a-f0-9]{6}$/i.test(v)) throw songbookError('올바른 색상을 선택해 주세요.');
    return v.toLowerCase();
  };
  const result = {
    accent: color(input.accent, base.accent), text: color(input.text, base.text), background: color(input.background, base.background),
    opacity: number(input.opacity, base.opacity, 0, 100), scale: number(input.scale, base.scale, 0.7, 1.5),
    maxRows: Math.round(number(input.maxRows, base.maxRows, 1, 8)),
    artwork: bool(input.artwork, base.artwork), requester: bool(input.requester, base.requester),
    keyShift: bool(input.keyShift, base.keyShift), hideEmpty: bool(input.hideEmpty, base.hideEmpty),
    layouts: {},
  };
  for (const orientation of ['landscape', 'portrait']) {
    result.layouts[orientation] = {};
    for (const block of ['current', 'queue']) {
      const v = input.layouts?.[orientation]?.[block] ?? {};
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw songbookError('배치 설정을 확인해 주세요.');
      const fallback = base.layouts[orientation][block];
      result.layouts[orientation][block] = {
        x: number(v.x, fallback.x, 0, 100), y: number(v.y, fallback.y, 0, 100),
        width: number(v.width, fallback.width, Math.max(orientation === 'portrait' ? 40 : 18,
          (block === 'current' && result.artwork ? 400 : 320) * result.scale / SONGBOOK_OVERLAY_SIZES[orientation].width * 100), 100),
        visible: bool(v.visible, fallback.visible),
      };
    }
  }
  for (const orientation of ['landscape', 'portrait']) for (const block of ['current', 'queue']) {
    const rect = songbookOverlayRect(result, orientation, block);
    result.layouts[orientation][block].x = Math.round(rect.x / SONGBOOK_OVERLAY_SIZES[orientation].width * 10000) / 100;
    result.layouts[orientation][block].y = Math.round(rect.y / SONGBOOK_OVERLAY_SIZES[orientation].height * 10000) / 100;
  }
  return result;
}

export function songbookOverlaySnapshot(row, requests) {
  const config = normalizeSongbookOverlay(row.overlay_config || {});
  const current = requests.find(r => r.status === 'singing');
  const pending = requests.filter(r => r.status === 'pending');
  const item = value => ({
    id: String(value.id), title: String(value.song?.title || '').slice(0, 200),
    artist: String(value.song?.artist || '').slice(0, 120), username: String(value.username || '').slice(0, 100),
    videoId: /^[\w-]{11}$/.test(value.song?.videoId || '') ? value.song.videoId : null,
    keyShift: Number.isInteger(value.song?.keyShift) ? clamp(value.song.keyShift, -12, 12) : 0,
  });
  return {
    config, requestsEnabled: row.requests_enabled === true,
    current: current ? item(current) : null, queueCount: pending.length,
    queue: pending.slice(0, config.maxRows).map(item),
  };
}
