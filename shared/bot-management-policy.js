export const BOT_MANAGER_SCOPE_GROUPS = Object.freeze([
  { key: 'dashboard', label: '대시보드', description: '방송 현황과 봇 통계' },
  { key: 'connection', label: '플랫폼 연결', description: '연결 상태 확인과 봇 재연결' },
  { key: 'commands', label: '채팅 명령어', description: '명령어, 출석 메시지와 실행 반응' },
  { key: 'macros', label: '자동 알림', description: '주기적인 채팅 공지' },
  { key: 'points', label: '시청자 포인트', description: '잔액, 적립, 가져오기와 내보내기' },
  { key: 'predictions', label: '예측 베팅', description: '예측 개설, 종료와 정산' },
  { key: 'roulette', label: '룰렛', description: '룰렛 항목과 실행' },
  { key: 'wheel', label: '돌림판', description: '참여 설정, 항목과 추첨' },
  { key: 'marble', label: '주루마블', description: '게임판, 참가자, 초대와 게임 진행' },
  { key: 'video', label: '영상 후원 · BGM', description: '재생 설정과 대기열 제어' },
  { key: 'songbook', label: '노래책', description: '곡 정보와 노래 신청 관리' },
  { key: 'emotes', label: '이모티콘 오버레이', description: '이모티콘 효과와 OBS 주소 관리' },
  { key: 'drawing', label: '그림 후원', description: '그림 설정, 승인과 대기열 제어' },
  { key: 'donations', label: '후원 반응', description: '후원 조건과 실행 반응' },
  { key: 'automations', label: '방송 자동화', description: '방송 PC 도구와 자동화 실행' },
  { key: 'actions', label: '실행 액션', description: '블루프린트 편집과 실행 (포인트·방송 도구 포함)' },
  { key: 'logs', label: '이벤트 로그', description: '이벤트 기록과 허용된 효과 재생' },
  { key: 'settings', label: '기본 설정', description: '봇 활성화와 기본 동작' },
]);

const scopeNames = new Set(BOT_MANAGER_SCOPE_GROUPS.flatMap(({ key }) => [`${key}:read`, `${key}:write`]));

export function normalizeBotManagerScopes(value = ['*']) {
  if (!Array.isArray(value) || !value.length || value.length > scopeNames.size
    || value.some((scope) => typeof scope !== 'string' || (scope !== '*' && !scopeNames.has(scope)))
    || (value.includes('*') && value.length !== 1)) {
    throw Object.assign(new Error('유효한 관리 권한을 하나 이상 선택해 주세요.'), { status: 400, code: 'invalid_manager_scopes' });
  }
  if (value[0] === '*') return ['*'];
  return [...new Set(value.flatMap((scope) => scope.endsWith(':write') ? [scope.replace(':write', ':read'), scope] : [scope]))].sort();
}

export function hasBotManagerScope(access, feature, mode = 'read') {
  if (!access) return false;
  if (access.role === 'owner' || access.role === 'site_admin') return true;
  const scopes = Array.isArray(access.scopes) ? access.scopes : [];
  return scopes.includes('*') || scopes.includes(`${feature}:${mode}`)
    || (mode === 'read' && scopes.includes(`${feature}:write`));
}

export function normalizeBotOwner(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9:_-]{1,180}$/.test(value) || !value.replace(/^user:/, '')) {
    throw Object.assign(new Error('올바른 관리 채널을 선택해 주세요.'), { status: 400, code: 'invalid_bot_owner' });
  }
  return value.replace(/^user:/, '');
}

