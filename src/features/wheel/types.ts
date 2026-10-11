export type WheelTheme = 'festival' | 'studio' | 'midnight';
export type WheelEntrySource = 'chat' | 'points' | 'donation' | 'manual';

export interface WheelEntry {
  id: string;
  label: string;
  username: string;
  source: WheelEntrySource;
  slots: number;
  colorIndex: number;
  /** Unix milliseconds; ISO strings remain supported for legacy snapshots. */
  createdAt: number | string;
}

export interface WheelSpin {
  id: string;
  /** Server Unix milliseconds; ISO strings remain supported for legacy snapshots. */
  startedAt: number | string;
  durationMs: number;
  /** Immutable, ordered snapshot. Slots are zero-indexed in this order. */
  entries: WheelEntry[];
  totalSlots: number;
  selectedSlot: number;
  entryId: string;
  label: string;
  username: string;
  turns: number;
}

export type WheelHistoryEntry = Omit<WheelSpin, 'entries'> & { entries?: WheelEntry[] };

export interface WheelSettings {
  title: string;
  chat: { enabled: boolean; command: string; perUserLimit: number };
  points: { enabled: boolean; command: string; costPerSlot: number };
  donation: { enabled: boolean; wonPerSlot: number };
  spinDurationMs: number;
  removal: 'one' | 'keep' | 'all';
  theme: WheelTheme;
}

export interface WheelState {
  roundId: string;
  revision: number;
  collecting: boolean;
  settings: WheelSettings;
  entries: WheelEntry[];
  totalSlots: number;
  latestSpin: WheelSpin | null;
  history: WheelHistoryEntry[];
}
