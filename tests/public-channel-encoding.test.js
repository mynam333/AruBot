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
    readPublicChannelHub: jest.fn().mockResolvedValue({ points: {}, live: {}, commands: [], roulette: [] }),
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
    const hubLinks = linksIn(hub.type(hub.props));
    expect(hubLinks.some((link) => link.href === `/c/${encodedUid}/points`)).toBe(true);

    const page = await h.PublicChannelPage({ channelUid: input, kind: 'points' });
    expect(h.readPublicChannelData).toHaveBeenCalledWith(uid, 'points');
    expect(page.props.channelUid).toBe(uid);
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
  });
});
