import crypto from 'node:crypto';
import { hasZalgoText } from '../shared/text-safety.js';
import { createBoundedRateStore } from './request-protection.js';
import { parseParticipationWheelSettings } from './participation-wheel.js';

const RESERVED_COMMANDS = new Set(['!투표', '!예측', '!출석', '!입장', '!퇴장']);
const MAX_CACHE = 1000;

export function wheelCommandAliases(settings = {}) {
  return ['chat', 'points'].filter((source) => settings[source]?.enabled)
    .map((source) => String(settings[source].command || '').trim().toLowerCase());
}

export function parseWheelCommand(text, settings) {
  const match = String(text || '').trim().match(/^(\S+)(?:\s+([\s\S]*))?$/u);
  if (!match) return null;
  const command = match[1].toLowerCase();
  const source = ['chat', 'points'].find((key) => settings?.[key]?.enabled && command === String(settings[key].command).toLowerCase());
  if (!source) return null;
  let label = (match[2] || '').trim(), slots = 1;
  if (source === 'points') {
    const amount = label.match(/^(\d+)(?:\s+([\s\S]*))?$/u);
    if (amount) { slots = Number(amount[1]); label = (amount[2] || '').trim(); }
  }
  if (!label || [...label].length > 60 || hasZalgoText(label) || !Number.isSafeInteger(slots) || slots < 1 || slots > 100) {
    return { source, invalid: true, command };
  }
  return { source, label, slots, command };
}

