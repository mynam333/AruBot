'use client';

import { useBotChannel } from '@/components/app-shell/bot-channel-provider';

import { Edit3, Gift, Loader2, Plus, RefreshCw, Search, Settings2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { DonationRuleCreateDialog, DonationSettingsDialog } from '@/features/admin/admin-action-dialogs';
import { CommandVariableHelpButton } from '@/features/admin/command-variable-help';
import { DonationTestDialog } from './donation-test-dialog';
import { RegexSwitch } from './regex-switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiUrl, readJson } from '@/shared/api/http';
import {
  deriveLegacyAmountFields,
  describeDonationAmountRule,
  DONATION_AMOUNT_OPERATOR_OPTIONS,
  normalizeDonationAmountConditionForms,
  serializeDonationAmountConditions,
  type DonationAmountCondition,
  type DonationAmountConditionForm,
  type DonationAmountOperator,
} from './donation-rule-amount-conditions';

type DonationRule = {
  id: string;
  name?: string;
  enabled?: boolean;
  minAmount?: number;
  maxAmount?: number | null;
  amountConditions?: DonationAmountCondition[];
  message?: string;
  wildcard?: boolean;
  regex?: boolean;
  response?: string;
  lastUsed?: number;
};

type DonationRulesResponse = {
  rules?: DonationRule[];
};

type DonationForm = {
  name: string;
  amountConditions: DonationAmountConditionForm[];
  message: string;
  regex: boolean;
  response: string;
  enabled: boolean;
};

async function postJson(path: string, body: unknown) {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '요청을 처리하지 못했습니다.');
  return data;
}

function toForm(rule: DonationRule): DonationForm {
  return {
    name: rule.name || '',
    amountConditions: normalizeDonationAmountConditionForms(rule),
    message: rule.message || '',
    regex: rule.regex === true,
    response: rule.response || '',
    enabled: rule.enabled !== false,
  };
}

function amountRange(rule: DonationRule) {
  return describeDonationAmountRule(rule);
}

