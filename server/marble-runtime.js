import { wheelEventId } from './participation-wheel-runtime.js';
import { createBoundedRateStore } from './request-protection.js';
import { hasZalgoText } from '../shared/text-safety.js';
import { marbleErrorMessage } from '../shared/marble.js';

const RESERVED_COMMANDS = ['!투표', '!예측', '!출석', '!입장', '!퇴장'];
const normalized = value => String(value || '').normalize('NFKC').trim().toLowerCase();

export function marbleRuleConflict(rule, command) {
  if (rule?.enabled === false || !command) return false;
  const alias = normalized(command);
  return (Array.isArray(rule?.keywords) ? rule.keywords : []).some(keyword => {
    const key = normalized(keyword);
    return key && (alias === key || (rule.wildcard === true && alias.startsWith(key)));
  });
}

export function assertMarbleCommandAvailable(settings, { rules = [], bot = {}, wheel = null } = {}) {
  if (!settings?.points?.enabled) return;
  const command = normalized(settings.points.command);
  const occupied = [...RESERVED_COMMANDS, normalized(bot.attendanceCommandKeyword || '!출석')];
  if (wheel) {
    for (const source of ['chat', 'points']) {
      if (wheel.settings?.[source]?.enabled) occupied.push(normalized(wheel.settings[source].command));
    }
  }
  if (occupied.includes(command) || rules.some(rule => marbleRuleConflict(rule, command))) {
    throw Object.assign(new Error(`이미 사용 중인 명령어입니다: ${settings.points.command}`), { status: 409, code: 'command_conflict' });
  }
}

export function createMarbleRuntime({ store, resolveOwner, admitCommand = async () => true,
  getBotSettings = async () => ({}), recordEvent = async () => {}, now = Date.now, logger = console }) {
  const cache = new Map();
  const inFlight = new Map();
  const rates = createBoundedRateStore({ maxEntries: 5000, now });
  const invalidate = owner => {
    owner = String(owner);
    cache.delete(owner);
    inFlight.delete(owner);
  };
  async function configuration(owner) {
    owner = String(owner);
    const hit = cache.get(owner);
    if (hit && now() - hit.at < 1000) return hit.value;
    if (inFlight.has(owner)) return inFlight.get(owner);
    const request = store.configuration(owner).then(value => {
      // An invalidated in-flight read must neither repopulate the cache nor
      // authorize ingress using the old destination's command and thresholds.
      if (inFlight.get(owner) !== request) return configuration(owner);
      if (cache.size >= 1000) cache.delete(cache.keys().next().value);
      cache.set(owner, { value, at: now() });
      return value;
    }).finally(() => { if (inFlight.get(owner) === request) inFlight.delete(owner); });
    inFlight.set(owner, request);
    return request;
  }
  async function ownerFor(input) {
    if (!input.sid || !['chzzk', 'cime', 'youtube'].includes(input.provider)) return null;
    return await resolveOwner(input.sid);
  }
  async function record(input, eventId, result) {
    if (!result.accepted || result.duplicate) return;
    await recordEvent(input.sid, {
      id: `marble:${eventId}`, category: input.source === 'donation' ? 'donation' : 'command',
      eventType: 'marble_roll', provider: input.provider, source: 'marble',
      viewerUserId: input.userId, viewerName: input.username, pointDelta: result.cost ? -Number(result.cost) : 0,
      summary: result.queued ? '주루마블 후원 굴리기 예약' : '주루마블 주사위 굴리기',
      metadata: { source: input.source, queued: result.queued === true },
    }).catch(error => logger.warn('[Marble] Event log:', error?.message || error));
  }
  async function chat(input) {
    if (input.isBotSelf || !String(input.text || '').trim().startsWith('!')) return { handled: false };
    const owner = await ownerFor(input);
    if (!owner) return { handled: false };
    const config = await configuration(owner);
    if (!config?.settings?.points?.enabled || !['running', 'paused'].includes(config.status)) return { handled: false };
    const text = String(input.text || '').trim();
    const [command, ...args] = text.split(/\s+/u);
    if (normalized(command) !== normalized(config.settings.points.command)) return { handled: false };
    if (!await admitCommand(input) || rates.take(`marble:user:${owner}:${input.provider}:${input.userId}`, 4, 10000)
      || rates.take(`marble:owner:${owner}`, 120, 60000)) return { handled: true, reply: '' };
    if (args.length) return { handled: true, reply: `사용법: ${config.settings.points.command}` };
    if (!input.userId || input.userId === 'unknown_user' || !input.channelUid || hasZalgoText(input.username || '')) {
      return { handled: true, reply: '시청자 정보를 확인할 수 없습니다. 포인트는 차감되지 않았습니다.' };
    }
    const eventId = wheelEventId({ ...input, kind: 'chat', now: now() });
    try {
      const result = await store.trigger(owner, { ...input, source: 'points', command, eventId });
      await record({ ...input, source: 'points' }, eventId, result);
      return { handled: true, reply: result.duplicate ? '' : result.accepted
        ? `주루마블 주사위를 굴립니다.${result.cost ? ` (${result.cost.toLocaleString('ko-KR')}P 사용)` : ''}`
        : marbleErrorMessage(result.reason || 'busy') };
    } catch (error) { return { handled: true, reply: marbleErrorMessage(error) }; }
  }
  async function donation(input) {
    if (input.currency !== 'KRW' || !Number.isFinite(Number(input.amount)) || Number(input.amount) <= 0) return { accepted: false };
    const owner = await ownerFor(input);
    if (!owner) return { accepted: false };
    const config = await configuration(owner);
    if (!config?.settings?.donation?.enabled || !['running', 'paused'].includes(config.status)
      || Number(input.amount) < config.settings.donation.minimum) return { accepted: false };
    if ((await getBotSettings(input.sid))?.botEnabled === false) return { accepted: false };
    const eventId = wheelEventId({ ...input, kind: 'donation', now: now() });
    const result = await store.trigger(owner, { ...input, amount: Number(input.amount), source: 'donation', eventId });
    await record({ ...input, source: 'donation' }, eventId, result);
    return result;
  }
  return { chat, donation, invalidate };
}
