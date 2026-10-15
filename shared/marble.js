import { hasZalgoText } from './text-safety.js';

const MAX_HISTORY = 100;
const MAX_TIMER_MS = 6 * 6 * 600 * 1000;
const DICE_MS = 1200;
const STEP_MS = 200;
const BLOCKS = ['board', 'dice', 'timer', 'card', 'roster'];
const ORIENTATIONS = ['landscape', 'portrait'];
const EFFECTS = ['message', 'timer', 'move', 'rollForward', 'rollBackward', 'goto', 'skip', 'extra', 'shield', 'shieldLoss', 'shieldClear', 'shieldDouble', 'card'];
const SETTINGS_KEYS = ['title', 'diceCount', 'participantControl', 'triggerPlayerId', 'points', 'donation', 'tiles', 'cards', 'layouts'];
const copy = value => structuredClone(value);
const own = (value, key) => Object.hasOwn(value, key);

function freeze(value) {
  for (const item of Object.values(value)) if (item && typeof item === 'object') freeze(item);
  return Object.freeze(value);
}

export const MARBLE_COLORS = Object.freeze(['#2c9c87', '#e56b73', '#5586d8', '#d4a52b', '#9367ba', '#42a2b4', '#d87742', '#648848']);
export const MARBLE_SIZES = freeze({ landscape: { width: 1920, height: 1080 }, portrait: { width: 1080, height: 1920 } });
export const MARBLE_BLOCK_GEOMETRY = freeze({ board: { width: 900, height: 900 }, dice: { width: 440, height: 210 },
  timer: { width: 440, height: 170 }, card: { width: 440, height: 350 }, roster: { width: 440, height: 340 } });

export function marbleBlockGeometry(block, orientation) {
  if (!BLOCKS.includes(block)) fail('invalid_block', '지원하지 않는 화면 블록이에요.');
  if (!ORIENTATIONS.includes(orientation)) fail('invalid_orientation', '지원하지 않는 화면 방향이에요.');
  return { ...(block === 'board' ? MARBLE_SIZES[orientation] : MARBLE_BLOCK_GEOMETRY[block]) };
}

export function marbleBoardLayout(count, orientation) {
  integer(count, 12, 40, '칸 수');
  if (count % 4) fail('invalid_board_size', '칸 수는 4의 배수여야 해요.');
  const { width, height } = marbleBlockGeometry('board', orientation);
  const inset = 12;
  const sum = count / 2 + 2;
  const columns = Math.max(3, Math.min(sum - 3, Math.round(sum * width / (width + height))));
  const rows = sum - columns;
  const cellWidth = (width - inset * 2) / columns;
  const cellHeight = (height - inset * 2) / rows;
  const slots = [];
  const addSlot = (column, row) => slots.push({ x: inset + column * cellWidth, y: inset + row * cellHeight, width: cellWidth, height: cellHeight });
  // Traverse each edge once, with corners owned by the preceding edge.
  for (let column = columns - 1; column >= 0; column--) addSlot(column, rows - 1);
  for (let row = rows - 2; row >= 0; row--) addSlot(0, row);
  for (let column = 1; column < columns; column++) addSlot(column, 0);
  for (let row = 1; row < rows - 1; row++) addSlot(columns - 1, row);
  return { width, height, columns, rows, cellWidth, cellHeight, slots,
    interior: { x: inset + cellWidth, y: inset + cellHeight, width: (columns - 2) * cellWidth, height: (rows - 2) * cellHeight } };
}

export const MARBLE_EFFECT_LABELS = Object.freeze({ message: '미션', timer: '타이머', move: '고정 칸 이동', rollForward: '주사위로 전진', rollBackward: '주사위로 후진', goto: '지정 칸 이동', skip: '쉬어가기', extra: '보너스 굴리기', shield: '방어권 획득', shieldLoss: '방어권 차감', shieldClear: '방어권 전부 회수', shieldDouble: '방어권 두 배', card: '황금 카드' });
export const MARBLE_EVENT_LABELS = Object.freeze({ reward: '보상 이벤트', penalty: '반전 이벤트', feast: '술·안주 이벤트', rule: '특별 규칙', game: '시청자 미션' });
export const MARBLE_BLOCK_LABELS = Object.freeze({ board: '보드', dice: '주사위', timer: '타이머', card: '미션 카드', roster: '참가자' });
export const MARBLE_ICON_LABELS = Object.freeze({ start: '출발', drink: '술', snack: '안주', cheers: '건배', talk: 'TMI·토크',
  speech: '말투', forbidden: '금지어', water: '물', card: '황금 카드', shield: '방어권', forward: '전진', backward: '후진',
  extra: '보너스 주사위', rest: '휴식', timer: '시간 미션', mission: '일반 미션' });

export function marbleContentIcon(item, index = -1) {
  if (item.icon && own(MARBLE_ICON_LABELS, item.icon)) return item.icon;
  if (index === 0) return 'start';
  const effects = item.effects ?? [];
  if (effects.some(effect => effect.type === 'card')) return 'card';
  if (effects.some(effect => effect.type === 'rollForward')) return 'forward';
  if (effects.some(effect => effect.type === 'rollBackward')) return 'backward';
  if (effects.some(effect => ['shield', 'shieldLoss', 'shieldClear', 'shieldDouble'].includes(effect.type))) return 'shield';
  if (effects.some(effect => effect.type === 'extra')) return 'extra';
  if (effects.some(effect => effect.type === 'goto')) return 'start';
  const move = effects.find(effect => effect.type === 'move');
  if (move) return move.value < 0 ? 'backward' : 'forward';
  const title = item.title ?? '';
  if (/금지어|외국어 금지/.test(title)) return 'forbidden';
  if (/말투|다나까|왕족|사극|~체|냥체|멍체/.test(title)) return 'speech';
  if (/안주/.test(title)) return 'snack';
  if (/건배/.test(title)) return 'cheers';
  if (/술|맥주|와인/.test(title)) return 'drink';
  if (/물\s*(한|타임)|수분/.test(title)) return 'water';
  if (/TMI|토크|이야기/i.test(title)) return 'talk';
  if (/쉼터|휴식|쉬어/.test(title) || effects.some(effect => effect.type === 'skip')) return 'rest';
  return effects.some(effect => effect.type === 'timer') ? 'timer' : 'mission';
}

