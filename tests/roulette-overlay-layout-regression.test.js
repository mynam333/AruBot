const fs = require('fs');
const path = require('path');

describe('룰렛 오버레이 레이아웃 회귀 방지', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const rouletteViewer = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'RouletteViewer.tsx'), 'utf8');
  const rouletteWheelSkins = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'rouletteWheelSkins.tsx'), 'utf8');
  const rouletteWheelUtils = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'rouletteWheelUtils.ts'), 'utf8');
  const roulettePage = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'roulette-page.tsx'), 'utf8');
  const adminActionDialogs = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'admin-action-dialogs.tsx'), 'utf8');

  test('관리자 페이지는 릴/휠 표현 형태를 별도 선택으로 저장해야 함', () => {
    expect(roulettePage).toContain('ROULETTE_LAYOUT_OPTIONS');
    expect(roulettePage).toContain('ROULETTE_SKIN_OPTIONS');
    expect(roulettePage).toContain('ROULETTE_SKIN_PREVIEWS');
    expect(roulettePage).toContain('RouletteSkinPreview');
    expect(roulettePage).toContain('표현 형태');
    expect(roulettePage).toContain('스킨');
    expect(roulettePage).toContain('미리보기');
    expect(roulettePage).toContain('릴 형태');
    expect(roulettePage).toContain('휠 형태');
    expect(roulettePage).toContain('프리즘');
    expect(roulettePage).toContain('스튜디오');
    expect(roulettePage).toContain('오로라');
    expect(roulettePage).toContain('벨벳');
    expect(roulettePage).toContain('모노');
    expect(roulettePage).toContain('아르데코');
    expect(roulettePage).toContain('크리스탈');
    expect(roulettePage).toContain('수묵');
    expect(roulettePage).toContain('노바');
    expect(roulettePage).toContain('세라믹');
    expect(roulettePage).toContain('아케이드');
    expect(roulettePage).toContain('오션');
    expect(roulettePage).toContain('솔라');
    expect(roulettePage).toContain('네온');
    expect(roulettePage).toContain('골드');
    expect(roulettePage).toContain('theme: `${layout}:${theme}`');
    expect(adminActionDialogs).toContain('ROULETTE_LAYOUT_OPTIONS');
    expect(adminActionDialogs).toContain('ROULETTE_SKIN_OPTIONS');
    expect(adminActionDialogs).toContain('표현 형태');
    expect(adminActionDialogs).toContain('스킨');
    expect(adminActionDialogs).toContain('theme: `${layout}:${skin}`');
  });

  test('서버는 테마 문자열에서 레이아웃과 컬러 테마를 함께 정규화해야 함', () => {
    const start = serverIndex.indexOf('function normalizeRouletteDefinition');
    const end = serverIndex.indexOf('function makeQuickStartCommandRules', start);
    const body = serverIndex.slice(start, end);

    expect(body).toContain("const allowedLayouts = new Set(['reel', 'wheel'])");
    expect(body).toContain("'studio'");
    expect(body).toContain("'prism'");
    expect(body).toContain("'aurora'");
    expect(body).toContain("'velvet'");
    expect(body).toContain("'mono'");
    expect(body).toContain("'deco'");
    expect(body).toContain("'crystal'");
    expect(body).toContain("'ink'");
    expect(body).toContain("'nova'");
    expect(body).toContain("'ceramic'");
    expect(body).toContain("'arcade'");
    expect(body).toContain("'ocean'");
    expect(body).toContain("'solar'");
    expect(body).toContain('const parsedLayout = themeParts.find((part) => allowedLayouts.has(part))');
    expect(body).toContain('`${parsedLayout}:${parsedTheme}`');
  });

  test('오버레이는 릴/휠 레이아웃을 파싱하고 분리 렌더링해야 함', () => {
    expect(rouletteViewer).toContain("type RouletteLayout = 'reel' | 'wheel'");
    expect(rouletteViewer).toContain('function parseRouletteLook');
    expect(rouletteViewer).toContain("const layout: RouletteLayout = urlLook.layout || serverLayout || 'reel'");
    expect(rouletteViewer).toContain('skinChrome');
    expect(rouletteViewer).toContain('roulette-result-lock');
    expect(rouletteViewer).toContain("layout === 'wheel'");
    expect(rouletteViewer).toContain('renderReelWindow()');
  });

  test('휠 라벨은 SVG 중심 정렬과 스킨별 장식 레이어를 사용해야 함', () => {
    expect(rouletteViewer).toContain('wheelLabelLines');
    expect(rouletteViewer).toContain('WheelSelectedSegment');
    expect(rouletteViewer).toContain('WheelSegmentsSvg');
    expect(rouletteViewer).toContain('WheelSkinOrnaments');
    expect(rouletteViewer).toContain('WheelLabelsSvg');
    expect(rouletteViewer).toContain('selectedWheelIndex');
    expect(rouletteWheelUtils).toContain('function splitWheelLabel');
    expect(rouletteWheelUtils).toContain('const splitAt = Math.ceil(parts.length / 2)');
    expect(rouletteWheelSkins).toContain('textAnchor="middle"');
    expect(rouletteWheelSkins).toContain('dominantBaseline="middle"');
    expect(rouletteWheelSkins).toContain('paintOrder="stroke fill"');
    expect(rouletteWheelSkins).not.toContain('filter="url(#rouletteWheelTextShadow)"');
    expect(rouletteWheelSkins).toContain('rouletteSelectedGlow');
    expect(rouletteWheelSkins).toContain('rouletteSegmentTexture');
    expect(rouletteWheelSkins).toContain('feTurbulence');
    expect(rouletteWheelSkins).toContain('rouletteSegmentFill');
    expect(rouletteWheelSkins).toContain('function segmentPath');
    expect(rouletteWheelSkins).toContain('rouletteVelvetRuby');
    expect(rouletteWheelSkins).toContain('roulettePrismShard');
    expect(rouletteWheelSkins).toContain('rouletteMonoSteel');
    expect(rouletteWheelSkins).toContain('rouletteDecoGold');
    expect(rouletteWheelSkins).toContain('rouletteCrystalIce');
    expect(rouletteWheelSkins).toContain('rouletteInkFeather');
    expect(rouletteWheelSkins).toContain('rouletteNovaStar');
    expect(rouletteWheelSkins).toContain('rouletteCeramicBlue');
    expect(rouletteWheelSkins).toContain('rouletteArcadeNeon');
    expect(rouletteWheelSkins).toContain('roulette-wheel-ornament-secondary');
  });
});
