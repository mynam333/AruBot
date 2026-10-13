export type SongbookCommandKind = 'request' | 'url';
export type SongbookCommandRule = {
  id: string; name?: string; keywords?: string[]; responses?: string[]; enabled?: boolean;
  adminOnly?: boolean; requiredRoleLevel?: number; pointsCost?: number; cooldown?: number; lastUsed?: number;
  [key: string]: unknown;
};
export function songbookCommandKinds(rule: SongbookCommandRule): SongbookCommandKind[];
export function hasSongbookCommandToken(text: unknown): boolean;
export function replaceSongbookCommandTokens(text: unknown, values: Partial<Record<SongbookCommandKind, string>>): string;
export function songbookCommandTemplate(kind: SongbookCommandKind, id: string): SongbookCommandRule;
export function commandEditVersion(rule: SongbookCommandRule | null): string | null;
export function songbookTriggerConflict(rule: SongbookCommandRule, rules: SongbookCommandRule[]): SongbookCommandRule | null;
export function matchSongbookSongs<T extends { id: string; title: string; artist: string; visible?: boolean; requestable?: boolean }>(songs: T[], query: string): T[];
