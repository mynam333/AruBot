import { readServerJson } from './server';
import { decodeChannelRouteParam } from '@/shared/lib/channel-route-param';

export type PublicChannelKind = 'commands' | 'points' | 'roulette' | 'rouletteLogs' | 'live';

const endpoints = {
  commands: (uid: string) => `/api/public/${encodeURIComponent(uid)}/rules`,
  points: (uid: string) => `/api/public/${encodeURIComponent(uid)}/points`,
  roulette: (uid: string) => `/api/public/${encodeURIComponent(uid)}/roulette-defs`,
  rouletteLogs: (uid: string) => `/api/roulette/logs?uid=${encodeURIComponent(uid)}`,
  live: (uid: string) => `/api/public/${encodeURIComponent(uid)}/live`,
} as const;

const cacheSeconds = {
  commands: 45,
  points: 10,
  roulette: 45,
  rouletteLogs: 10,
  live: 15,
} as const;

export function getPublicEndpoint(channelUid: string, kind: PublicChannelKind) {
  const uid = decodeChannelRouteParam(channelUid);
  if (!uid) throw new Error('Invalid channel UID');
  return endpoints[kind](uid);
}

export async function readPublicChannelData(channelUid: string, kind: PublicChannelKind) {
  const endpoint = kind === 'points'
    ? `${getPublicEndpoint(channelUid, kind)}?limit=100`
    : getPublicEndpoint(channelUid, kind);
  return readServerJson<unknown>(endpoint, {
    next: { revalidate: cacheSeconds[kind] },
  });
}

export async function readPublicChannelHub(channelUid: string) {
  const [live, commands, points, roulette] = await Promise.all([
    readPublicChannelData(channelUid, 'live'),
    readPublicChannelData(channelUid, 'commands'),
    readPublicChannelData(channelUid, 'points'),
    readPublicChannelData(channelUid, 'roulette'),
  ]);

  return { live, commands, points, roulette };
}