export function DonationRulesPage() {
  const { canWrite } = useBotChannel();
  const writable = canWrite('donations');
  const [rules, setRules] = useState<DonationRule[]>([]);
  const [query, setQuery] = useState('');
  const [editingRule, setEditingRule] = useState<DonationRule | null>(null);
  const [form, setForm] = useState<DonationForm | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const load = useCallback(() => {
    startTransition(async () => {
      const data = await readJson<DonationRulesResponse>('/api/donation/rules');
      if (!data) {
        toast.error('후원 반응을 불러오지 못했습니다. 다시 시도해 주세요.');
        return;
      }
      setRules(data?.rules || []);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const refresh = (event: Event) => {
      const endpoint = (event as CustomEvent<{ endpoint?: string }>).detail?.endpoint;
      if (!endpoint || endpoint === '/api/donation/rules') load();
    };
    window.addEventListener('arubot:resource-refresh', refresh);
    return () => window.removeEventListener('arubot:resource-refresh', refresh);
  }, [load]);

  const filteredRules = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return rules;
    return rules.filter((rule) => JSON.stringify(rule).toLowerCase().includes(term));
  }, [query, rules]);

  const openEdit = (rule: DonationRule) => {
    if (!writable) return;
    setEditingRule(rule);
    setForm(toForm(rule));
  };

  const closeEdit = () => {
    setEditingRule(null);
    setForm(null);
  };

  const saveEdit = async () => {
    if (!writable) return;
    if (!editingRule || !form) return;
    if (!form.response.trim()) return toast.warning('후원 반응 문구를 입력해 주세요.');
    const amountConditions = serializeDonationAmountConditions(form.amountConditions);
    if (!amountConditions.length) return toast.warning('금액 조건을 하나 이상 입력해 주세요.');
    const legacyAmounts = deriveLegacyAmountFields(amountConditions);
    setBusyId(editingRule.id);
    try {
      await postJson('/api/donation/rules/upsert', {
        rule: {
          ...editingRule,
          name: form.name.trim() || `${describeDonationAmountRule({ amountConditions })} 반응`,
          enabled: form.enabled,
          ...legacyAmounts,
          amountConditions,
          message: form.message.trim(),
          regex: form.regex,
          wildcard: editingRule.wildcard ?? true,
          response: form.response.trim(),
        },
      });
      toast.success('후원 반응을 수정했어요.');
      closeEdit();
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '후원 반응을 저장하지 못했어요.');
    } finally {
      setBusyId(null);
    }
  };

  const removeRule = async (rule: DonationRule) => {
    if (!writable) return;
    if (!window.confirm(`"${rule.name || rule.id}" 후원 반응을 삭제할까요?`)) return;
    setBusyId(rule.id);
    try {
      await postJson('/api/donation/rules/delete', { id: rule.id });
      toast.success('후원 반응을 삭제했어요.');
      load();
    } catch {
      toast.error('후원 반응을 삭제하지 못했어요.');
    } finally {
      setBusyId(null);
    }
  };

  const updateAmountCondition = (id: string, patch: Partial<DonationAmountConditionForm>) => {
    if (!form) return;
    setForm({
      ...form,
      amountConditions: form.amountConditions.map((condition) => (
        condition.id === id ? { ...condition, ...patch } : condition
      )),
    });
  };

  const addAmountCondition = () => {
    if (!form) return;
    setForm({
      ...form,
      amountConditions: [
        ...form.amountConditions,
        { id: `cond_${Date.now().toString(36)}`, operator: 'gte', amount: '1000', amountTo: '' },
      ],
    });
  };

  const removeAmountCondition = (id: string) => {
    if (!form) return;
    if (form.amountConditions.length <= 1) return toast.warning('금액 조건은 하나 이상 필요합니다.');
    setForm({
      ...form,
      amountConditions: form.amountConditions.filter((condition) => condition.id !== id),
    });
  };

  return (
    <div className="grid gap-[clamp(1rem,2vw,1.5rem)]">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-primary/12 text-primary">
                  <Gift className="h-5 w-5" />
                </span>
                <Badge tone="coral">후원 반응</Badge>
                <Badge tone="mint">{rules.length}개</Badge>
              </div>
              <CardTitle>후원 메시지에 맞춰 반응하기</CardTitle>
              <CardDescription>금액과 메시지 조건에 따라 채팅 응답을 자동으로 보냅니다.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <DonationRuleCreateDialog />
              <DonationTestDialog />
              <DonationSettingsDialog variant="outline" label="포인트 설정" />
              <Button type="button" variant="outline" onClick={load} disabled={isPending}>
                <RefreshCw className={isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                새로고침
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="반응 이름, 조건, 문구로 찾기" className="pl-9" />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {filteredRules.map((rule) => (
          <Card key={rule.id} className="overflow-hidden">
            <CardContent className="grid gap-4 p-[clamp(1rem,2vw,1.35rem)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)_minmax(var(--control-height),0.42fr)] lg:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={rule.enabled === false ? 'neutral' : 'mint'}>{rule.enabled === false ? '꺼짐' : '사용 중'}</Badge>
                  <Badge tone="lemon">{amountRange(rule)}</Badge>
                </div>
                <div className="mt-2 truncate text-base font-bold">{rule.name || '이름 없는 후원 반응'}</div>
                <div className="mt-1 break-all text-xs text-muted-foreground">{rule.message ? `${rule.regex ? '정규식' : rule.wildcard ? '메시지 포함' : '메시지 시작'}: ${rule.message}` : '메시지 조건 없음'}</div>
              </div>
              <p className="min-w-0 whitespace-pre-wrap break-keep text-sm leading-6 text-muted-foreground">{rule.response || '반응 문구가 없습니다.'}</p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button disabled={!writable} type="button" variant="outline" size="sm" onClick={() => openEdit(rule)}>
                  <Edit3 className="h-4 w-4" />
                  수정
                </Button>
                <Button type="button" variant="destructive" size="sm" onClick={() => removeRule(rule)} disabled={!writable || (busyId === rule.id)}>
                  {busyId === rule.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  삭제
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {!filteredRules.length ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              {isPending ? '후원 반응을 불러오는 중입니다.' : '조건에 맞는 후원 반응이 없습니다.'}
            </CardContent>
          </Card>
        ) : null}
      </div>

      {editingRule && form ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/55 p-[clamp(1rem,4vw,2rem)] backdrop-blur-sm">
          <div className="grid max-h-[min(92svh,48rem)] w-full max-w-2xl gap-5 overflow-y-auto rounded-[var(--radius-panel)] border bg-card p-[clamp(1rem,2.4vw,1.5rem)] shadow-lift">
            <div>
              <Badge tone="coral">후원 반응 수정</Badge>
              <h2 className="mt-3 text-xl font-bold">후원 순간의 반응을 다듬어요.</h2>
              <p className="mt-2 text-sm text-muted-foreground">다음 후원부터 방송 분위기에 맞는 새 반응이 나갑니다.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-semibold">
                반응 이름
                <Input disabled={!writable} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                {form.regex ? '메시지 정규식' : '메시지 조건'}
                <Input disabled={!writable} value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} placeholder={form.regex ? '(룰렛|돌려줘)' : '특정 문구가 없으면 금액만 볼게요.'} maxLength={form.regex ? 256 : undefined} />
              </label>
            </div>
            <RegexSwitch checked={form.regex} onCheckedChange={(regex) => setForm({ ...form, regex })} disabled={!writable} />
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">트리거 금액 조건</div>
                <Button disabled={!writable} type="button" variant="outline" size="sm" onClick={addAmountCondition}>
                  <Plus className="h-4 w-4" />
                  조건 추가
                </Button>
              </div>
              <div className="grid gap-2">
                {form.amountConditions.map((condition) => (
                  <div key={condition.id} className="grid gap-2 rounded-[var(--radius-control)] border bg-background/55 p-3 md:grid-cols-[minmax(8rem,0.36fr)_minmax(0,1fr)_minmax(0,1fr)_var(--control-height)] md:items-center">
                    <select disabled={!writable}
                      value={condition.operator}
                      onChange={(event) => updateAmountCondition(condition.id, { operator: event.target.value as DonationAmountOperator })}
                      className="min-h-[var(--control-height)] rounded-[var(--radius-control)] border bg-background px-3 text-sm"
                    >
                      {DONATION_AMOUNT_OPERATOR_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <Input disabled={!writable}
                      value={condition.amount}
                      onChange={(event) => updateAmountCondition(condition.id, { amount: event.target.value })}
                      inputMode="numeric"
                      placeholder={condition.operator === 'range' ? '시작 금액' : '금액'}
                    />
                    {condition.operator === 'range' ? (
                      <Input disabled={!writable}
                        value={condition.amountTo}
                        onChange={(event) => updateAmountCondition(condition.id, { amountTo: event.target.value })}
                        inputMode="numeric"
                        placeholder="끝 금액"
                      />
                    ) : (
                      <div className="hidden md:block" />
                    )}
                    <Button disabled={!writable} type="button" variant="ghost" size="icon" aria-label="금액 조건 삭제" onClick={() => removeAmountCondition(condition.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button disabled={!writable} type="button" variant={form.enabled ? 'soft' : 'outline'} onClick={() => setForm({ ...form, enabled: !form.enabled })}>
                {form.enabled ? '사용 중' : '꺼짐'}
              </Button>
            </div>
            <div className="grid gap-2 text-sm font-semibold">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="donation-response-edit">반응 문구</label>
                <CommandVariableHelpButton scope="donation" onInsert={writable ? (key) => setForm((current) => current ? { ...current, response: current.response + key } : current) : undefined} />
              </div>
              <textarea id="donation-response-edit" disabled={!writable}
                value={form.response}
                onChange={(event) => setForm({ ...form, response: event.target.value })}
                className="box-border min-h-[clamp(7rem,18svh,11rem)] w-full min-w-0 max-w-full resize-y rounded-[var(--radius-control)] border bg-background/80 px-[clamp(0.85rem,1.6vw,1.1rem)] py-[clamp(0.85rem,1.6vw,1.1rem)] text-sm leading-7 outline-none focus:border-primary/45 focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeEdit}>취소</Button>
              <Button type="button" onClick={saveEdit} disabled={!writable || (busyId === editingRule.id)}>
                {busyId === editingRule.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings2 className="h-4 w-4" />}
                저장
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