// This allowlist is intentionally independent of authentication routes. Adding a
// new endpoint does not automatically make it available to delegated managers.
export function botManagementRoutePolicy(method, pathname) {
  const path = String(pathname || '').toLowerCase().replace(/\/+$/, '');
  const verb = String(method || 'GET').toUpperCase();
  const read = verb === 'GET' || verb === 'HEAD';
  const rule = (features, options = {}) => ({ features: Array.isArray(features) ? features : [features], mode: read ? 'read' : 'write', ...options });
  if (/^\/api\/bot-management(?:\/|$)/.test(path)) return { management: true };
  if (read && ['/api/account/platforms', '/api/channel/context', '/api/bot/variables', '/api/bot/stats', '/api/platforms/status',
    '/api/chzzk/me', '/api/chzzk/live', '/api/cime/me', '/api/cime/live/me', '/api/youtube/me', '/api/youtube/live/me',
    '/api/youtube/status', '/api/youtube/streamer-channel'].includes(path)) return { base: true, mode: 'read' };
  if (path === '/api/bot/settings') return { settings: true, mode: read ? 'read' : 'write' };
  if (path === '/api/setup/templates/apply') return { fullAccess: true, mode: 'write' };
  if (path === '/api/short-links') return { base: true, mode: 'write' };
  if (/^\/api\/(?:video-donation|drawing-donation|roulette|fx)\/(?:viewer-url|rotate-viewer-token)$/.test(path)) {
    return { ownerOnly: true, preview: read, mode: 'write' };
  }
  if (/^\/api\/(?:apikey(?:\/|$)|auth(?:\/|$)|account$)/.test(path)) return { personal: true };
  if (path === '/api/youtube/streamer-channel/moderator-confirmed') return rule('connection');
  if (/^\/api\/automations\/(?:local-agents\/(?:pair|rotate)|control-links)$/.test(path)
    || (!read && /^\/api\/youtube\/streamer-channel(?:\/|$)/.test(path))) return { ownerOnly: true, mode: 'write' };
  if (path === '/api/account/platforms/refresh' || /^\/api\/(?:chzzk|cime|youtube)\/(?:events|reset)$/.test(path)) return rule('connection');
  if (/^\/api\/(?:chzzk\/(?:chat\/)?send|cime\/chat\/send|youtube\/chat\/send)$/.test(path)) return rule('commands');
  if (/^\/api\/bot\/blocked-users(?:\/[^/]+)?$/.test(path)) return rule(['commands', 'drawing']);
  if (/^\/api\/bot\/rules(?:\/(?:upsert|delete))?$/.test(path)) return rule('commands');
  if (path === '/api/bot/stats/incr') return rule('dashboard');
  if (/^\/api\/macros(?:\/(?:upsert|delete|reset-timers|performance))?$/.test(path)) return rule('macros');
  if (/^\/api\/channelpoints(?:\/(?:list|set|incr|get|delete|export(?:\/page)?|import|clear))?$/.test(path)) return rule('points');
  if (path === '/api/donation/settings') return rule(['points', 'donations']);
  if (/^\/api\/donation\/rules(?:\/(?:upsert|delete))?$/.test(path)) return rule('donations');
  if (/^\/api\/predictions(?:\/(?:active|create|[^/]+\/(?:lock|cancel|settle)))?$/.test(path)) return rule('predictions');
  if (/^\/api\/roulette\/(?:definitions(?:\/(?:upsert|delete))?|test|logs)$/.test(path)) return rule('roulette');
  if (/^\/api\/wheel(?:\/(?:settings|action))?$/.test(path)) return rule('wheel');
  if (/^\/api\/marble(?:\/(?:settings|layout|action|users|invites(?:\/[^/]+)?|overlay\/rotate))?$/.test(path)) return rule('marble');
  if (/^\/api\/songbook(?:\/(?:songs(?:\/[^/]+)?|settings|requests(?:\/[^/]+)?|overlay(?:\/rotate)?))?$/.test(path)) return rule('songbook');
  if (/^\/api\/emote-overlay(?:\/(?:settings|clear|rotate|test))?$/.test(path)) return rule('emotes');
  if (/^\/api\/video-donation\/(?:settings|queue|reorder|delete|delete-refund|pop|control|request|resolve-title|idle-playlist\/(?:resolve|recommend)|admin\/ws)$/.test(path)) return rule('video');
  if (/^\/api\/drawing-donation\/(?:settings|queue|items\/[^/]+|originals\/[^/]+|approve|reject|delete|delete-refund|moderate-block|reorder|admin\/ws)$/.test(path)) return rule('drawing');
  if (/^\/api\/bot\/event-logs(?:\/[^/]+\/replay)?$/.test(path)) return rule('logs');
  if (/^\/api\/action-blueprints(?:\/[^/]+(?:\/(?:runs|versions|publish|test|versions\/[^/]+\/restore))?|\/runs\/[^/]+\/steps)?$/.test(path)) return rule('actions');
  if (/^\/api\/automations\/(?:overview|settings|local-agents|connections(?:\/[^/]+)?|obs\/discover|tits\/(?:discover|throw|trigger)|vtube\/(?:discover|hotkey)|(?:toonation|tts|sounds|fx)\/test|run|assets\/sounds(?:\/[^/]+)?)$/.test(path)) return rule(['automations', ...(read ? ['actions'] : [])]);
  return null;
}

export function canUseBotManagementRoute(access, policy) {
  if (!access || !policy || policy.personal) return false;
  if (policy.management) return true;
  if (policy.ownerOnly) return access.role === 'owner' || access.role === 'site_admin';
  if (access.role === 'owner' || access.role === 'site_admin') return true;
  if (!Array.isArray(access.scopes) || !access.scopes.length) return false;
  if (policy.base || policy.settings) return true;
  if (policy.fullAccess) return access.scopes.includes('*');
  return (policy.features || []).some((feature) => hasBotManagerScope(access, feature, policy.mode));
}

