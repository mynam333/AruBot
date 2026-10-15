export type MarbleEffectType = 'message' | 'timer' | 'move' | 'rollForward' | 'rollBackward' | 'goto' | 'skip' | 'extra' | 'shield' | 'shieldLoss' | 'shieldClear' | 'shieldDouble' | 'card';
export type MarbleEffect = { type: MarbleEffectType; value?: number; text?: string };
export type MarbleIcon = 'start' | 'drink' | 'snack' | 'cheers' | 'talk' | 'speech' | 'forbidden' | 'water' | 'card' | 'shield' | 'forward' | 'backward' | 'extra' | 'rest' | 'timer' | 'mission';
export type MarbleEventKind = 'reward' | 'penalty' | 'feast' | 'rule' | 'game';
export type MarbleChallengeOutcome = { text: string; effects: MarbleEffect[] };
export type MarbleChallenge = { rollDice: boolean; success: MarbleChallengeOutcome; failure: MarbleChallengeOutcome };
export type MarbleChallengeState = MarbleChallenge & { missionText: string; roll?: MarbleRoll; outcome?: 'success' | 'failure'; resolvedAt?: number };
export type MarbleTile = { id: string; title: string; text: string; color: string; effects: MarbleEffect[]; icon?: MarbleIcon; eventKind?: MarbleEventKind; challenge?: MarbleChallenge };
export type MarbleCard = MarbleTile;
export type MarbleBlock = 'board' | 'dice' | 'timer' | 'card' | 'roster';
export type MarbleOrientation = 'landscape' | 'portrait';
export type MarbleLayoutItem = { x: number; y: number; width: number; visible: boolean };
export type MarbleLayouts = Record<MarbleOrientation, Record<MarbleBlock, MarbleLayoutItem>>;
export type MarbleRect = { x: number; y: number; width: number; height: number };
export type MarbleBoardLayout = {
  width: number; height: number; columns: number; rows: number; cellWidth: number; cellHeight: number;
  slots: MarbleRect[]; interior: MarbleRect;
};
export type MarbleSettings = {
  title: string; diceCount: 1 | 2; participantControl: boolean;
  /** External points/donation target; null always falls back to the first player, never focus. */
  triggerPlayerId: string | null;
  points: { enabled: boolean; command: string; cost: number };
  donation: { enabled: boolean; minimum: number };
  tiles: MarbleTile[]; cards: MarbleCard[]; layouts: MarbleLayouts;
};
export type MarbleParticipationSettings = Pick<MarbleSettings, 'points' | 'donation'>;
export type MarbleViewerParticipation = {
  revision: number; connected: boolean; settings: MarbleParticipationSettings;
  connectedOwnerUserId: string | null; connectedRoomTitle: string | null;
  suspended?: boolean;
};
export type MarbleViewerOverlay = {
  revision: number; connected: boolean; ownerUserId: string | null; roomTitle: string | null;
};
export type MarblePlayer = {
  id: string; name: string; color: string; userId?: string | null; avatarUrl?: string | null;
  /** skipTurns is a legacy voluntary-rest marker, cleared on complete/pass; never blocks a paid roll. */
  position: number; laps: number; skipTurns: number; shields: number;
};
export type MarbleRoll = {
  id: string; playerId: string; dice: number[]; from: number; to: number;
  path: number[]; startedAt: number; diceDurationMs: number; stepDurationMs: number;
  endsAt: number; source: string; username?: string; direction?: 1 | -1;
};
export type MarblePending = {
  title: string; text: string; color: string; tileId: string; cardId?: string;
  /** Resolved, non-card effects in execution order. extraTurn grants one roll on complete, forfeited on pass. */
  effects: MarbleEffect[]; readyAt: number; extraTurn: boolean;
  /** Actual change after 0..99 clamping; present only when a shield effect ran. */
  shieldDelta?: number;
  challenge?: MarbleChallengeState;
};
export type MarbleTimer = { durationMs: number; deadline: number | null; remainingMs: number; paused: boolean };
export type MarbleHistory = { id: string; at: number; text: string; playerId?: string };
export type MarbleDonation = { id: string; username: string; provider: string };
export type MarblePlayerState = {
  phase: 'ready' | 'effect'; lastRoll: MarbleRoll | null;
  pending: MarblePending | null; timer: MarbleTimer | null; donationQueue: MarbleDonation[];
};
export type MarbleState = {
  version: 1; revision: number; gameId: string | null; settings: MarbleSettings; players: MarblePlayer[];
  playerStates: Record<string, MarblePlayerState>;
  status: 'lobby' | 'running' | 'paused' | 'finished'; phase: 'ready' | 'effect';
  /** Focus only, never turn ownership. Top-level gameplay fields mirror this player's state. */
  currentPlayerId: string | null; round: number; lastRoll: MarbleRoll | null;
  pending: MarblePending | null; timer: MarbleTimer | null; pausedAt: number | null;
  history: MarbleHistory[]; donationQueue: MarbleDonation[]; deck: string[];
};
export type MarbleInvitation = { id: string; ownerUserId: string; memberUserId?: string; displayName: string; status: string; expiresAt: string };
export type MarbleSnapshot = {
  state: MarbleState; serverNow: number; ownerUserId?: string; overlayToken?: string;
  access?: 'host' | 'participant' | 'overlay'; invitations?: MarbleInvitation[];
  actorPlayerId?: string | null;
  actorInvitationId?: string | null;
  /** Compare connection, source, then state.revision for personal OBS snapshots. */
  overlayRevision?: { connection: number; source: number };
  viewerParticipation?: MarbleViewerParticipation;
  viewerOverlay?: MarbleViewerOverlay;
  /** Only the authenticated participant's queue count, without donor identities. */
  viewerDonationQueueCount?: number;
};
/** Gameplay actions accept playerId (default focus/first); authorization belongs to the backend.
 * timer-add uses seconds; enqueue-donation uses donation: MarbleDonation (20 queued per player).
 * Every pass consumes one shield from the target player; useShield cannot waive the cost. reset returns to the lobby.
 * focus changes only the display focus. round counts rolls, not turns. Default state has player-1.
 * expectedRollId (string|null) guards roll/complete/pass against stale per-player missions.
 * leave-player is server-internal, removes only the authorized departing member even during play.
 */