// Provider IDs take precedence. Legacy events without an ID use their original
// timestamp; only providers missing both fall back to a short duplicate window.
export function wheelEventId({ provider, kind, event = {}, userId = '', text = '', amount = 0, now = Date.now() }) {
  const raw = event.raw || event;
  const id = raw.messageId || raw.msgId || raw.eventId || raw.donationId || raw.transactionId ||
    (provider === 'youtube' ? event.id : kind === 'chat' ? raw.id || event.id : null);
  const time = raw.messageTime || raw.timestamp || raw.createdAt || raw.createdTime || raw.payDate || raw.msgTime || raw.time;
  const identity = id ? ['id', String(id)] : ['fallback', String(time || Math.floor(now / 5000)), String(userId), String(text), Number(amount)];
  return `${provider}:${kind}:${crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}

export function wheelErrorMessage(error) {
  const code = String(error?.code || error?.reason || error?.message || error || '');
  const messages = {
    closed: '돌림판 항목 모집이 마감되었습니다.', not_collecting: '돌림판 항목 모집이 마감되었습니다.',
    chat_limit: '이번 돌림판의 무료 참여 한도에 도달했습니다.', user_limit: '이번 돌림판의 무료 참여 한도에 도달했습니다.',
    capacity: '돌림판이 가득 찼습니다. 포인트는 차감되지 않았습니다.', wheel_full: '돌림판이 가득 찼습니다. 포인트는 차감되지 않았습니다.',
    insufficient_points: '돌림판에 참여할 포인트가 부족합니다.', disabled: '이 참여 방식은 현재 꺼져 있습니다.',
    invalid_identity: '참여자 식별 정보를 확인할 수 없습니다.', spinning: '돌림판이 돌아가고 있습니다. 추첨 종료 후 다시 시도해 주세요.',
    empty: '추첨할 항목을 먼저 추가해 주세요.', invalid_request_id: '요청 식별자가 필요합니다.',
    revision_conflict: '다른 화면에서 변경되었습니다. 새로 불러온 뒤 다시 시도해 주세요.',
    request_id_conflict: '이미 처리한 요청과 내용이 다릅니다. 상태를 새로 확인해 주세요.',
    entry_not_found: '이미 삭제된 항목입니다. 최신 목록을 확인해 주세요.',
    command_changed: '참여 명령어가 변경되었습니다. 새 명령어로 다시 참여해 주세요.',
    command_conflict: '채팅과 포인트 명령어는 서로 달라야 합니다.',
    invalid_label: '항목은 줄바꿈 없이 1~60자로 입력해 주세요.',
    invalid_slots: '추가할 칸 수는 1~100 사이의 정수로 입력해 주세요.',
    invalid_point_cost: '칸당 포인트는 1 이상의 정수로 입력해 주세요.',
    invalid_chat_limit: '무료 참여 한도는 1~1,000칸으로 입력해 주세요.',
    invalid_command: '명령어는 !로 시작하고 띄어쓰기가 없어야 합니다.',
    invalid_settings: '입력한 설정값을 확인해 주세요.',
    unsupported_wheel_version: '서버 업데이트가 필요합니다. 저장된 돌림판은 유지됩니다.',
    zalgo_text_not_allowed: '과도한 결합 문자가 포함된 텍스트는 사용할 수 없습니다.',
  };
  return messages[code] || (/^[가-힣]/u.test(code) ? code : '돌림판을 처리하지 못했습니다. 상태를 확인한 뒤 다시 시도해 주세요.');
}

export function createParticipationWheelRuntime({ getWheel, enterWheel, recordEvent = async () => {}, now = Date.now }) {
  const cache = new Map();
  const pending = new Map();
  const rates = createBoundedRateStore({ maxEntries: 5000, now });
  function invalidate(sid) { cache.delete(sid); }
  async function configurationFor(sid) {
    const hit = cache.get(sid);
    if (hit && now() - hit.at < 1000) return hit.value;
    if (pending.has(sid)) return pending.get(sid);
    const task = getWheel(sid).then((wheel) => {
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
      const value = { settings: wheel.settings, collecting: wheel.collecting };
      cache.set(sid, { value, at: now() });
      return value;
    }).finally(() => pending.delete(sid));
    pending.set(sid, task);
    return task;
  }
  async function record(sid, input, result) {
    if (!result.accepted || result.duplicate) return;
    await recordEvent(sid, {
      category: input.source === 'donation' ? 'donation' : 'command', eventType: 'wheel_entry', provider: input.provider,
      source: 'participation_wheel',
      viewerUserId: input.userId, viewerName: input.username,
      pointDelta: -Number(result.cost || 0), targetName: input.label,
      summary: `돌림판 참여: ${input.label} (${result.slots || input.slots || 1}칸)`,
      metadata: { source: input.source, slots: result.slots || input.slots || 1, eventId: input.eventId },
    }).catch(() => {});
  }
  async function chat(input) {
    if (!input.sid || !String(input.text || '').trim().startsWith('!')) return { handled: false };
    const { settings, collecting } = await configurationFor(input.sid);
    // Inactive wheels must not shadow existing custom commands with the default alias.
    if (collecting === false) return { handled: false };
    const parsed = parseWheelCommand(input.text, settings);
    if (!parsed) return { handled: false };
    if (rates.take(`wheel-user:${input.sid}:${input.userId}`, 6, 10000) || rates.take(`wheel-owner:${input.sid}`, 120, 1000)) {
      return { handled: true, reply: '' };
    }
    if (parsed.invalid) return { handled: true, reply: `사용법: ${parsed.command}${parsed.source === 'points' ? ' [칸 수 1~100]' : ''} 항목 (60자 이내)` };
    if (!input.userId || input.userId === 'unknown_user') return { handled: true, reply: wheelErrorMessage('invalid_identity') };
    try {
      const payload = { ...parsed, userId: input.userId, username: input.username, channelUid: input.channelUid,
        eventId: wheelEventId({ ...input, kind: 'chat', now: now() }) };
      const result = await enterWheel(input.sid, payload);
      await record(input.sid, { ...input, ...payload }, result);
      return { handled: true, reply: result.duplicate ? '' : result.accepted
        ? `${input.username}님, ${parsed.label} ${result.slots || parsed.slots}칸 추가${result.cost ? ` (${result.cost}P 사용)` : ''}.`
        : wheelErrorMessage(result.reason || 'closed') };
    } catch (error) { return { handled: true, reply: wheelErrorMessage(error) }; }
  }
  async function donation(input) {
    if (!input.sid || (input.currency && input.currency !== 'KRW')) return { accepted: false };
    const { settings, collecting } = await configurationFor(input.sid);
    if (collecting === false) return { accepted: false };
    if (!settings.donation.enabled || Number(input.amount) < settings.donation.wonPerSlot) return { accepted: false };
    const message = String(input.text || input.username || '후원').trim().replace(/\s+/gu, ' ');
    if (hasZalgoText(message)) return { accepted: false };
    const payload = { source: 'donation', userId: input.userId || 'anonymous', username: input.username || '익명',
      channelUid: input.channelUid, label: [...message].slice(0, 60).join(''), amount: input.amount,
      eventId: wheelEventId({ ...input, kind: 'donation', now: now() }) };
    const result = await enterWheel(input.sid, payload);
    await record(input.sid, { ...input, ...payload }, result);
    return result;
  }
  return { chat, donation, invalidate };
}

export function registerParticipationWheelRoutes(app, { getPartitionId, getWheel, updateWheel, actWheel, getBotRules, getBotSettings, runtime, recordEvent = async () => {}, writeMiddleware = (_req, _res, next) => next() }) {
  async function checkCommands(sid, settings) {
    const aliases = wheelCommandAliases(settings);
    if (new Set(aliases).size !== aliases.length) throw Object.assign(new Error('채팅과 포인트 명령어는 서로 달라야 합니다.'), { status: 400 });
    const rules = await getBotRules(sid);
    const bot = await getBotSettings(sid);
    const occupied = new Set([...RESERVED_COMMANDS, String(bot?.attendanceCommandKeyword || '!출석').toLowerCase(),
      ...(rules || []).filter((rule) => rule.enabled !== false).flatMap((rule) => Array.isArray(rule.keywords) ? rule.keywords : [])
        .map((keyword) => String(keyword).toLowerCase())]);
    const conflict = aliases.find((alias) => occupied.has(alias));
    if (conflict) throw Object.assign(new Error(`이미 사용 중인 명령어입니다: ${conflict}`), { status: 409 });
  }
  function route(handler) {
    return async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        const sid = await getPartitionId(req, res);
        if (!sid) return res.status(401).json({ error: '로그인이 필요합니다.' });
        const wheel = await handler(sid, req);
        return res.json({ wheel, serverNow: Date.now() });
      } catch (error) {
        const status = error.status || (['spinning', 'revision_conflict'].includes(error.code) ? 409 : error.code ? 400 : 503);
        return res.status(status).json({ error: error.status && !error.code ? error.message : wheelErrorMessage(error), code: error.code || 'wheel_unavailable' });
      }
    };
  }
  app.get('/api/wheel', route((sid) => getWheel(sid)));
  app.put('/api/wheel/settings', writeMiddleware, route(async (sid, req) => {
    const body = req.body || {};
    const settings = parseParticipationWheelSettings(body.settings, (await getWheel(sid)).settings);
    await checkCommands(sid, settings);
    const wheel = await updateWheel(sid, body.settings, body.requestId);
    runtime.invalidate(sid);
    return wheel;
  }));
  app.post('/api/wheel/action', writeMiddleware, route(async (sid, req) => {
    const { action, requestId, label, slots, username, entryId } = req.body || {};
    if (!['open', 'close', 'add', 'remove', 'clear', 'spin'].includes(action)) throw Object.assign(new Error('지원하지 않는 작업입니다.'), { status: 400 });
    if (action === 'open') await checkCommands(sid, (await getWheel(sid)).settings);
    const wheel = await actWheel(sid, { action, requestId, label, slots, username, entryId });
    runtime.invalidate(sid);
    if (action === 'spin') await recordEvent(sid, { id: `wheel-spin:${wheel.latestSpin?.id}`, category: 'roulette', eventType: 'wheel_spin', source: 'participation_wheel',
      summary: '돌림판 추첨 시작', metadata: { spinId: wheel.latestSpin?.id } }).catch(() => {});
    return wheel;
  }));
}
