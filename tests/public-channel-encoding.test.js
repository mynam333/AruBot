const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const loadSource = require('./helpers/load-source.cjs');
const { decodeChannelRouteParam } = loadSource('src/shared/lib/channel-route-param.ts');

const uid = 'chzzk:87b05833a7894176a9184afc5ba2af06';
const encodedUid = encodeURIComponent(uid);
const routeInputs = [uid, encodedUid, encodeURIComponent(encodedUid)];
const notFound = () => { throw new Error('not found'); };
const placeholder = () => null;
const Link = placeholder;
const routingImport = { decodeChannelRouteParam };

function loadPages() {
  const api = {
    readPublicChannelData: jest.fn().mockResolvedValue({ points: [], total: 0 }),
    readPublicChannelProfile: jest.fn().mockResolvedValue({ uid, provider: 'chzzk', displayName: '대표 닉네임' }),
    readPublicChannelHub: jest.fn().mockResolvedValue({ points: {}, live: {}, commands: [], roulette: [], profile: { displayName: '대표 닉네임' } }),
  };
  return {
    ...api,
    ...loadSource('src/features/public/public-channel-page.tsx', {
      'next/link': { default: Link },
      'next/navigation': { notFound },
      '@/shared/lib/channel-route-param': routingImport,
      '@/shared/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
      '@/shared/api/public': api,
      '@/components/ui/badge': { Badge: placeholder },
      '@/components/app-shell/legal-footer': { LegalFooter: placeholder },
      '@/components/ui/card': Object.fromEntries(['Card', 'CardContent', 'CardDescription', 'CardHeader', 'CardTitle'].map((key) => [key, placeholder])),
      '@/components/ui/page': { ErrorState: placeholder },
      '@/components/ui/share-link-actions': { ShareLinkActions: placeholder },
      './public-point-earning-summary': { PublicPointEarningSummary: placeholder },
      './public-realtime-data-view': { PublicRealtimeDataView: placeholder },
    }),
  };
}

function linksIn(element) {
  if (!element || typeof element !== 'object') return [];
  if (Array.isArray(element)) return element.flatMap(linksIn);
  const own = element.type === Link && element.props.href ? [element.props] : [];
  return [...own, ...linksIn(element.props?.children)];
}

function loadClientEndpoint() {
  const filename = path.join(__dirname, '../src/features/public/public-realtime-data-view.tsx');
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'buildEndpoint');
  const compiled = ts.transpileModule(declaration.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function('decodeChannelRouteParam', `${compiled}\nreturn buildEndpoint;`)(decodeChannelRouteParam);
}

