const fs = require('fs');
const path = require('path');
const load = require('./helpers/load-source.cjs');
const loadFunctions = require('./helpers/load-server-functions.cjs');
const { fxPlacementStyle, sampleFxPosition } = load('src/shared/lib/fx-placement.ts');

test('old saved FX keep fixed placement and mixed units', () => {
  expect(fxPlacementStyle({ x: 120, xUnit: 'px', y: 75, width: 28, height: 200, heightUnit: 'px' }))
    .toEqual({ left: '120px', top: '75%', width: '28%', height: '200px' });
  expect(fxPlacementStyle({})).toEqual({ left: '50%', top: '50%', width: '30%', height: '30%' });
});

test('each appearance samples once and updates reuse its anchor', () => {
  const random = jest.fn().mockReturnValueOnce(0.1).mockReturnValueOnce(0.9).mockReturnValueOnce(0.8).mockReturnValueOnce(0.2);
  const first = sampleFxPosition(random);
  const second = sampleFxPosition(random);
  expect(first).toEqual({ x: 0.1, y: 0.9 });
  expect(second).toEqual({ x: 0.8, y: 0.2 });
  const item = { positionMode: 'random', positionAnchor: first, width: 200, widthUnit: 'px', height: 50 };
  const style = fxPlacementStyle(item);
  expect(style.width).toBe('min(100%, 200px)');
  expect(style.height).toBe('min(100%, 50%)');
  expect(style.left).toContain('* 0.1)');
  expect(fxPlacementStyle({ ...item, exiting: true })).toEqual(style);
  expect(random).toHaveBeenCalledTimes(4);
});

test('random anchors are bounded even for invalid inputs', () => {
  expect(sampleFxPosition(() => NaN)).toEqual({ x: 0.5, y: 0.5 });
  expect(sampleFxPosition(() => -1)).toEqual({ x: 0, y: 0 });
  expect(sampleFxPosition(() => 4)).toEqual({ x: 1, y: 1 });
  const style = fxPlacementStyle({ positionMode: 'random', width: 20000, widthUnit: 'px' });
  expect(style.width).toBe('min(100%, 20000px)');
});

test('server preserves the mode on normalization and on unspecified position updates', () => {
  const { normalizeFxPayload, broadcastFxEventToSid } = loadFunctions(['normalizeFxPayload', 'broadcastFxEventToSid'], {
    crypto: require('crypto'), path,
    FX_ASSET_KINDS: new Set(['image']), normalizeFxLengthUnit: (value) => value === 'px' ? 'px' : '%',
    normalizeFxLength: (value, fallback) => value ?? fallback, normalizeFxCss: (value) => value || '',
    normalizeFxCssCode: (value) => value || '', normalizeFxColor: (value) => value || '#00ff00',
    fxSidSockets: new Map([['user:a', new Set([{ readyState: 1, send: (text) => sent.push(JSON.parse(text)) }])]]),
    WebSocket: { OPEN: 1 },
  });
  const sent = [];
  expect(normalizeFxPayload({ positionMode: 'random' }).positionMode).toBe('random');
  expect(normalizeFxPayload({}).positionMode).toBe('fixed');
  broadcastFxEventToSid('user:a', 'fx:play', { positionMode: 'random' });
  broadcastFxEventToSid('user:a', 'fx:update', { text: 'updated' });
  expect(sent[0].payload.positionMode).toBe('random');
  expect(sent[1].payload).not.toHaveProperty('positionMode');
});

test('FX editor exposes the mode and only hides fixed coordinates without clearing them', () => {
  const page = fs.readFileSync(path.join(__dirname, '../src/features/admin/action-blueprint-page.tsx'), 'utf8');
  expect(page).toContain("onChange('positionMode', value)");
  expect(page).toContain("{ value: 'random', label: '랜덤 위치' }");
  expect(page).toContain("cfg.positionMode !== 'random' ?");
  const overlay = fs.readFileSync(path.join(__dirname, '../src/components/FxOverlay.tsx'), 'utf8');
  expect(overlay).toContain('const positionAnchor = sampleFxPosition();');
  expect(overlay).toContain('...fxPlacementStyle(item)');
});