const message = () => [{ type: 'message' }];
const content = (id, title, text, effects = message(), color = '#2c9c87', icon, eventKind) => ({ id, title, text, color, effects, ...(icon ? { icon } : {}), ...(eventKind ? { eventKind } : {}) });
const missionCard = (id, title, text, icon, success, failure, options = {}) => ({
  ...content(id, title, text, options.seconds ? [{ type: 'timer', value: options.seconds }] : message(), '#d4a52b', icon, 'game'),
  challenge: { rollDice: options.rollDice === true, success, failure },
});
const outcome = (text, effects = message()) => ({ text, effects });
export const DEFAULT_MARBLE_PARTICIPATION_SETTINGS = freeze({
  points: { enabled: false, command: '!주루마블', cost: 100 },
  donation: { enabled: false, minimum: 1000 },
});
export const DEFAULT_MARBLE_SETTINGS = freeze({
  title: '주루마블', diceCount: 1, participantControl: true, triggerPlayerId: null,
  ...DEFAULT_MARBLE_PARTICIPATION_SETTINGS,
  tiles: [
    content('tile-0', '출발', '내 페이스로 주루마블 시작! 술은 무알코올로 바꾸거나 미션을 패스해도 괜찮아요.', message(), '#2c9c87', 'start'),
    content('tile-1', '술 한 모금', '지금 마시는 술을 한 모금 맛봐요.', message(), '#e78940', 'drink'),
    content('tile-2', '안주 한 입', '준비한 안주를 한 입 먹고 맛을 한마디로 표현해요.', message(), '#e56b73', 'snack'),
    content('tile-3', '황금 카드', '술자리를 바꾸는 특별한 이벤트를 펼쳐요.', [{ type: 'card' }], '#d4a52b', 'card'),
    content('tile-4', 'TMI 하나', '아직 방송에서 말하지 않은 내 TMI 하나를 공개해요. 공개하기 어려운 사생활은 제외!', message(), '#42a2b4', 'talk'),
    content('tile-5', '주사위 전진', '주사위 하나를 굴려 나온 눈만큼 앞으로 이동해요. 도착한 칸의 이벤트도 진행해요.', [{ type: 'rollForward' }], '#5586d8', 'forward'),
    content('tile-6', '술 한 모금', '술을 한 모금 마시고 지금 맛이나 향을 말해요.', message(), '#e78940', 'drink'),
    content('tile-7', '냠냠 안주', '안주 한 입! 오늘 준비한 안주 중 최애를 골라요.', message(), '#e56b73', 'snack'),
    content('tile-8', '물 한 모금', '물 한 모금을 마시고 30초 쉬어 가요.', [{ type: 'timer', value: 30 }], '#42a2b4', 'water'),
    content('tile-9', '황금 카드', '술·안주와 함께 방어권과 이동을 바꾸는 특별 이벤트를 펼쳐요.', [{ type: 'card' }], '#d4a52b', 'card'),
    content('tile-10', '냥체/멍체 2분', '시작할 때 냥체 또는 멍체 하나를 골라요. 2분 동안 모든 문장 끝에 “냥” 또는 “멍”을 붙여 채팅과 대화해요.', [{ type: 'timer', value: 120 }], '#9367ba', 'speech'),
    content('tile-11', '보너스 주사위', '한 번 더 굴리기를 누르면 주사위를 다시 굴려요.', [{ type: 'extra' }], '#e56b73', 'extra'),
    content('tile-12', '안주 타임', '안주를 한 입 먹으며 오늘 있었던 소소한 일을 하나 이야기해요.', message(), '#e56b73', 'snack'),
    content('tile-13', '랜선 건배', '시청자와 “건배!”를 외치고 술 한 모금. 잔을 화면에 보여 줄 필요는 없어요.', message(), '#e78940', 'cheers'),
    content('tile-14', '주사위 후진', '주사위 하나를 굴려 나온 눈만큼 뒤로 이동해요. 도착한 칸의 이벤트도 진행해요.', [{ type: 'rollBackward' }], '#5586d8', 'backward'),
    content('tile-15', '황금 카드', '술자리를 바꾸는 특별한 이벤트를 펼쳐요.', [{ type: 'card' }], '#d4a52b', 'card'),
    content('tile-16', '술 한 모금', '내 속도로 술 한 모금. 오늘 술자리 분위기를 한 단어로 말해요.', message(), '#e78940', 'drink'),
    content('tile-17', '방어권 획득', '원하는 미션을 건너뛸 수 있는 방어권 한 장을 받아요.', [{ type: 'shield' }], '#2c9c87', 'shield'),
    content('tile-18', '안주 쉬는 시간', '1분 동안 술은 쉬고 안주를 내 속도로 즐겨요. 급하게 먹을 필요는 없어요.', [{ type: 'timer', value: 60 }], '#e56b73', 'snack'),
    content('tile-19', '외국어 금지 3분', '3분 동안 외국어와 외래어 없이 이야기해요. “오케이”, “리액션”, “타이머”도 금지! 사람 이름과 닉네임은 제외하고, 어겼다면 끝나고 TMI 하나를 공개해요. 판정은 스트리머가 해요.', [{ type: 'timer', value: 180 }], '#9367ba', 'forbidden'),
    content('tile-20', '출발로 이동', '진행 방향을 따라 출발 칸까지 이동해요.', [{ type: 'goto', value: 0 }], '#5586d8', 'start'),
    content('tile-21', '황금 카드', '술·안주와 함께 방어권과 이동을 바꾸는 특별 이벤트를 펼쳐요.', [{ type: 'card' }], '#d4a52b', 'card'),
    content('tile-22', '안주 한 입', '안주를 한 입 먹고 지금 술과의 궁합을 5점 만점으로 말해요.', message(), '#e56b73', 'snack'),
    content('tile-23', '건배 한 모금', '오늘 자신에게 해 주고 싶은 한마디와 함께 건배, 술 한 모금!', message(), '#e78940', 'cheers'),
  ],
  cards: [
    missionCard('card-1', '너에게만 애교', '시청자에게 애교 섞인 한 문장을 말해요. 손동작 없이 목소리만으로! 끝까지 말하면 성공이에요.', 'speech',
      outcome('애교 전달 성공! 방어권 1장을 받아요.', [{ type: 'shield' }]), outcome('귀여운 목소리로 “다음에는 꼭 성공할게요!”를 한 번 말해요.')),
    missionCard('card-2', '오늘의 명대사', '채팅에서 추천한 대사 한 문장을 골라 끝까지 연기해요. 불편하거나 개인정보가 담긴 대사는 제외해요.', 'talk',
      outcome('명대사 완성! 방어권 1장을 받아요.', [{ type: 'shield' }]), outcome('오늘 있었던 소소한 TMI 하나를 공개해요.')),
    missionCard('card-3', '주사위 건배', '미션 주사위를 굴리고 {dice}눈만큼 작은 모금으로 건배해요. 물·무알코올로 바꿔도 성공! 속도 제한 없이 부담되면 패스해요.', 'cheers',
      outcome('내 페이스로 건배 완료! 방어권 2장을 받아요.', [{ type: 'shield', value: 2 }]), outcome('방어권 1장을 반납해요. 없으면 차감 없이 종료하며 추가로 마시지 않아요.', [{ type: 'shieldLoss', value: 1 }]), { rollDice: true }),
    missionCard('card-4', '진지한 한 문장', '“저는 지금 아주 진지합니다.”를 웃지 않고 세 번 말해요. 중간에 웃으면 실패예요.', 'speech',
      outcome('진지함 인정! 방어권 1장을 받아요.', [{ type: 'shield' }]), outcome('가장 장난스러운 목소리로 같은 대사를 한 번 더 말해요.')),
    missionCard('card-5', '칭찬 배달', '시청자 전체에게 서로 다른 칭찬 세 가지를 말해요. 닉네임을 지목하지 않아도 괜찮아요.', 'talk',
      outcome('칭찬 배달 완료! 방어권 1장과 안주 한 입의 여유를 얻어요.', [{ type: 'shield' }]), outcome('나 자신을 칭찬하는 한 문장을 당당하게 말해요.')),
    missionCard('card-6', '냥체 집중 시간', '1분 동안 모든 문장 끝에 “냥”을 붙여 채팅과 대화해요. 한 번도 빠뜨리지 않으면 성공이에요.', 'speech',
      outcome('끝까지 냥체 성공! 방어권 2장을 받아요.', [{ type: 'shield', value: 2 }]), outcome('30초 동안 문장 끝에 “멍”을 붙여 말해요.', [{ type: 'timer', value: 30 }]), { seconds: 60 }),
    missionCard('card-7', '안주 맛 표현왕', '안주를 한 입 맛보고 “맛있다” 없이 맛을 서로 다른 표현 두 가지로 설명해요. 안주가 없으면 좋아하는 음식으로 대신해요.', 'snack',
      outcome('맛 표현 성공! 보너스 주사위를 한 번 굴려요.', [{ type: 'extra' }]), outcome('방어권 1장을 반납해요. 보유량이 없으면 차감 없이 마쳐요.', [{ type: 'shieldLoss', value: 1 }])),
    missionCard('card-8', '목소리 세 가지', '같은 인사 한 문장을 평소 목소리, 속삭이는 목소리, 씩씩한 목소리로 한 번씩 말해요. 세 가지를 구별하면 성공!', 'speech',
      outcome('목소리 변신 성공! 방어권 1장을 받아요.', [{ type: 'shield' }]), outcome('시청자가 고른 한 가지 목소리로 인사를 한 번 더 해요.')),
    missionCard('card-9', '추억 한 조각', '30초 안에 방송하면서 즐거웠던 순간 하나를 떠올려 이야기해요. 사생활이나 다른 사람의 비밀은 제외해요.', 'talk',
      outcome('좋은 추억 공유 완료! 방어권 1장을 받아요.', [{ type: 'shield' }]), outcome('다음 방송에서 해 보고 싶은 일을 한 가지 말해요.'), { seconds: 30 }),
    missionCard('card-10', '주사위 칭찬 릴레이', '미션 주사위를 굴려 나온 {dice}눈만큼 짧은 칭찬을 시청자에게 전해요. 표현을 반복하지 않으면 성공이에요.', 'extra',
      outcome('칭찬 릴레이 성공! 방어권 2장을 받아요.', [{ type: 'shield', value: 2 }]), outcome('30초 동안 문장 끝에 “최고예요”를 붙여 말해요.', [{ type: 'timer', value: 30 }]), { rollDice: true }),
    missionCard('card-11', '오글 대사 도전', '“오늘도 와 줘서 고마워. 기다리고 있었어.”를 끊지 않고 한 문장으로 말해요. 쑥스러워도 끝까지 말하면 성공!', 'talk',
      outcome('대사 완주! 방어권 1장을 받아요.', [{ type: 'shield' }]), outcome('시청자에게 귀여운 목소리로 고맙다는 인사를 한 번 해요.')),
    missionCard('card-12', '오늘의 TMI', '30초 안에 오늘의 사소한 TMI 하나를 이야기해요. 먹은 음식이나 작은 실수도 좋아요. 개인정보나 다른 사람의 비밀은 제외해요.', 'mission',
      outcome('TMI 공개 완료! 방어권 1장과 보너스 굴리기를 받아요.', [{ type: 'shield' }, { type: 'extra' }]), outcome('다음 미션의 성공을 응원하는 짧은 구호를 한 번 외쳐요.'), { seconds: 30 }),
  ],
  layouts: {
    landscape: {
      board: { x: 0, y: 0, width: 100, visible: true }, dice: { x: 68, y: 23, width: 20, visible: true },
      timer: { x: 72, y: 41, width: 14, visible: true }, card: { x: 71, y: 52, width: 17, visible: true },
      roster: { x: 13, y: 25, width: 12, visible: true },
    },
    portrait: {
      board: { x: 0, y: 0, width: 100, visible: true }, dice: { x: 23, y: 14, width: 54, visible: true },
      timer: { x: 51, y: 31, width: 26, visible: true }, card: { x: 23, y: 63, width: 54, visible: true },
      roster: { x: 50, y: 25, width: 28, visible: false },
    },
  },
});