describe('public channel UID encoding', () => {
  test.each(routeInputs)('hub and point navigation normalize %s before rendering', async (input) => {
    const h = loadPages();
    const hub = await h.PublicChannelHub({ channelUid: input });
    expect(h.readPublicChannelHub).toHaveBeenCalledWith(uid);
    expect(hub.props.channelName).toBe('대표 닉네임');
    const hubLinks = linksIn(hub.type(hub.props));
    expect(hubLinks.some((link) => link.href === `/c/${encodedUid}/points`)).toBe(true);

    const page = await h.PublicChannelPage({ channelUid: input, kind: 'points' });
    expect(h.readPublicChannelData).toHaveBeenCalledWith(uid, 'points');
    expect(page.props.channelUid).toBe(uid);
    expect(page.props.channelName).toBe('대표 닉네임');
    expect(h.readPublicChannelProfile).toHaveBeenCalledWith(uid);
    const pageLinks = linksIn(page.type(page.props));
    expect(pageLinks.some((link) => link.href === `/c/${encodedUid}`)).toBe(true);
    for (const link of [...hubLinks, ...pageLinks].filter((entry) => entry.href.startsWith('/c/'))) {
      expect(link.href).not.toContain('%253A');
      expect(link.prefetch).toBe(false);
    }
  });

  test.each(routeInputs)('server and client API requests encode %s exactly once', async (input) => {
    const readServerJson = jest.fn().mockResolvedValue({ points: [] });
    const api = loadSource('src/shared/api/public.ts', {
      './server': { readServerJson },
      '@/shared/lib/channel-route-param': routingImport,
    });
    const buildEndpoint = loadClientEndpoint();
    for (const kind of ['commands', 'points', 'roulette', 'rouletteLogs', 'live']) {
      const serverPath = api.getPublicEndpoint(input, kind);
      expect(serverPath).toContain(encodedUid);
      expect(serverPath).not.toContain('%253A');
      expect(buildEndpoint(input, kind)).toBe(kind === 'points' ? `${serverPath}?limit=100` : serverPath);
    }
    await api.readPublicChannelData(input, 'points');
    expect(readServerJson).toHaveBeenCalledWith(`/api/public/${encodedUid}/points?limit=100`, expect.any(Object));
    await api.readPublicChannelProfile(input);
    expect(readServerJson).toHaveBeenCalledWith(`/api/public/${encodedUid}/profile`, expect.any(Object));
  });

  test.each([
    ['points', 'points'], ['commands', 'commands'],
    ['roulettelist', 'roulette'], ['roulettelog', 'roulette/logs'],
  ])('legacy %s links redirect without adding encoding layers', async (route, target) => {
    const redirect = jest.fn();
    const { default: Page } = loadSource(`src/app/(public)/${route}/[channelUid]/page.tsx`, {
      'next/navigation': { notFound, redirect },
      '@/shared/lib/channel-route-param': routingImport,
    });
    await Page({ params: Promise.resolve({ channelUid: encodeURIComponent(encodedUid) }) });
    expect(redirect).toHaveBeenCalledWith(`/c/${encodedUid}/${target}`);
  });

  test('malformed UIDs stop before fetching public data', async () => {
    const h = loadPages();
    await expect(h.PublicChannelHub({ channelUid: '%' })).rejects.toThrow('not found');
    await expect(h.PublicChannelPage({ channelUid: `${encodedUid}%2Fpoints`, kind: 'points' })).rejects.toThrow('not found');
    expect(h.readPublicChannelHub).not.toHaveBeenCalled();
    expect(h.readPublicChannelData).not.toHaveBeenCalled();
    expect(h.readPublicChannelProfile).not.toHaveBeenCalled();
  });

  test.each(['commands', 'points', 'roulette', 'rouletteLogs', 'live'])('%s header uses the representative nickname, never the broadcast title', async (kind) => {
    const h = loadPages();
    h.readPublicChannelData.mockResolvedValue({ uid, channelName: encodedUid, title: '오늘의 방송 제목' });
    const page = await h.PublicChannelPage({ channelUid: encodedUid, kind });
    expect(page.props.channelName).toBe('대표 닉네임');
  });

  test('hub name survives missing live data and empty channel names', async () => {
    const h = loadPages();
    for (const live of [null, { channelName: '', title: '오늘의 방송 제목' }]) {
      h.readPublicChannelHub.mockResolvedValue({ live, points: {}, profile: { displayName: '대표 닉네임' } });
      expect((await h.PublicChannelHub({ channelUid: uid })).props.channelName).toBe('대표 닉네임');
    }
  });

  test('missing profile uses only real channel names, not title or identifier placeholders', async () => {
    const h = loadPages(); h.readPublicChannelProfile.mockResolvedValue(null);
    for (const channelName of ['', uid, encodedUid, uid.split(':')[1]]) {
      h.readPublicChannelData.mockResolvedValue({ channelName, title: '오늘의 방송 제목' });
      expect((await h.PublicChannelPage({ channelUid: uid, kind: 'commands' })).props.channelName).toBe('시청자 페이지');
    }
    h.readPublicChannelData.mockResolvedValue({ channelName: '플랫폼 닉네임', title: '오늘의 방송 제목' });
    expect((await h.PublicChannelPage({ channelUid: uid, kind: 'live' })).props.channelName).toBe('플랫폼 닉네임');
  });

  test('a loaded profile does not hide the hub data error', async () => {
    const h = loadPages();
    h.readPublicChannelHub.mockResolvedValue({
      live: null, commands: null, points: null, roulette: null,
      profile: { displayName: '대표 닉네임' },
    });
    const hub = await h.PublicChannelHub({ channelUid: uid });
    expect(hub.props.channelName).toBe('대표 닉네임');
    expect(hub.props.children[0].props.description).toBe('채널 참여 정보를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.');
  });
});
