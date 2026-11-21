export const BROADCAST_BONUS_CATEGORIES = Object.freeze([
  { id: 'video', label: '영상 후원(무료 영도)' },
  { id: 'bgm', label: 'BGM 신청' },
  { id: 'wheel', label: '돌림판' },
  { id: 'command', label: '채팅 명령어' },
  { id: 'roulette', label: '룰렛' },
]);
export const MAX_BROADCAST_BONUS = 1_000_000_000;

export function isBroadcastBonusCategory(value) {
  return BROADCAST_BONUS_CATEGORIES.some(({ id }) => id === value);
}

export function validateBroadcastBonus(input) {
  const { amount, categories, sessionKey } = input || {};
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_BROADCAST_BONUS
      || !Array.isArray(categories) || categories.length > BROADCAST_BONUS_CATEGORIES.length
      || (amount > 0 && !categories.length) || !categories.every(isBroadcastBonusCategory)
      || typeof sessionKey !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sessionKey)) {
    throw Object.assign(new Error('현재 방송, 1인당 금액과 사용처를 확인해 주세요.'), { status: 400 });
  }
  return { amount, categories: [...new Set(categories)], sessionKey };
}
