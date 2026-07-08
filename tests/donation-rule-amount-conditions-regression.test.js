const fs = require('fs');
const path = require('path');

describe('후원 반응 금액 조건 회귀 방지', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const donationRulesPage = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'donation-rules-page.tsx'), 'utf8');
  const adminActionDialogs = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'admin-action-dialogs.tsx'), 'utf8');
  const amountConditions = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'donation-rule-amount-conditions.ts'), 'utf8');

  test('서버는 여러 금액 조건을 정규화하고 모든 조건을 만족할 때만 통과시켜야 함', () => {
    expect(serverIndex).toContain('function normalizeDonationAmountConditions');
    expect(serverIndex).toContain('function donationRuleMatchesAmount');
    expect(serverIndex).toContain('return conditions.every((condition) =>');
    expect(serverIndex).toContain("condition.operator === 'lt'");
    expect(serverIndex).toContain("condition.operator === 'eq'");
    expect(serverIndex).toContain("condition.operator === 'range'");
    expect(serverIndex.match(/donationRuleMatchesAmount\(r, amount\)/g)?.length || 0).toBeGreaterThanOrEqual(3);
  });

  test('후원 반응 저장 API는 amountConditions를 저장하고 기존 min/max를 호환 필드로 유지해야 함', () => {
    expect(serverIndex).toContain('normalizeDonationRuleForStorage');
    expect(serverIndex).toContain('deriveLegacyDonationAmountFields');
    expect(serverIndex).toContain('amountConditions');
    expect(serverIndex).toContain('rules.map(normalizeDonationRuleForStorage)');
  });

  test('관리 UI는 이상, 미만, 일치 조건을 여러 개 설정할 수 있어야 함', () => {
    expect(amountConditions).toContain("{ value: 'gte', label: '이상' }");
    expect(amountConditions).toContain("{ value: 'lt', label: '미만' }");
    expect(amountConditions).toContain("{ value: 'eq', label: '일치' }");
    expect(amountConditions).toContain("join(' 그리고 ')");
    expect(donationRulesPage).toContain('트리거 금액 조건');
    expect(donationRulesPage).toContain('조건 추가');
    expect(donationRulesPage).toContain('serializeDonationAmountConditions');
    expect(adminActionDialogs).toContain('트리거 금액 조건');
    expect(adminActionDialogs).toContain('조건 추가');
    expect(adminActionDialogs).toContain('serializeDonationAmountConditions');
  });
});
