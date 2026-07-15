const fs = require('fs');
const path = require('path');

describe('룰렛 생성 실행 비용 분리 회귀 방지', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'features', 'admin', 'admin-action-dialogs.tsx'),
    'utf8',
  );
  const commandStart = source.indexOf('export function CommandCreateDialog');
  const commandEnd = source.indexOf('function SwitchRow', commandStart);
  const commandDialog = source.slice(commandStart, commandEnd);
  const rouletteStart = source.indexOf('export function RouletteCreateDialog');
  const rouletteEnd = source.indexOf('export function VideoDonationSettingsDialog', rouletteStart);
  const rouletteDialog = source.slice(rouletteStart, rouletteEnd);

  test('룰렛 만들기에는 실행 비용 입력과 비용 상태가 없어야 함', () => {
    expect(rouletteDialog).not.toContain('Field label="실행 비용"');
    expect(rouletteDialog).not.toContain('setPointsCost');
    expect(rouletteDialog).not.toContain("useState('0')");
  });

  test('룰렛과 함께 만드는 기본 명령어는 무료로 생성되어야 함', () => {
    expect(rouletteDialog).toContain('pointsCost: 0');
    expect(rouletteDialog).not.toContain('Number(pointsCost');
  });

  test('명령어 만들기의 포인트 비용 설정은 유지해야 함', () => {
    expect(commandDialog).toContain("const [pointsCost, setPointsCost] = useState('0')");
    expect(commandDialog).toContain('Field label="사용 포인트"');
    expect(commandDialog).toContain('pointsCost: Math.max(0, Number(pointsCost || 0))');
  });
});