export type MarbleAction = { action: string; requestId?: string; revision?: number; playerId?: string; [key: string]: unknown };
export class MarbleError extends Error { constructor(code: string, message?: string, status?: number); code: string; status: number }
export const DEFAULT_MARBLE_SETTINGS: MarbleSettings;
export const DEFAULT_MARBLE_PARTICIPATION_SETTINGS: MarbleParticipationSettings;
export const MARBLE_COLORS: readonly string[];
export const MARBLE_EFFECT_LABELS: Record<MarbleEffectType, string>;
export const MARBLE_ICON_LABELS: Record<MarbleIcon, string>;
export const MARBLE_EVENT_LABELS: Record<MarbleEventKind, string>;
export function marbleContentIcon(item: Pick<MarbleTile, 'title' | 'effects' | 'icon'>, index?: number): MarbleIcon;
/** Movement events use exactly one die and wait for complete, preserving pass and stale-roll guards. */
export function marbleNextRoll(pending: MarblePending | null | undefined): 'forward' | 'backward' | 'bonus' | null;
/** Substitute the persisted mission die; never uses the board-movement roll. */
export function marbleChallengeText(value: string, challenge?: MarbleChallengeState | null): string;
export const MARBLE_BLOCK_LABELS: Record<MarbleBlock, string>;
export const MARBLE_SIZES: Record<MarbleOrientation, { width: number; height: number }>;
/** Legacy fixed geometry; use marbleBlockGeometry for orientation-aware board dimensions. */
export const MARBLE_BLOCK_GEOMETRY: Record<MarbleBlock, { width: number; height: number }>;
/** Native block pixels; board fills MARBLE_SIZES[orientation], other blocks keep fixed geometry. */
export function marbleBlockGeometry(block: MarbleBlock, orientation: MarbleOrientation): { width: number; height: number };
/** Native canvas pixels with a 12px inset. Slots run bottom-right, left, up, right, down.
 * The interior is free of tiles and intended to remain transparent for the VTuber scene.
 */
export function marbleBoardLayout(count: number, orientation: MarbleOrientation): MarbleBoardLayout;
export function createMarbleState(): MarbleState;
export function parseMarbleSettings(input: unknown, base?: MarbleSettings): MarbleSettings;
export function parseMarbleParticipationSettings(input: unknown, base?: MarbleParticipationSettings): MarbleParticipationSettings;
export function applyMarbleAction(state: MarbleState, input: MarbleAction, context: { now: number; randomInt: (max: number) => number; uuid: () => string }): MarbleState;
export function marbleErrorMessage(error: unknown): string;
/** Integer grid coordinates 0..count/4, starting bottom-right and moving clockwise. */
export function marbleBoardPosition(index: number, count: number): { x: number; y: number };
export function marbleTimerRemaining(state: MarbleState, now: number, playerId?: string): number;
export function toPublicMarbleState(state: MarbleState): MarbleState;
