export const BOT_MANAGEMENT_OWNER_KEY = 'arubot:bot-owner';
const ACTOR_KEY = 'arubot:bot-actor';
let retainedRequestOwner: string | null = null;

export type BotManagementModule =
  | 'dashboard' | 'connection' | 'commands' | 'macros' | 'points'
  | 'predictions' | 'roulette' | 'wheel' | 'marble' | 'video' | 'drawing'
  | 'donations' | 'automations' | 'actions' | 'logs' | 'settings' | 'songbook' | 'emotes';

export type BotChannel = {
  ownerUserId: string;
  displayName: string;
  avatarUrl: string | null;
  provider: string | null;
  role: 'owner' | 'manager' | 'site_admin';
  scopes: string[];
};

export type BotManagementContext = {
  actorUserId: string;
  isSiteAdmin: boolean;
  active: BotChannel;
  channels: BotChannel[];
  scopeGroups: { key: string; label: string; description: string }[];
};

export function getBotManagementOwner(): string | null {
  if (typeof window === 'undefined') return null;
  if (retainedRequestOwner) return retainedRequestOwner;
  try {
    return window.sessionStorage.getItem(BOT_MANAGEMENT_OWNER_KEY) || null;
  } catch {
    return null;
  }
}

export function setBotManagementOwner(ownerId: string | null) {
  if (typeof window === 'undefined') return;
  // A failed delegated selection must not silently fall back to the actor's bot.
  if (ownerId) window.sessionStorage.setItem(BOT_MANAGEMENT_OWNER_KEY, ownerId);
  else window.sessionStorage.removeItem(BOT_MANAGEMENT_OWNER_KEY);
  retainedRequestOwner = null;
}

export function retainBotManagementOwner(ownerId: string) {
  if (typeof window === 'undefined' || !ownerId) return;
  retainedRequestOwner = ownerId;
  try {
    window.sessionStorage.setItem(BOT_MANAGEMENT_OWNER_KEY, ownerId);
  } catch { /* Keep delayed requests pinned even when storage becomes unavailable. */ }
}

export function getBotManagementActor(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(ACTOR_KEY);
  } catch {
    return null;
  }
}

export function setBotManagementActor(actorUserId: string) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(ACTOR_KEY, actorUserId);
}

export function clearBotManagementContext() {
  if (typeof window === 'undefined') return;
  retainedRequestOwner = null;
  try {
    window.sessionStorage.removeItem(BOT_MANAGEMENT_OWNER_KEY);
    window.sessionStorage.removeItem(ACTOR_KEY);
  } catch { /* Storage can be unavailable in restricted browser sessions. */ }
}

export function hasBotManagementScope(channel: BotChannel, module: string, access: 'read' | 'write') {
  if (channel.role === 'owner' || channel.role === 'site_admin') return true;
  return channel.scopes.includes('*') || channel.scopes.includes(`${module}:${access}`)
    || (access === 'read' && channel.scopes.includes(`${module}:write`));
}

export function botChannelRoleLabel(role: BotChannel['role']) {
  return role === 'owner' ? '내 채널' : role === 'site_admin' ? '사이트 관리자' : '관리 중';
}
