export const SONGBOOK_DIFFICULTIES = Object.freeze([
  { value: 1, label: '아주 쉬움' }, { value: 2, label: '쉬움' }, { value: 3, label: '보통' },
  { value: 4, label: '어려움' }, { value: 5, label: '아주 어려움' },
]);
export const SONGBOOK_REQUEST_STATUSES = Object.freeze(['pending', 'singing', 'done', 'rejected', 'cancelled']);

export function songbookError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function text(value, label, max, required = false) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw songbookError(`${label}을(를) 확인해 주세요.`);
  const result = value.trim();
  if (required && !result) throw songbookError(`${label}을(를) 입력해 주세요.`);
  return result;
}

export function songbookVideoId(value) {
  if (!value) return null;
  if (typeof value !== 'string' || value.length > 2048) return null;
  const raw = value.trim();
  if (/^[a-z0-9_-]{11}$/i.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    let id;
    if (host === 'youtu.be') id = url.pathname.split('/')[1];
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
      id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|embed|live)\/([\w-]+)/.exec(url.pathname)?.[1];
    }
    return /^[a-z0-9_-]{11}$/i.test(id || '') ? id : null;
  } catch { return null; }
}

export function normalizeSongbookSong(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw songbookError('곡 정보를 확인해 주세요.');
  const title = text(input.title ?? '', '제목', 200, true);
  const artist = text(input.artist ?? '', '가수', 120, true);
  const youtube = text(input.youtubeUrl ?? '', '유튜브 주소', 2048);
  const videoId = songbookVideoId(youtube);
  if (youtube && !videoId) throw songbookError('올바른 유튜브 영상 주소를 입력해 주세요.');
  const keyShift = Number(input.keyShift ?? 0);
  const difficulty = Number(input.difficulty ?? 3);
  if (!Number.isInteger(keyShift) || keyShift < -12 || keyShift > 12) throw songbookError('키 조절은 -12부터 +12까지 반음 단위로 입력해 주세요.');
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) throw songbookError('난이도를 선택해 주세요.');
  if (!Array.isArray(input.tags ?? []) || (input.tags || []).length > 12) throw songbookError('태그는 최대 12개까지 입력할 수 있습니다.');
  const tags = [...new Map((input.tags || []).map((tag) => {
    const value = text(tag, '태그', 24, true);
    return [value.toLocaleLowerCase('ko-KR'), value];
  })).values()];
  for (const key of ['visible', 'requestable']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw songbookError('곡 공개·신청 설정을 확인해 주세요.');
  return { title, artist, videoId, keyShift, difficulty, tags, note: text(input.note ?? '', '곡 메모', 1000),
    privateNote: text(input.privateNote ?? '', '비공개 메모', 2000), visible: input.visible !== false, requestable: input.requestable !== false };
}

export function normalizeSongbookSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw songbookError('신청 설정을 확인해 주세요.');
  if (typeof input.requestsEnabled !== 'boolean') throw songbookError('신청 접수 여부를 확인해 주세요.');
  const perUserLimit = Number(input.perUserLimit ?? 1);
  if (!Number.isInteger(perUserLimit) || perUserLimit < 1 || perUserLimit > 10) throw songbookError('인당 대기 한도는 1곡부터 10곡까지 설정할 수 있습니다.');
  return { requestsEnabled: input.requestsEnabled, perUserLimit };
}

export function publicSongbookSong(song) {
  return { id: song.id, title: song.title, artist: song.artist, videoId: song.videoId || null,
    youtubeUrl: song.videoId ? `https://www.youtube.com/watch?v=${song.videoId}` : null,
    thumbnailUrl: song.videoId ? `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg` : null,
    keyShift: song.keyShift, difficulty: song.difficulty, tags: song.tags || [], note: song.note || '', requestable: song.requestable !== false };
}

export function normalizeSongbookQuery(query = {}) {
  const search = text(query.search ?? '', '검색어', 100);
  const tag = text(query.tag ?? '', '태그', 24);
  const difficulty = query.difficulty ? Number(query.difficulty) : null;
  if (difficulty !== null && (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5)) throw songbookError('난이도를 확인해 주세요.');
  const page = Number(query.page ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > 10000) throw songbookError('페이지를 확인해 주세요.');
  const sort = ['title', 'artist', 'newest'].includes(query.sort) ? query.sort : 'title';
  return { search, tag, difficulty, page, limit: 24, sort };
}