const SECRET_KEY = /token|secret|password|credential|api.?key|authorization|cookie/i;
const INTERNAL_SETTINGS = new Set(['defaultBotRulesInitialized', 'setupTemplates']);
const BASIC_SETTINGS = new Set(['botEnabled', 'onlyWhenLive']);

export function redactBotManagerLogSecrets(value) {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (SECRET_KEY.test(key)) return undefined;
    if (typeof item !== 'string') return item;
    return item.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
      .replace(/(\/video-donation\/video@)[A-Za-z0-9_-]+/g, '$1[redacted]')
      .replace(/([?&](?:token|access_token|api_key|key|secret)=)[^&#\s"<>]+/gi, '$1[redacted]')
      .replace(/(\/(?:drawing-overlay|pvd|fx|viewer\/(?:bgm|pvd|requests|emotes))\/)[A-Za-z0-9_%.-]+/g, '$1[redacted]');
  }));
}

export function botSettingFeatures(key) {
  if (SECRET_KEY.test(key) || INTERNAL_SETTINGS.has(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) return [];
  if (key === 'channelPointsPerAttendance') return ['commands', 'points'];
  if (key.startsWith('channelPoints')) return ['points'];
  if (key.startsWith('attendance') || key === 'rules') return ['commands'];
  if (key === 'blockedBotUsers') return ['commands', 'drawing'];
  if (key === 'macros') return ['macros'];
  if (key === 'donation') return ['points', 'donations'];
  if (key === 'donationRules') return ['donations'];
  if (key === 'rouletteDefs') return ['roulette'];
  if (key === 'drawingDonation') return ['drawing'];
  if (/^(videoDonation|bgm)/.test(key)) return ['video'];
  if (BASIC_SETTINGS.has(key)) return ['settings'];
  return [];
}

export function filterBotManagerSettings(settings, access) {
  if (!access || access.role !== 'manager') return settings;
  return Object.fromEntries(Object.entries(settings || {}).filter(([key]) =>
    botSettingFeatures(key).some((feature) => hasBotManagerScope(access, feature, 'read'))));
}

// Roulette result values can invoke existing commands, including published
// blueprints. Binding a chained effect therefore requires execution access too.
export function assertBotManagerEffects(value, access, { rouletteValues = false } = {}) {
  if (!access || access.role !== 'manager' || access.scopes?.includes('*')) return;
  const required = new Set();
  const pending = [value];
  let visited = 0;
  while (pending.length) {
    if (++visited > 100000) throw Object.assign(new Error('설정 항목이 너무 많습니다.'), { status: 400 });
    const item = pending.pop();
    if (typeof item === 'string') {
      if (/\$\{\s*(?:action|automation|blueprint)::[^}]+\}/i.test(item)) required.add('actions');
      if (/\$\{\s*roulette::[^}]+\}/i.test(item)) { required.add('roulette'); required.add('actions'); }
      if (/\$\{\s*(?:video_donation|bgm_request)\s*\}/i.test(item)) required.add('video');
      if (/\$\{\s*songbook_request\s*\}/i.test(item)) required.add('songbook');
      if (/\$\{\s*live\.(?:title_change|game_change)\s*\}/i.test(item)) required.add('connection');
    } else if (Array.isArray(item)) {
      for (const child of item) pending.push(child);
    }
    else if (item && typeof item === 'object') {
      if (rouletteValues && item.value != null && String(item.value).trim()) required.add('actions');
      for (const [key, child] of Object.entries(item)) {
        if (key === 'rouletteDefs' && Array.isArray(child)) assertBotManagerEffects(child, access, { rouletteValues: true });
        pending.push(child);
      }
    }
  }
  for (const feature of required) {
    if (!hasBotManagerScope(access, feature, 'write')) {
      const label = BOT_MANAGER_SCOPE_GROUPS.find((group) => group.key === feature)?.label || feature;
      throw Object.assign(new Error(`이 실행을 연결하려면 ${label} 수정 권한이 필요합니다.`), { status: 403, code: 'bot_effect_scope_required' });
    }
  }
}

export function mergeBotManagerSettings(current, incoming, access) {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    throw Object.assign(new Error('설정 형식이 올바르지 않습니다.'), { status: 400 });
  }
  if (!access || access.role !== 'manager') return incoming;
  const next = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (JSON.stringify(current[key]) === JSON.stringify(value)) continue;
    if (!botSettingFeatures(key).some((feature) => hasBotManagerScope(access, feature, 'write'))) {
      throw Object.assign(new Error('해당 설정을 수정할 권한이 없습니다.'), { status: 403, code: 'bot_scope_required' });
    }
    assertBotManagerEffects(value, access, { rouletteValues: key === 'rouletteDefs' });
    if (key.startsWith('attendance')) assertBotManagerEffects(incoming.attendanceMessage ?? current.attendanceMessage, access);
    next[key] = value;
  }
  return next;
}
