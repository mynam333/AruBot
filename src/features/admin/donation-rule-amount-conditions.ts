export type DonationAmountOperator = 'gte' | 'lt' | 'eq' | 'range';

export type DonationAmountCondition = {
  id?: string;
  operator: DonationAmountOperator;
  amount: number;
  amountTo?: number | null;
};

export type DonationAmountConditionForm = {
  id: string;
  operator: DonationAmountOperator;
  amount: string;
  amountTo: string;
};

export type DonationAmountRuleSource = {
  amountConditions?: DonationAmountCondition[];
  minAmount?: number | null;
  maxAmount?: number | null;
};

export const DONATION_AMOUNT_OPERATOR_OPTIONS: Array<{ value: DonationAmountOperator; label: string }> = [
  { value: 'gte', label: '이상' },
  { value: 'lt', label: '미만' },
  { value: 'eq', label: '일치' },
  { value: 'range', label: '범위' },
];

export function createDonationAmountConditionForm(operator: DonationAmountOperator = 'gte', amount = '1000'): DonationAmountConditionForm {
  return {
    id: `cond_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    operator,
    amount,
    amountTo: '',
  };
}

function normalizeOperator(value: unknown): DonationAmountOperator {
  const text = String(value || '').toLowerCase();
  if (text === 'lt' || text === 'below' || text === 'less_than') return 'lt';
  if (text === 'eq' || text === 'equal' || text === 'equals') return 'eq';
  if (text === 'range' || text === 'between') return 'range';
  return 'gte';
}

function normalizeNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export function normalizeDonationAmountConditionForms(rule?: DonationAmountRuleSource | null): DonationAmountConditionForm[] {
  const conditions = Array.isArray(rule?.amountConditions) ? rule.amountConditions : [];
  const normalized = conditions
    .map((condition) => {
      const operator = normalizeOperator(condition.operator);
      return {
        id: condition.id || createDonationAmountConditionForm().id,
        operator,
        amount: String(normalizeNumber(condition.amount)),
        amountTo: operator === 'range' && condition.amountTo != null ? String(normalizeNumber(condition.amountTo)) : '',
      };
    })
    .filter((condition) => condition.amount !== '');
  if (normalized.length) return normalized;

  const min = normalizeNumber(rule?.minAmount ?? 0);
  const max = rule?.maxAmount == null ? null : normalizeNumber(rule.maxAmount);
  if (max != null && max > 0) {
    return [{ ...createDonationAmountConditionForm('range', String(min)), amountTo: String(max) }];
  }
  return [createDonationAmountConditionForm('gte', String(min))];
}

export function serializeDonationAmountConditions(forms: DonationAmountConditionForm[]): DonationAmountCondition[] {
  return forms
    .map((form) => {
      const operator = normalizeOperator(form.operator);
      const amount = normalizeNumber(form.amount);
      const amountTo = operator === 'range' && form.amountTo.trim() ? normalizeNumber(form.amountTo) : null;
      return {
        id: form.id,
        operator,
        amount,
        amountTo,
      };
    })
    .filter((condition) => condition.operator !== 'range' || Number(condition.amountTo || 0) >= condition.amount);
}

export function deriveLegacyAmountFields(conditions: DonationAmountCondition[]) {
  const first = conditions[0];
  if (!first) return { minAmount: 0, maxAmount: null as number | null };
  if (first.operator === 'range') return { minAmount: Number(first.amount || 0), maxAmount: Number(first.amountTo || 0) || null };
  if (first.operator === 'lt') return { minAmount: 0, maxAmount: Number(first.amount || 0) };
  if (first.operator === 'eq') return { minAmount: Number(first.amount || 0), maxAmount: Number(first.amount || 0) };
  return { minAmount: Number(first.amount || 0), maxAmount: null as number | null };
}

export function describeDonationAmountCondition(condition: DonationAmountCondition) {
  const amount = Number(condition.amount || 0).toLocaleString('ko-KR');
  if (condition.operator === 'lt') return `${amount}원 미만`;
  if (condition.operator === 'eq') return `${amount}원 일치`;
  if (condition.operator === 'range') {
    const end = Number(condition.amountTo || 0).toLocaleString('ko-KR');
    return `${amount}원 - ${end}원`;
  }
  return `${amount}원 이상`;
}

export function describeDonationAmountRule(rule?: DonationAmountRuleSource | null) {
  const conditions = serializeDonationAmountConditions(normalizeDonationAmountConditionForms(rule));
  if (!conditions.length) return '금액 조건 없음';
  return conditions.map(describeDonationAmountCondition).join(' 그리고 ');
}