export class MarbleError extends Error {
  constructor(code, message = '주루마블 요청을 확인해 주세요.', status = 400) {
    super(message);
    this.name = 'MarbleError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status) { throw new MarbleError(code, message, status); }
function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid_input', `${label}: 객체가 필요해요.`);
  if (Object.getOwnPropertySymbols(value).length || Object.keys(value).some(key => !keys.includes(key))) fail('unknown_field', `${label}: 지원하지 않는 항목이에요.`);
  return value;
}
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('invalid_number', `${label}: ${min}~${max} 사이의 정수가 필요해요.`);
  return value;
}
function number(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail('invalid_number', `${label}: 숫자 범위를 확인해 주세요.`);
  return value;
}
function boolean(value, label) {
  if (typeof value !== 'boolean') fail('invalid_boolean', `${label}: 켜기 또는 끄기를 선택해 주세요.`);
  return value;
}
function text(value, max, label, empty = false, multiline = false) {
  if (typeof value !== 'string' || value.length > max * 2) fail('invalid_text', `${label}: 글자 수를 확인해 주세요.`);
  if (hasZalgoText(value)) fail('zalgo_text_not_allowed', '겹쳐 쓴 장식 문자는 사용할 수 없어요.');
  if ((multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u : /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u).test(value)) fail('invalid_text', `${label}: 제어 문자는 사용할 수 없어요.`);
  const result = value.trim();
  if ((!empty && !result) || [...result].length > max) fail('invalid_text', `${label}: 글자 수를 확인해 주세요.`);
  return result;
}
function id(value, label = 'ID') {
  const result = text(value, 160, label);
  if (!/^[a-zA-Z0-9_.:~-]+$/.test(result) || ['__proto__', 'prototype', 'constructor'].includes(result)) fail('invalid_id', `${label}: 올바른 ID가 필요해요.`);
  return result;
}
function color(value) {
  if (typeof value !== 'string' || value.length !== 7 || !/^#[a-f\d]{6}$/i.test(value)) fail('invalid_color', '색상은 #RRGGBB 형식이어야 해요.');
  return value.toLowerCase();
}
function avatar(value) {
  if (value === null) return null;
  const result = text(value, 2048, '프로필 사진');
  let parsed;
  try { parsed = new URL(result); } catch { fail('invalid_avatar', '올바른 HTTPS 프로필 사진 주소가 필요해요.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !parsed.hostname) fail('invalid_avatar', '프로필 사진은 HTTPS 주소만 사용할 수 있어요.');
  return parsed.href;
}
function array(value, min, max, label) {
  if (!Array.isArray(value) || value.length < min || value.length > max ||
      Array.from({ length: value.length }, (_, index) => index).some(index => !own(value, index))) fail('invalid_list', `${label}: 개수를 확인해 주세요.`);
  return value;
}
function parseEffect(value, count, card) {
  object(value, ['type', 'value', 'text'], '효과');
  if (!EFFECTS.includes(value.type)) fail('invalid_effect', '지원하지 않는 효과예요.');
  if (card && value.type === 'card') fail('nested_card', '황금 카드 안에서 카드를 다시 뽑을 수 없어요.');
  const result = { type: value.type };
  const bounds = { timer: [5, 600], move: [-12, 12], goto: [0, count - 1], skip: [1, 3], shieldLoss: [1, 99], ...(own(value, 'value') ? { shield: [1, 99] } : {}) }[value.type];
  if (bounds) result.value = integer(value.value, ...bounds, '효과 값');
  else if (own(value, 'value')) fail('invalid_effect', '이 효과에는 숫자 값이 필요하지 않아요.');
  if (own(value, 'text')) result.text = text(value.text, 500, '효과 설명', true, true);
  return result;
}
function validateFollowupEffects(effects) {
  const movement = effects.filter(effect => effect.type === 'rollForward' || effect.type === 'rollBackward');
  if (movement.length > 1 || movement.length && effects.some(effect => effect.type === 'extra')) {
    fail('conflicting_roll_effects', '주사위 전진·후진과 보너스 굴리기는 한 이벤트에 하나만 설정해 주세요.');
  }
}
function parseChallenge(value, count) {
  object(value, ['rollDice', 'success', 'failure'], '황금 카드 미션');
  const result = { rollDice: boolean(value.rollDice, '미션 주사위') };
  for (const key of ['success', 'failure']) {
    const branch = object(value[key], ['text', 'effects'], '판정 결과');
    const effects = array(branch.effects, 0, 6, '결과 효과').map(effect => parseEffect(effect, count, true));
    if (effects.some(effect => ['move', 'goto', 'skip'].includes(effect.type))) fail('invalid_challenge_effect', '결과 이동은 주사위 전진·후진 효과를 사용해 주세요.');
    validateFollowupEffects(effects);
    result[key] = { text: text(branch.text, 1000, '결과 설명', false, true), effects };
  }
  return result;
}
function parseContents(value, count, cards) {
  const seen = new Set();
  return array(value, cards ? 1 : 12, cards ? 60 : 40, cards ? '카드' : '칸').map(item => {
    object(item, ['id', 'title', 'text', 'color', 'effects', 'icon', 'eventKind', 'challenge'], '칸 또는 카드');
    const key = id(item.id);
    if (seen.has(key)) fail('duplicate_id', '칸 또는 카드 ID가 중복되었어요.');
    seen.add(key);
    if (own(item, 'icon') && (typeof item.icon !== 'string' || !own(MARBLE_ICON_LABELS, item.icon))) fail('invalid_icon', '지원하지 않는 아이콘이에요.');
    if (own(item, 'eventKind') && (!cards || typeof item.eventKind !== 'string' || !own(MARBLE_EVENT_LABELS, item.eventKind))) fail('invalid_event_kind', '황금 카드의 이벤트 종류를 확인해 주세요.');
    const effects = array(item.effects, 0, 6, '효과').map(effect => parseEffect(effect, count, cards));
    const challenge = own(item, 'challenge') ? parseChallenge(item.challenge, count) : null;
    if (challenge && (!cards || effects.some(effect => !['message', 'timer'].includes(effect.type)))) {
      fail('invalid_challenge_effect', '판정 전에는 메시지·타이머만 사용하고 보상·벌칙은 결과에 설정해 주세요.');
    }
    validateFollowupEffects(effects);
    return { id: key, title: text(item.title, 60, '제목'), text: text(item.text, 1000, '본문', true, true), color: color(item.color),
      ...(own(item, 'icon') ? { icon: item.icon } : {}),
      ...(own(item, 'eventKind') ? { eventKind: item.eventKind } : {}),
      ...(challenge ? { challenge } : {}),
      effects };
  });
}
function parseLayouts(input, base) {
  object(input, ORIENTATIONS, '배치');
  const result = {};
  for (const orientation of ORIENTATIONS) {
    const patch = own(input, orientation) ? object(input[orientation], BLOCKS, '화면 방향') : {};
    result[orientation] = {};
    for (const block of BLOCKS) {
      const item = own(patch, block) ? object(patch[block], ['x', 'y', 'width', 'visible'], '블록 배치') : {};
      const merged = { ...base[orientation][block], ...item };
      const canvas = MARBLE_SIZES[orientation];
      const geometry = marbleBlockGeometry(block, orientation);
      const aspect = geometry.width / geometry.height;
      const width = Math.min(number(merged.width, 8, 100, '너비'), 100 * aspect * canvas.height / canvas.width);
      const height = width * canvas.width / canvas.height / aspect;
      result[orientation][block] = { x: Math.min(number(merged.x, 0, 100, '가로 위치'), 100 - width),
        y: Math.min(number(merged.y, 0, 100, '세로 위치'), 100 - height), width, visible: boolean(merged.visible, '표시') };
    }
  }
  return result;
}

export function parseMarbleParticipationSettings(input, base = DEFAULT_MARBLE_PARTICIPATION_SETTINGS) {
  object(input, ['points', 'donation'], '시청자 참여 설정');
  object(base, ['points', 'donation'], '기존 시청자 참여 설정');
  const pointsPatch = own(input, 'points') ? object(input.points, ['enabled', 'command', 'cost'], '포인트') : {};
  const donationPatch = own(input, 'donation') ? object(input.donation, ['enabled', 'minimum'], '후원') : {};
  const points = { ...base.points, ...pointsPatch };
  const donation = { ...base.donation, ...donationPatch };
  object(points, ['enabled', 'command', 'cost'], '포인트');
  object(donation, ['enabled', 'minimum'], '후원');
  const command = text(points.command, 40, '명령어');
  if (!/^![^\s!\p{C}]{1,39}$/u.test(command)) fail('invalid_command', '명령어는 !로 시작하는 한 단어여야 해요.');
  return {
    points: { enabled: boolean(points.enabled, '포인트 사용'), command, cost: integer(points.cost, 1, 1000000000, '포인트 가격') },
    donation: { enabled: boolean(donation.enabled, '후원 사용'), minimum: integer(donation.minimum, 1, 1000000000, '최소 후원 금액') },
  };
}

export function parseMarbleSettings(input, base = DEFAULT_MARBLE_SETTINGS) {
  object(input, SETTINGS_KEYS, '설정');
  object(base, SETTINGS_KEYS, '기존 설정');
  const merged = { ...DEFAULT_MARBLE_SETTINGS, ...base, ...input };
  const participation = parseMarbleParticipationSettings({
    ...(own(input, 'points') ? { points: input.points } : {}),
    ...(own(input, 'donation') ? { donation: input.donation } : {}),
  }, { points: base.points, donation: base.donation });
  const tiles = array(merged.tiles, 12, 40, '칸');
  if (tiles.length % 4 !== 0) fail('invalid_board_size', '칸 수는 12~40 사이의 4의 배수여야 해요.');
  const parsedTiles = parseContents(tiles, tiles.length, false);
  const parsedCards = parseContents(merged.cards, tiles.length, true);
  for (const tile of parsedTiles) {
    const draws = tile.effects.filter(effect => effect.type === 'card').length;
    if (!draws) continue;
    if (parsedCards.some(card => card.challenge) && (draws !== 1 || tile.effects.some(effect => !['card', 'message', 'timer'].includes(effect.type)))) {
      fail('conflicting_challenge_effects', '미션 카드 칸에는 카드 한 장과 메시지·타이머만 함께 설정할 수 있어요.');
    }
    for (const card of parsedCards) validateFollowupEffects([...tile.effects, ...Array.from({ length: draws }, () => card.effects).flat()]);
  }
  return {
    title: text(merged.title, 60, '제목'), diceCount: integer(merged.diceCount, 1, 2, '주사위 수'),
    participantControl: boolean(merged.participantControl, '참가자 조작'),
    triggerPlayerId: merged.triggerPlayerId === null ? null : id(merged.triggerPlayerId, '참여 대상'),
    ...participation,
    tiles: parsedTiles, cards: parsedCards,
    layouts: parseLayouts(own(input, 'layouts') ? input.layouts : {}, base.layouts),
  };
}

function freshPlayerState() { return { phase: 'ready', lastRoll: null, pending: null, timer: null, donationQueue: [] }; }
function focus(state, playerId = state.currentPlayerId) {
  state.currentPlayerId = state.players.some(player => player.id === playerId) ? playerId : state.players[0]?.id ?? null;
  Object.assign(state, copy(state.playerStates[state.currentPlayerId] ?? freshPlayerState()));
}
export function createMarbleState() {
  const player = { id: 'player-1', name: '플레이어', color: MARBLE_COLORS[0], userId: null, avatarUrl: null, position: 0, laps: 0, skipTurns: 0, shields: 0 };
  return { version: 1, revision: 0, gameId: null, settings: parseMarbleSettings({}), players: [player],
    playerStates: { [player.id]: freshPlayerState() }, status: 'lobby', currentPlayerId: player.id, round: 0,
    ...freshPlayerState(), pausedAt: null, history: [], deck: [] };
}

function requireStatus(state, statuses) {
  if (!statuses.includes(state.status)) fail('invalid_status', '현재 게임 상태에서는 실행할 수 없어요.', 409);
}
function target(state, input, external = false) {
  const playerId = input.playerId ?? (external ? state.settings.triggerPlayerId ?? state.players[0]?.id : state.currentPlayerId ?? state.players[0]?.id);
  const player = state.players.find(item => item.id === playerId);
  if (!player) fail('player_not_found', '참가자를 찾을 수 없어요.', 404);
  return player;
}
function readyEffect(state, player, now) {
  requireStatus(state, ['running']);
  const ps = state.playerStates[player.id];
  if (ps.phase !== 'effect' || !ps.pending) fail('no_pending_mission', '진행 중인 미션이 없어요.', 409);
  if (now < ps.pending.readyAt) fail('animation_in_progress', '주사위와 말 이동이 끝난 뒤 진행해 주세요.', 409);
  if (ps.pending.challenge?.roll && now < ps.pending.challenge.roll.endsAt) fail('animation_in_progress', '미션 주사위가 멈춘 뒤 진행해 주세요.', 409);
  return ps;
}
function generatedId(context) { return id(context.uuid(), '생성 ID'); }
function log(state, context, message, playerId) {
  const entry = { id: generatedId(context), at: context.now, text: message };
  if (playerId) entry.playerId = playerId;
  state.history.push(entry);
  state.history = state.history.slice(-MAX_HISTORY);
}
function random(context, max) {
  const value = context.randomInt(max);
  if (!Number.isInteger(value) || value < 0 || value >= max) fail('invalid_random', '서버 난수 결과가 올바르지 않아요.', 500);
  return value;
}
function drawCard(state, context) {
  if (!state.deck.length) {
    state.deck = state.settings.cards.map(card => card.id);
    for (let i = state.deck.length - 1; i > 0; i--) {
      const j = random(context, i + 1);
      [state.deck[i], state.deck[j]] = [state.deck[j], state.deck[i]];
    }
  }
  const cardId = state.deck.shift();
  const card = state.settings.cards.find(item => item.id === cardId);
  if (!card) fail('invalid_deck', '카드 목록을 다시 설정해 주세요.', 409);
  return card;
}
function move(player, distance, count, path) {
  const direction = Math.sign(distance);
  for (let step = 0; step < Math.abs(distance); step++) {
    player.position = (player.position + direction + count) % count;
    if (direction > 0 && player.position === 0) player.laps++;
    path.push(player.position);
  }
}
export function marbleNextRoll(pending) {
  if (pending?.challenge && !pending.challenge.outcome) return null;
  if (pending?.effects.some(effect => effect.type === 'rollForward')) return 'forward';
  if (pending?.effects.some(effect => effect.type === 'rollBackward')) return 'backward';
  return pending?.extraTurn ? 'bonus' : null;
}

export function marbleChallengeText(value, challenge) {
  return String(value ?? '').replaceAll('{dice}', challenge?.roll ? String(challenge.roll.dice[0]) : '?');
}

function applyEffects(state, player, effects, path = []) {
  let durationMs = 0;
  let extraTurn = false;
  const shieldsBefore = player.shields;
  const changesShields = effects.some(effect => ['shield', 'shieldLoss', 'shieldClear', 'shieldDouble'].includes(effect.type));
  for (const effect of effects) {
    switch (effect.type) {
      case 'message': case 'rollForward': case 'rollBackward': break;
      case 'timer': durationMs += effect.value * 1000; break;
      case 'move': move(player, effect.value, state.settings.tiles.length, path); break;
      case 'goto': move(player, (effect.value - player.position + state.settings.tiles.length) % state.settings.tiles.length, state.settings.tiles.length, path); break;
      case 'skip': player.skipTurns = Math.min(18, player.skipTurns + effect.value); break;
      case 'extra': extraTurn = true; break;
      case 'shield': player.shields = Math.min(99, player.shields + (effect.value ?? 1)); break;
      case 'shieldLoss': player.shields = Math.max(0, player.shields - effect.value); break;
      case 'shieldClear': player.shields = 0; break;
      case 'shieldDouble': player.shields = Math.min(99, player.shields * 2); break;
      default: fail('invalid_effect', '지원하지 않는 효과예요.');
    }
  }
  return { durationMs, extraTurn, shieldsBefore, changesShields };
}

function roll(state, player, context, source = 'host', username, direction) {
  requireStatus(state, ['running']);
  const ps = state.playerStates[player.id];
  if (ps.phase !== 'ready') fail('player_busy', '이 참가자의 미션을 먼저 마쳐 주세요.', 409);
  const from = player.position;
  const dice = Array.from({ length: direction ? 1 : state.settings.diceCount }, () => random(context, 6) + 1);
  const path = [];
  move(player, dice.reduce((sum, die) => sum + die, 0) * (direction ?? 1), state.settings.tiles.length, path);
  const tile = state.settings.tiles[player.position];
  const resolved = [];
  const descriptions = [tile.text];
  const titles = [tile.title];
  let cardId, challenge, missionColor = tile.color;
  // Only the dice landing tile triggers. Cards expand once; their schema forbids card effects.
  for (const effect of tile.effects) {
    if (effect.type !== 'card') { resolved.push(copy(effect)); continue; }
    const card = drawCard(state, context);
    cardId = card.id;
    missionColor = card.color;
    if (card.challenge) challenge = { ...copy(card.challenge), missionText: card.text };
    titles.push(card.title);
    descriptions.push(card.text);
    if (effect.text) descriptions.push(effect.text);
    resolved.push(...copy(card.effects));
  }
  for (const effect of resolved) if (effect.text && !descriptions.includes(effect.text)) descriptions.push(effect.text);
  const { durationMs, extraTurn, shieldsBefore, changesShields } = applyEffects(state, player, resolved, path);
  const endsAt = context.now + DICE_MS + path.length * STEP_MS;
  ps.lastRoll = { id: generatedId(context), playerId: player.id, dice, from, to: player.position, path,
    startedAt: context.now, diceDurationMs: DICE_MS, stepDurationMs: STEP_MS, endsAt, source };
  if (direction) ps.lastRoll.direction = direction;
  if (username !== undefined) ps.lastRoll.username = username;
  ps.pending = { title: titles.join(' · '), text: descriptions.filter(Boolean).join('\n'), color: missionColor,
    tileId: tile.id, effects: resolved, readyAt: endsAt, extraTurn };
  if (cardId) ps.pending.cardId = cardId;
  if (challenge) {
    ps.pending.challenge = challenge;
    ps.pending.title = titles.slice(1).join(' · ');
    ps.pending.text = [challenge.missionText, ...resolved.map(effect => effect.text)].filter(Boolean).join('\n');
    challenge.missionText = ps.pending.text;
  }
  if (changesShields) ps.pending.shieldDelta = player.shields - shieldsBefore;
  ps.timer = durationMs ? { durationMs, deadline: endsAt + durationMs, remainingMs: durationMs, paused: false } : null;
  if (challenge?.rollDice && ps.timer) { ps.timer.deadline = null; ps.timer.paused = true; }
  ps.phase = 'effect';
  state.round++;
  log(state, context, `${player.name}: ${direction ? direction < 0 ? '후진 ' : '전진 ' : ''}${dice.join(' + ')} → ${tile.title}`, player.id);
  if (changesShields) log(state, context, `${player.name}: 방어권 ${shieldsBefore} → ${player.shields}장`, player.id);
  focus(state, player.id);
}
function consumeDonation(state, player, context) {
  const ps = state.playerStates[player.id];
  if (state.status !== 'running' || ps.phase !== 'ready' || !ps.donationQueue.length) return;
  const donation = ps.donationQueue.shift();
  roll(state, player, context, 'donation', donation.username);
}
function resetProgress(state, context, status) {
  state.gameId = generatedId(context);
  state.status = status;
  state.round = 0;
  state.pausedAt = null;
  state.deck = [];
  state.playerStates = {};
  for (const player of state.players) {
    Object.assign(player, { position: 0, laps: 0, skipTurns: 0, shields: 0 });
    state.playerStates[player.id] = freshPlayerState();
  }
  focus(state, state.players[0]?.id);
}

const ACTION_FIELDS = {
  'add-player': ['name', 'color', 'userId', 'avatarUrl'], 'remove-player': [], 'leave-player': [], 'update-player': ['name', 'color', 'userId', 'avatarUrl'],
  start: [], end: [], reset: [], pause: [], resume: [], focus: [],
  roll: ['source', 'username', 'expectedRollId'], complete: ['expectedRollId'], pass: ['useShield', 'expectedRollId'],
  'challenge-roll': ['expectedRollId'], 'challenge-result': ['expectedRollId', 'outcome'],
  'timer-pause': [], 'timer-resume': [], 'timer-add': ['seconds'], 'timer-finish': [],
  settings: ['settings'], layout: ['layouts'], 'enqueue-donation': ['donation'],
};

export function applyMarbleAction(state, input, context) {
  if (!input || typeof input.action !== 'string' || !own(ACTION_FIELDS, input.action)) fail('unknown_action', '지원하지 않는 동작이에요.');
  object(input, ['action', 'requestId', 'revision', 'playerId', ...ACTION_FIELDS[input.action]], '동작');
  if (own(input, 'requestId')) id(input.requestId, '요청 ID');
  if (own(input, 'playerId')) id(input.playerId, '참가자 ID');
  if (!context || typeof context.randomInt !== 'function' || typeof context.uuid !== 'function') fail('invalid_context', '서버 실행 정보가 필요해요.', 500);
  integer(context.now, 0, Number.MAX_SAFE_INTEGER - MAX_TIMER_MS * 2, '서버 시간');
  if (!state || state.version !== 1 || !state.playerStates || !Array.isArray(state.players) || state.players.length > 8) fail('invalid_state', '게임 상태를 확인해 주세요.', 409);
  integer(state.revision, 0, Number.MAX_SAFE_INTEGER - 1, '상태 버전');
  if (own(input, 'revision') && integer(input.revision, 0, Number.MAX_SAFE_INTEGER, '요청 버전') !== state.revision) fail('revision_conflict', '게임 상태가 변경되었어요. 새로고침 후 다시 시도해 주세요.', 409);
  const next = copy(state);
  if (own(input, 'expectedRollId')) {
    if (input.expectedRollId !== null) id(input.expectedRollId, '예상 굴리기 ID');
    const external = input.action === 'roll' && ['points', 'donation', 'chat'].includes(input.source);
    const player = target(next, input, external);
    if ((next.playerStates[player.id].lastRoll?.id ?? null) !== input.expectedRollId) fail('stale_roll', '이 참가자의 굴리기 상태가 변경되었어요.', 409);
  }
  switch (input.action) {
    case 'focus': focus(next, target(next, input).id); break;
    case 'add-player': {
      requireStatus(next, ['lobby', 'finished']);
      if (next.players.length >= 8) fail('player_limit', '참가자는 최대 8명이에요.', 409);
      const player = { id: generatedId(context), name: text(input.name, 40, '이름'), color: own(input, 'color') ? color(input.color) : MARBLE_COLORS[next.players.length],
        userId: own(input, 'userId') && input.userId !== null ? id(input.userId, '계정 ID') : null,
        avatarUrl: own(input, 'avatarUrl') ? avatar(input.avatarUrl) : null, position: 0, laps: 0, skipTurns: 0, shields: 0 };
      if (next.players.some(item => item.id === player.id || (player.userId && item.userId === player.userId))) fail('duplicate_player', '이미 참가한 계정 또는 ID예요.', 409);
      next.players.push(player);
      next.playerStates[player.id] = freshPlayerState();
      break;
    }
    case 'leave-player':
    case 'remove-player': {
      if (input.action === 'remove-player') requireStatus(next, ['lobby', 'finished']);
      const player = target(next, input);
      if (input.action === 'leave-player') {
        const discarded = next.playerStates[player.id].donationQueue.length;
        log(next, context, `${player.name} 님이 참여를 종료했어요.${discarded ? ` 남은 후원 예약 ${discarded}개를 비웠어요.` : ''}`);
      }
      next.players = next.players.filter(item => item.id !== player.id);
      delete next.playerStates[player.id];
      if (next.settings.triggerPlayerId === player.id) next.settings.triggerPlayerId = null;
      if (!next.players.length && ['running', 'paused'].includes(next.status)) {
        next.status = 'finished'; next.pausedAt = null; next.deck = [];
      }
      break;
    }
    case 'update-player': {
      requireStatus(next, ['lobby', 'finished']);
      const player = target(next, input);
      if (own(input, 'name')) player.name = text(input.name, 40, '이름');
      if (own(input, 'color')) player.color = color(input.color);
      if (own(input, 'avatarUrl')) player.avatarUrl = avatar(input.avatarUrl);
      if (own(input, 'userId')) {
        const userId = input.userId === null ? null : id(input.userId, '계정 ID');
        if (userId && next.players.some(item => item.id !== player.id && item.userId === userId)) fail('duplicate_player', '이미 참가한 계정이에요.', 409);
        player.userId = userId;
      }
      break;
    }
    case 'start':
      requireStatus(next, ['lobby', 'finished']);
      if (!next.players.length) fail('no_players', '참가자가 한 명 이상 필요해요.', 409);
      resetProgress(next, context, 'running');
      log(next, context, '게임을 시작했어요. 각자 원하는 때에 굴릴 수 있어요.');
      break;
    case 'reset':
      resetProgress(next, context, 'lobby');
      log(next, context, '게임 진행을 초기화했어요.');
      break;
    case 'end': {
      requireStatus(next, ['running', 'paused']);
      const discarded = Object.values(next.playerStates).reduce((sum, ps) => sum + ps.donationQueue.length, 0);
      next.status = 'finished'; next.pausedAt = null; next.deck = [];
      for (const player of next.players) {
        next.playerStates[player.id] = freshPlayerState();
        player.skipTurns = 0;
      }
      log(next, context, `게임을 종료했어요.${discarded ? ` 남은 후원 예약 ${discarded}개를 비웠어요.` : ''}`);
      break;
    }
    case 'pause':
      requireStatus(next, ['running']);
      next.status = 'paused'; next.pausedAt = context.now;
      log(next, context, '게임을 일시정지했어요.');
      break;
    case 'resume': {
      requireStatus(next, ['paused']);
      const delta = context.now - next.pausedAt;
      if (delta < 0) fail('invalid_time', '재개 시각이 정지 시각보다 빠를 수 없어요.');
      for (const ps of Object.values(next.playerStates)) {
        if (ps.lastRoll) { ps.lastRoll.startedAt += delta; ps.lastRoll.endsAt += delta; }
        if (ps.pending) ps.pending.readyAt += delta;
        if (ps.pending?.challenge?.roll) { ps.pending.challenge.roll.startedAt += delta; ps.pending.challenge.roll.endsAt += delta; }
        if (ps.pending?.challenge?.resolvedAt != null) ps.pending.challenge.resolvedAt += delta;
        if (ps.timer && ps.timer.deadline !== null) ps.timer.deadline += delta;
      }
      next.status = 'running'; next.pausedAt = null;
      log(next, context, '게임을 다시 진행해요.');
      for (const player of next.players) consumeDonation(next, player, context);
      break;
    }
    case 'roll': {
      const source = own(input, 'source') ? text(input.source, 32, '굴리기 출처') : 'host';
      const player = target(next, input, source === 'points' || source === 'donation' || source === 'chat');
      roll(next, player, context, source, own(input, 'username') ? text(input.username, 80, '요청자') : undefined);
      break;
    }
    case 'challenge-roll': {
      const player = target(next, input);
      const ps = readyEffect(next, player, context.now);
      const challenge = ps.pending.challenge;
      if (!challenge?.rollDice || challenge.roll || challenge.outcome) fail('challenge_roll_unavailable', '지금은 미션 주사위를 굴릴 수 없어요.', 409);
      const die = random(context, 6) + 1;
      challenge.roll = { id: generatedId(context), playerId: player.id, dice: [die], from: player.position, to: player.position, path: [],
        startedAt: context.now, diceDurationMs: DICE_MS, stepDurationMs: STEP_MS, endsAt: context.now + DICE_MS, source: 'challenge' };
      ps.pending.text = marbleChallengeText(challenge.missionText, challenge);
      if (ps.timer) { ps.timer.deadline = challenge.roll.endsAt + ps.timer.remainingMs; ps.timer.paused = false; }
      log(next, context, `${player.name}: ${ps.pending.title} · 미션 주사위 ${die}`, player.id);
      focus(next, player.id);
      break;
    }
    case 'challenge-result': {
      const player = target(next, input);
      const ps = readyEffect(next, player, context.now);
      const challenge = ps.pending.challenge;
      if (!challenge || challenge.outcome) fail('challenge_already_resolved', '판정할 미션이 없거나 이미 결과를 확정했어요.', 409);
      if (challenge.rollDice && !challenge.roll) fail('challenge_roll_required', '미션 주사위를 먼저 굴려 주세요.', 409);
      if (!['success', 'failure'].includes(input.outcome)) fail('invalid_outcome', '성공 또는 실패를 선택해 주세요.');
      const branch = challenge[input.outcome];
      const { durationMs, extraTurn, shieldsBefore, changesShields } = applyEffects(next, player, branch.effects);
      challenge.outcome = input.outcome;
      challenge.resolvedAt = context.now;
      ps.pending.effects = copy(branch.effects);
      ps.pending.text = marbleChallengeText([branch.text, ...branch.effects.map(effect => effect.text)].filter(Boolean).join('\n'), challenge);
      ps.pending.extraTurn = extraTurn;
      if (changesShields) ps.pending.shieldDelta = player.shields - shieldsBefore;
      else delete ps.pending.shieldDelta;
      ps.timer = durationMs ? { durationMs, deadline: context.now + durationMs, remainingMs: durationMs, paused: false } : null;
      log(next, context, `${player.name}: ${ps.pending.title} ${input.outcome === 'success' ? '성공' : '실패'} · ${ps.pending.text}`, player.id);
      if (changesShields) log(next, context, `${player.name}: 방어권 ${shieldsBefore} → ${player.shields}장`, player.id);
      focus(next, player.id);
      break;
    }
    case 'complete':
    case 'pass': {
      const player = target(next, input);
      const ps = readyEffect(next, player, context.now);
      if (input.action === 'complete' && ps.pending.challenge && !ps.pending.challenge.outcome) fail('challenge_result_required', '성공 또는 실패를 먼저 판정해 주세요.', 409);
      if (input.action === 'pass') {
        if (own(input, 'useShield')) boolean(input.useShield, '방어권 사용');
        if (!(player.shields >= 1)) fail('no_shield', '미션을 패스하려면 방어권이 1장 필요해요.', 409);
        player.shields--;
      }
      const followup = input.action === 'complete' ? marbleNextRoll(ps.pending) : null;
      ps.phase = 'ready'; ps.pending = null; ps.timer = null; player.skipTurns = 0;
      log(next, context, `${player.name}: ${input.action === 'pass' ? '미션 패스 · 방어권 1장 사용' : '미션 완료'}`, player.id);
      focus(next, player.id);
      if (followup) roll(next, player, context, followup === 'bonus' ? 'bonus' : 'event', undefined, followup === 'bonus' ? undefined : followup === 'backward' ? -1 : 1);
      else consumeDonation(next, player, context);
      break;
    }
    case 'timer-pause':
    case 'timer-resume':
    case 'timer-add':
    case 'timer-finish': {
      const player = target(next, input);
      const ps = readyEffect(next, player, context.now);
      const timer = ps.timer;
      if (ps.pending.challenge?.rollDice && !ps.pending.challenge.roll) fail('challenge_roll_required', '미션 주사위를 먼저 굴려 주세요.', 409);
      if (!timer) fail('no_timer', '진행 중인 타이머가 없어요.', 409);
      if (input.action === 'timer-pause') {
        if (timer.paused) fail('timer_already_paused', '이미 멈춘 타이머예요.', 409);
        timer.remainingMs = marbleTimerRemaining(next, context.now, player.id); timer.deadline = null; timer.paused = true;
      } else if (input.action === 'timer-resume') {
        if (!timer.paused) fail('timer_not_paused', '멈춘 타이머가 아니에요.', 409);
        timer.deadline = context.now + timer.remainingMs; timer.paused = false;
      } else if (input.action === 'timer-add') {
        const added = integer(input.seconds, 1, 600, '추가 시간') * 1000;
        const remaining = marbleTimerRemaining(next, context.now, player.id);
        if (timer.durationMs + added > MAX_TIMER_MS) fail('timer_limit', '타이머의 최대 시간을 초과했어요.');
        timer.durationMs += added; timer.remainingMs = remaining + added;
        if (!timer.paused) timer.deadline = context.now + timer.remainingMs;
      } else {
        timer.remainingMs = 0; timer.deadline = null; timer.paused = false;
      }
      focus(next, player.id);
      break;
    }
    case 'settings': {
      object(input.settings, SETTINGS_KEYS, '설정');
      if (own(input.settings, 'tiles') || own(input.settings, 'cards')) requireStatus(next, ['lobby', 'finished']);
      const settings = parseMarbleSettings(input.settings, next.settings);
      if (settings.triggerPlayerId !== null && !next.players.some(player => player.id === settings.triggerPlayerId)) fail('player_not_found', '참여 대상 참가자를 찾을 수 없어요.', 404);
      if (own(input.settings, 'tiles') || own(input.settings, 'cards')) {
        next.deck = [];
        for (const player of next.players) player.position %= settings.tiles.length;
      }
      next.settings = settings;
      break;
    }
    case 'layout': next.settings.layouts = parseLayouts(input.layouts, next.settings.layouts); break;
    case 'enqueue-donation': {
      requireStatus(next, ['running', 'paused']);
      object(input.donation, ['id', 'username', 'provider'], '후원 예약');
      const donation = { id: id(input.donation.id, '후원 ID'), username: text(input.donation.username, 80, '후원자'), provider: text(input.donation.provider, 32, '후원 출처') };
      const player = target(next, input, true);
      const ps = next.playerStates[player.id];
      if (Object.values(next.playerStates).some(item => item.donationQueue.some(queued => queued.id === donation.id))) fail('duplicate_donation', '이미 예약된 후원이에요.', 409);
      if (ps.donationQueue.length >= 20) fail('donation_queue_full', '후원 예약은 참가자별 최대 20개예요.', 409);
      ps.donationQueue.push(donation);
      consumeDonation(next, player, context);
      break;
    }
  }
  next.revision++;
  focus(next);
  return next;
}

export function marbleBoardPosition(index, count) {
  integer(count, 12, 40, '칸 수');
  if (count % 4) fail('invalid_board_size', '칸 수는 4의 배수여야 해요.');
  integer(index, 0, count - 1, '칸 번호');
  const side = count / 4;
  if (index < side) return { x: side - index, y: side };
  if (index < 2 * side) return { x: 0, y: 2 * side - index };
  if (index < 3 * side) return { x: index - 2 * side, y: 0 };
  return { x: side, y: index - 3 * side };
}

export function marbleTimerRemaining(state, now, playerId = state.currentPlayerId) {
  const timer = state.playerStates?.[playerId]?.timer ?? (playerId === state.currentPlayerId ? state.timer : null);
  if (!timer) return 0;
  const clock = state.status === 'paused' && state.pausedAt !== null ? state.pausedAt : now;
  if (timer.paused || timer.deadline === null) return timer.remainingMs;
  return Math.max(0, Math.min(timer.durationMs, timer.deadline - clock));
}

const TRIGGER_ERROR_MESSAGES = Object.freeze({
  busy: '진행 중인 미션·후원 예약 또는 일시정지로 지금은 굴릴 수 없어요. 완료·재개 후 다시 시도해 주세요. 포인트는 차감되지 않았어요.',
  player_busy: '대상 플레이어의 미션을 먼저 마쳐 주세요. 포인트는 차감되지 않았어요.',
  inactive: '주루마블 게임이 시작되지 않았거나 종료되었어요. 게임 시작 후 참여해 주세요. 포인트는 차감되지 않았어요.',
  disabled: '이 참여 방식이 꺼져 있어요. 스트리머에게 참여 설정을 확인해 달라고 요청해 주세요. 포인트는 차감되지 않았어요.',
  viewer_participation_reconnect_required: '이전 온라인 참여가 종료되어 시청자 참여를 다시 연결해야 해요. 포인트는 차감되지 않았어요.',
  target_unavailable: '굴리기 대상 플레이어를 찾을 수 없어요. 스트리머가 참여 대상을 다시 설정해야 해요. 포인트는 차감되지 않았어요.',
  insufficient_points: '주사위를 굴리는 데 필요한 포인트가 부족해요. 보유 포인트와 1회 가격을 확인해 주세요. 포인트는 차감되지 않았어요.',
  command_mismatch: '현재 설정된 주루마블 명령어와 달라요. 방송의 참여 명령어를 확인해 주세요. 포인트는 차감되지 않았어요.',
  invalid_point_identity: '시청자 계정이나 채널 정보를 확인할 수 없어요. 로그인과 채널 연결을 확인해 주세요. 포인트는 차감되지 않았어요.',
  invalid_channel_uid: '참여 채널 정보를 확인할 수 없어요. 스트리머에게 채널 연결 상태를 확인해 달라고 요청해 주세요. 포인트는 차감되지 않았어요.',
  unsupported_currency: '주루마블 후원 참여는 원화(KRW)만 지원해요. 이번 후원은 굴리기에 반영되지 않았으며 후원금은 자동 환불되지 않아요.',
  below_minimum: '설정된 최소 후원 금액에 미달해 굴리기에 반영되지 않았어요. 후원금은 자동 환불되지 않아요.',
  queue_full: '대상 플레이어의 후원 예약 20개가 가득 차 이번 후원을 예약하지 못했어요. 후원금은 자동 환불되지 않아요.',
  donation_queue_full: '대상 플레이어의 후원 예약 20개가 가득 차 이번 후원을 예약하지 못했어요. 후원금은 자동 환불되지 않아요.',
  duplicate_donation: '이미 예약된 후원이에요. 같은 후원으로 굴리기를 추가 예약하지 않았어요.',
  invalid_trigger: '참여 요청 정보를 확인할 수 없어 굴리기에 반영하지 못했어요. 참여 설정을 확인해 주세요. 포인트는 차감되지 않았어요.',
});

export function marbleErrorMessage(error) {
  const code = typeof error === 'string' ? error : error && typeof error === 'object' ? error.code : undefined;
  if (typeof code === 'string' && own(TRIGGER_ERROR_MESSAGES, code)) return TRIGGER_ERROR_MESSAGES[code];
  return error instanceof MarbleError ? error.message : '주루마블 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
}

function pick(value, keys) {
  const result = {};
  for (const key of keys) if (own(value, key)) result[key] = copy(value[key]);
  return result;
}
function publicContent(item) {
  return { ...pick(item, ['id', 'title', 'text', 'color', 'icon', 'eventKind']), effects: item.effects.map(effect => pick(effect, ['type', 'value', 'text'])),
    ...(item.challenge ? { challenge: publicChallenge(item.challenge) } : {}) };
}
function publicChallenge(challenge, runtime = false) {
  const result = pick(challenge, runtime ? ['rollDice', 'missionText', 'outcome', 'resolvedAt'] : ['rollDice']);
  for (const key of ['success', 'failure']) result[key] = { text: challenge[key].text, effects: challenge[key].effects.map(effect => pick(effect, ['type', 'value', 'text'])) };
  if (runtime && challenge.roll) result.roll = pick(challenge.roll, ['id', 'playerId', 'dice', 'from', 'to', 'path', 'startedAt', 'diceDurationMs', 'stepDurationMs', 'endsAt', 'source']);
  return result;
}
function publicPlayerState(ps) {
  return { phase: ps.phase,
    lastRoll: ps.lastRoll ? pick(ps.lastRoll, ['id', 'playerId', 'dice', 'from', 'to', 'path', 'startedAt', 'diceDurationMs', 'stepDurationMs', 'endsAt', 'source', 'direction']) : null,
    pending: ps.pending ? { ...pick(ps.pending, ['title', 'text', 'color', 'tileId', 'cardId', 'readyAt', 'extraTurn', 'shieldDelta']), effects: ps.pending.effects.map(effect => pick(effect, ['type', 'value', 'text'])),
      ...(ps.pending.challenge ? { challenge: publicChallenge(ps.pending.challenge, true) } : {}) } : null,
    timer: ps.timer ? pick(ps.timer, ['durationMs', 'deadline', 'remainingMs', 'paused']) : null, donationQueue: [] };
}
export function toPublicMarbleState(state) {
  const layouts = {};
  for (const orientation of ORIENTATIONS) {
    layouts[orientation] = {};
    for (const block of BLOCKS) layouts[orientation][block] = pick(state.settings.layouts[orientation][block], ['x', 'y', 'width', 'visible']);
  }
  const result = { ...pick(state, ['version', 'revision', 'gameId', 'status', 'currentPlayerId', 'round', 'pausedAt']),
    settings: { ...pick(state.settings, ['title', 'diceCount', 'participantControl']), triggerPlayerId: null,
      points: { enabled: false, command: '', cost: 0 }, donation: { enabled: false, minimum: 0 },
      tiles: state.settings.tiles.map(publicContent), cards: state.settings.cards.map(publicContent), layouts },
    players: state.players.map(player => pick(player, ['id', 'name', 'color', 'avatarUrl', 'position', 'laps', 'skipTurns', 'shields'])),
    playerStates: {}, history: state.history.map(entry => pick(entry, ['id', 'at', 'text', 'playerId'])), deck: [],
  };
  for (const player of result.players) result.playerStates[player.id] = publicPlayerState(state.playerStates[player.id]);
  focus(result);
  return result;
}
