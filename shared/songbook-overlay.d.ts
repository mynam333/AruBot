export type SongbookOrientation = 'landscape' | 'portrait';
export type SongbookBlock = 'current' | 'queue';
export type SongbookBlockLayout = { x: number; y: number; width: number; visible: boolean };
export type SongbookOverlayConfig = {
  accent: string; text: string; background: string; opacity: number; scale: number; maxRows: number;
  artwork: boolean; requester: boolean; keyShift: boolean; hideEmpty: boolean;
  layouts: Record<SongbookOrientation, Record<SongbookBlock, SongbookBlockLayout>>;
};
export type SongbookOverlayItem = { id: string; title: string; artist: string; username: string; videoId: string | null; keyShift: number };
export type SongbookOverlaySnapshot = { config: SongbookOverlayConfig; requestsEnabled: boolean; current: SongbookOverlayItem | null; queue: SongbookOverlayItem[]; queueCount: number };
export const SONGBOOK_OVERLAY_SIZES: Record<SongbookOrientation, { width: number; height: number }>;
export const DEFAULT_SONGBOOK_OVERLAY: SongbookOverlayConfig;
export function normalizeSongbookOverlay(input?: unknown): SongbookOverlayConfig;
export function songbookOverlayRect(config: SongbookOverlayConfig, orientation: SongbookOrientation, block: SongbookBlock): { x: number; y: number; width: number; height: number };
export function songbookOverlayCapacity(config: SongbookOverlayConfig, orientation: SongbookOrientation): number;
export function songbookOverlaySnapshot(row: unknown, requests: unknown[]): SongbookOverlaySnapshot;
