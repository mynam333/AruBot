import { readServerJson } from './server';

export type PublicChannelKind = 'commands' | 'points' | 'roulette' | 'rouletteLogs' | 'live';

const endpoints = {
  commands: (uid: string) => `/api/public/${uid}/rules`,
  points: (uid: string) => `/api/public/${uid}/points`,
  roulette: (uid: string) => `/api/public/${uid}/roulette-defs`,
  rouletteLogs: (uid: string) => `/api/roulette/logs?uid=${encodeURIComponent(uid)}`,
  live: (uid: string) => `/api/public/${uid}/live`,
} as const;

const cacheSeconds = {
  commands: 45,
  points: 10,
  roulette: 45,
  rouletteLogs: 10,
  live: 15,
} as const;

export function getPublicEndpoint(channelUid: string, kind: PublicChannelKind) {
  return endpoints[kind](channelUid);
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
