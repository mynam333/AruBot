import { DEFAULT_EMOTE_SETTINGS } from '../../../shared/emote-overlay';

export type EmoteSettings = typeof DEFAULT_EMOTE_SETTINGS;
export type EmoteImage = { url: string; name: string; provider: string; sample?: boolean };
export type EmotePacket = { id: string; createdAt: number; items: EmoteImage[]; seed: number; settings: EmoteSettings };
export type EmoteSnapshot = { settings: EmoteSettings; revision: number; epoch: number; cursor: string; events: EmotePacket[]; serverNow: number };
