const fs = require('fs');
const path = require('path');

describe('카운트 변수 관리 UI 회귀 방지', () => {
  const root = path.join(__dirname, '..');
  const variableHelp = fs.readFileSync(
    path.join(root, 'src', 'features', 'admin', 'command-variable-help.tsx'),
    'utf8'
  );
  const variablesPage = fs.readFileSync(
    path.join(root, 'src', 'features', 'admin', 'variables-page.tsx'),
    'utf8'
  );
  const actionDialogs = fs.readFileSync(
    path.join(root, 'src', 'features', 'admin', 'admin-action-dialogs.tsx'),
    'utf8'
  );
  const blueprintPage = fs.readFileSync(
    path.join(root, 'src', 'features', 'admin', 'action-blueprint-page.tsx'),
    'utf8'
  );

  test('변수 메타데이터는 지원 실행 문맥을 표현하고 현재 문맥 밖의 변수를 숨긴다', () => {
    expect(variableHelp).toContain("type VariableContext = 'command' | 'attendance' | 'donation' | 'blueprint'");
    expect(variableHelp).toContain('contexts?: VariableContext[]');
    expect(variableHelp).toContain('!variable.contexts?.length || variable.contexts.includes(scope)');
    expect(variableHelp).toContain("scope = 'command'");
    const attendanceGroups = variableHelp.match(/const ATTENDANCE_VARIABLE_GROUPS = new Set\(\[([^\]]*)\]\)/)?.[1] || '';
    expect(attendanceGroups).not.toContain("'카운트'");
    expect(variablesPage).toContain('contexts?: VariableContext[]');
  });

  test('후원과 블루프린트 도움말은 각 실행 문맥만 요청한다', () => {
    const donationStart = actionDialogs.indexOf('export function DonationRuleCreateDialog');
    const donationEnd = actionDialogs.indexOf('export function', donationStart + 1);
    expect(actionDialogs.slice(donationStart, donationEnd)).toContain(
      '<CommandVariableHelpButton scope="donation" />'
    );

    const configFieldsStart = blueprintPage.indexOf('function ConfigFields');
    const conditionStart = blueprintPage.indexOf("if (node.type === 'condition' || node.type === 'rouletteCompare')", configFieldsStart);
    const conditionEnd = blueprintPage.indexOf("if (node.type === 'action')", conditionStart);
    expect(blueprintPage.slice(conditionStart, conditionEnd)).toContain(
      '<CommandVariableHelpButton scope="blueprint" />'
    );
  });

  test('카운트 안내는 증가한 값을 표시한다는 동작과 적용 위치를 명확히 보여준다', () => {
    expect(variablesPage).toContain("if (group === '카운트')");
    expect(variablesPage).toContain('사용할 때마다 1씩 증가하고, 증가한 현재 값이 변수 자리에 표시됩니다.');
    expect(variablesPage).toContain('contextLabel(context)');
    expect(variablesPage).toContain('aria-label="사용 위치"');
  });

  test('긴 변수 토큰은 카드 폭을 넘지 않고 복사 버튼 이름과 장식 아이콘 구분을 제공한다', () => {
    expect(variablesPage).toContain('min-w-0 overflow-hidden');
    expect(variablesPage).toContain('max-w-full break-all whitespace-normal');
    expect(variablesPage).toContain('aria-label={`${item.label} ${item.key} 변수 복사`}');
    expect(variablesPage).toContain('<Copy aria-hidden="true"');
    expect(variableHelp).toContain('<CircleHelp aria-hidden="true"');
    expect(variableHelp).toContain('<Copy aria-hidden="true"');
  });
});
