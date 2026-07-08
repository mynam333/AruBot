'use client';

import { CalendarCheck, Edit3, Loader2, MessageSquare, RefreshCw, Save, Search, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { CommandCreateDialog } from '@/features/admin/admin-action-dialogs';
import { CommandVariableHelpButton } from '@/features/admin/command-variable-help';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { apiUrl, readJson } from '@/shared/api/http';

type BotRule = {
  id: string;
  name?: string;
  keywords?: string[];
  responses?: string[];
  enabled?: boolean;
  adminOnly?: boolean;
  requiredRoleLevel?: number;
  pointsCost?: number;
  cooldown?: number;
  lastUsed?: number;
};

type RulesResponse = {
  rules?: BotRule[];
};

type BotSettingsResponse = {
  settings?: {
    attendanceEnabled?: boolean;
    attendanceAnnounce?: boolean;
    attendanceCommandOnly?: boolean;
    attendanceCommandKeyword?: string;
    attendanceMessage?: string;
    channelPointsPerAttendance?: number;
  };
};

type CommandForm = {
  name: string;
  command: string;
  response: string;
  pointsCost: string;
  cooldownSec: string;
  enabled: boolean;
};

const DEFAULT_ATTENDANCE_MESSAGE = '{user.name}님 출석체크 완료! (연속 {attendance.streak}일, 누적 {attendance.totalDays}일)';
const COMMANDS_PAGE_SIZE = 10;

async function postJson(path: string, body: unknown) {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || 'request_failed');
  return data || {};
}

function getApiErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message && error.message !== 'request_failed') {
    return error.message;
  }
  return fallback;
}

function normalizeCommand(value: string) {
  const text = value.trim();
  if (!text) return '';
  return text.startsWith('!') ? text : `!${text}`;
}

function toForm(rule: BotRule): CommandForm {
  return {
    name: rule.name || '',
    command: rule.keywords?.[0] || '!',
    response: rule.responses?.join('\n') || '',
    pointsCost: String(rule.pointsCost ?? 0),
    cooldownSec: String(Math.max(1, Math.round((rule.cooldown ?? 3000) / 1000))),
    enabled: rule.enabled !== false,
  };
}

export function CommandsPage() {
  const [rules, setRules] = useState<BotRule[]>([]);
  const [query, setQuery] = useState('');
  const [editingRule, setEditingRule] = useState<BotRule | null>(null);
  const [form, setForm] = useState<CommandForm | null>(null);
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const [attendanceEnabled, setAttendanceEnabled] = useState(true);
  const [attendanceAnnounce, setAttendanceAnnounce] = useState(true);
  const [attendanceCommandOnly, setAttendanceCommandOnly] = useState(false);
  const [attendanceCommandKeyword, setAttendanceCommandKeyword] = useState('!출석');
  const [attendanceMessage, setAttendanceMessage] = useState(DEFAULT_ATTENDANCE_MESSAGE);
  const [attendancePoints, setAttendancePoints] = useState('0');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [isPending, startTransition] = useTransition();

  const load = useCallback(() => {
    startTransition(async () => {
      const data = await readJson<RulesResponse>('/api/bot/rules');
      if (!data) {
        setRules([]);
        toast.error('명령어를 불러오지 못했습니다. 로그인 상태를 확인해 주세요.');
        return;
      }
      setRules(data?.rules || []);
    });
  }, []);

  const loadAttendanceSettings = useCallback(async () => {
    const data = await readJson<BotSettingsResponse>('/api/bot/settings');
    const settings = data?.settings || {};
    setAttendanceEnabled(settings.attendanceEnabled !== false);
    setAttendanceAnnounce(settings.attendanceAnnounce !== false);
    setAttendanceCommandOnly(settings.attendanceCommandOnly === true);
    setAttendanceCommandKeyword(settings.attendanceCommandKeyword || '!출석');
    setAttendanceMessage(settings.attendanceMessage || DEFAULT_ATTENDANCE_MESSAGE);
    setAttendancePoints(String(settings.channelPointsPerAttendance ?? 0));
  }, []);

  useEffect(() => {
    load();
    loadAttendanceSettings().catch(() => undefined);
  }, [load, loadAttendanceSettings]);

  useEffect(() => {
    const refresh = (event: Event) => {
      const endpoint = (event as CustomEvent<{ endpoint?: string }>).detail?.endpoint;
      if (!endpoint || endpoint === '/api/bot/rules') load();
    };
    window.addEventListener('arubot:resource-refresh', refresh);
    return () => window.removeEventListener('arubot:resource-refresh', refresh);
  }, [load]);

  const filteredRules = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return rules;
    return rules.filter((rule) => JSON.stringify(rule).toLowerCase().includes(term));
  }, [query, rules]);
  const totalPages = Math.max(1, Math.ceil(filteredRules.length / COMMANDS_PAGE_SIZE));
  const visibleRules = useMemo(() => {
    const currentPage = Math.min(page, totalPages);
    const start = (currentPage - 1) * COMMANDS_PAGE_SIZE;
    return filteredRules.slice(start, start + COMMANDS_PAGE_SIZE);
  }, [filteredRules, page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [query]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const openEdit = (rule: BotRule) => {
    setEditingRule(rule);
    setForm(toForm(rule));
  };

  const closeEdit = () => {
    setEditingRule(null);
    setForm(null);
  };

  const saveEdit = async () => {
    if (!editingRule || !form) return;
    const keyword = normalizeCommand(form.command);
    const responses = form.response.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!keyword || keyword === '!') return toast.warning('명령어를 입력해 주세요.');
    if (!responses.length) return toast.warning('응답 문구를 입력해 주세요.');

    setBusyId(editingRule.id);
    try {
      await postJson('/api/bot/rules/upsert', {
        rule: {
          ...editingRule,
          name: form.name.trim() || keyword,
          keywords: [keyword],
          responses,
          enabled: form.enabled,
          adminOnly: editingRule.adminOnly ?? false,
          requiredRoleLevel: editingRule.requiredRoleLevel ?? 1,
          pointsCost: Math.max(0, Number(form.pointsCost || 0)),
          cooldown: Math.max(1, Number(form.cooldownSec || 1)) * 1000,
          lastUsed: editingRule.lastUsed ?? 0,
        },
      });
      toast.success('명령어를 수정했어요.');
      closeEdit();
      load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, '명령어를 저장하지 못했어요.'));
    } finally {
      setBusyId(null);
    }
  };

  const removeRule = async (rule: BotRule) => {
    if (!window.confirm(`"${rule.name || rule.keywords?.[0] || rule.id}" 명령어를 삭제할까요?`)) return;
    setBusyId(rule.id);
    try {
      await postJson('/api/bot/rules/delete', { id: rule.id });
      toast.success('명령어를 삭제했어요.');
      load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, '명령어를 삭제하지 못했어요.'));
    } finally {
      setBusyId(null);
    }
  };

  const saveAttendanceSettings = async () => {
    setBusyId('attendance');
    try {
      const current = await readJson<BotSettingsResponse>('/api/bot/settings');
      await postJson('/api/bot/settings', {
        settings: {
          ...(current?.settings || {}),
          attendanceEnabled,
          attendanceAnnounce,
          attendanceCommandOnly,
          attendanceCommandKeyword: normalizeCommand(attendanceCommandKeyword || '!출석'),
          attendanceMessage: attendanceMessage.trim() || DEFAULT_ATTENDANCE_MESSAGE,
          channelPointsPerAttendance: Math.max(0, Number(attendancePoints || 0)),
        },
      });
      toast.success('출석 설정을 저장했습니다.');
      setAttendanceOpen(false);
      await loadAttendanceSettings();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '출석 설정을 저장하지 못했습니다.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="grid gap-[clamp(1rem,2vw,1.5rem)]">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-primary/12 text-primary">
                  <MessageSquare className="h-5 w-5" />
                </span>
                <Badge tone="sky">채팅 명령어</Badge>
                <Badge tone="mint">{rules.length}개</Badge>
              </div>
              <CardTitle>시청자가 바로 쓰는 명령어</CardTitle>
              <CardDescription>자주 묻는 안내부터 포인트 참여까지, 채팅 한 줄로 바로 반응하게 만들어요.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <CommandCreateDialog />
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
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="명령어, 이름, 답변으로 찾기" className="pl-9" />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-[linear-gradient(135deg,hsl(var(--card)),hsl(var(--accent-lemon)/0.22),hsl(var(--accent-mint)/0.18))]">
        <CardContent className="flex flex-col gap-4 p-[clamp(1rem,2vw,1.35rem)] lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-background/70 text-primary shadow-subtle">
              <CalendarCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold">출석 체크</h2>
                <Badge tone={attendanceEnabled ? 'mint' : 'neutral'}>{attendanceEnabled ? '사용 중' : '꺼짐'}</Badge>
                <Badge tone={attendanceCommandOnly ? 'sky' : 'lemon'}>{attendanceCommandOnly ? `${attendanceCommandKeyword || '!출석'} 전용` : '첫 채팅 자동'}</Badge>
                <Badge tone={attendanceAnnounce ? 'mint' : 'neutral'}>{attendanceAnnounce ? '메시지 표시' : '메시지 숨김'}</Badge>
                <Badge tone="lemon">{Number(attendancePoints || 0).toLocaleString('ko-KR')}P 지급</Badge>
              </div>
              <p className="mt-2 max-w-3xl break-keep text-sm leading-6 text-muted-foreground">
                첫 채팅 자동 기록 또는 지정 명령어 전용 기록 중 방송 운영 방식에 맞게 선택합니다.
              </p>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={() => setAttendanceOpen(true)}>
            <CalendarCheck className="h-4 w-4" />
            출석 설정
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {visibleRules.map((rule) => (
          <Card key={rule.id} className="overflow-hidden">
            <CardContent className="grid gap-4 p-[clamp(1rem,2vw,1.35rem)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)_minmax(var(--control-height),0.42fr)] lg:items-center">
              <div className="min-w-0">
                <div className="flex max-w-full items-center gap-2 overflow-x-auto pb-1">
                  <Badge tone={rule.enabled === false ? 'neutral' : 'mint'}>{rule.enabled === false ? '꺼짐' : '사용 중'}</Badge>
                  <code className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-bold">{rule.keywords?.[0] || '-'}</code>
                </div>
                <div className="mt-2 truncate text-base font-bold">{rule.name || rule.keywords?.[0] || '이름 없는 명령어'}</div>
                <div className="mt-1 text-xs text-muted-foreground">포인트 {Number(rule.pointsCost || 0).toLocaleString('ko-KR')} · 쿨다운 {Math.round((rule.cooldown || 0) / 1000)}초</div>
              </div>
              <div className="min-w-0 max-w-full overflow-x-auto rounded-[var(--radius-control)] bg-background/45 p-[clamp(0.75rem,1.4vw,1rem)]">
                <p className="w-max max-w-[42rem] whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{rule.responses?.join('\n') || '응답 문구가 없습니다.'}</p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => openEdit(rule)}>
                  <Edit3 className="h-4 w-4" />
                  수정
                </Button>
                <Button type="button" variant="destructive" size="sm" onClick={() => removeRule(rule)} disabled={busyId === rule.id}>
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
              {isPending ? '명령어를 불러오는 중입니다.' : '조건에 맞는 명령어가 없습니다.'}
            </CardContent>
          </Card>
        ) : null}
      </div>
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />

      {editingRule && form ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/55 p-[clamp(1rem,4vw,2rem)] backdrop-blur-sm">
          <div className="grid max-h-[min(92svh,48rem)] w-full max-w-2xl gap-5 overflow-y-auto rounded-[var(--radius-panel)] border bg-card p-[clamp(1rem,2.4vw,1.5rem)] shadow-lift">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Badge tone="sky">명령어 수정</Badge>
                <h2 className="mt-3 text-xl font-bold">채팅 반응을 다듬어요.</h2>
                <p className="mt-2 break-keep text-sm leading-6 text-muted-foreground">다음 입력부터 시청자에게 새 답변이 자연스럽게 나갑니다.</p>
              </div>
              <CommandVariableHelpButton />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-semibold">
                표시 이름
                <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                채팅 명령어
                <Input value={form.command} onChange={(event) => setForm({ ...form, command: event.target.value })} />
              </label>
            </div>
            <label className="grid gap-2 text-sm font-semibold">
              응답 문구
              <textarea
                value={form.response}
                onChange={(event) => setForm({ ...form, response: event.target.value })}
                className="box-border min-h-[clamp(7rem,18svh,11rem)] w-full min-w-0 max-w-full resize-y rounded-[var(--radius-control)] border bg-background/80 px-[clamp(0.85rem,1.6vw,1.1rem)] py-[clamp(0.85rem,1.6vw,1.1rem)] text-sm leading-7 outline-none focus:border-primary/45 focus:ring-2 focus:ring-ring"
              />
            </label>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(var(--control-height),0.42fr)] md:items-end">
              <label className="grid gap-2 text-sm font-semibold">
                사용 포인트
                <Input value={form.pointsCost} onChange={(event) => setForm({ ...form, pointsCost: event.target.value })} inputMode="numeric" />
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                쿨다운(초)
                <Input value={form.cooldownSec} onChange={(event) => setForm({ ...form, cooldownSec: event.target.value })} inputMode="numeric" />
              </label>
              <Button type="button" variant={form.enabled ? 'soft' : 'outline'} onClick={() => setForm({ ...form, enabled: !form.enabled })}>
                {form.enabled ? '사용 중' : '꺼짐'}
              </Button>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeEdit}>취소</Button>
              <Button type="button" onClick={saveEdit} disabled={busyId === editingRule.id}>
                {busyId === editingRule.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Edit3 className="h-4 w-4" />}
                저장
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {attendanceOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/55 p-[clamp(1rem,4vw,2rem)] backdrop-blur-sm">
          <div className="grid max-h-[min(92svh,44rem)] w-full max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[var(--radius-panel)] border bg-card shadow-lift">
            <div className="flex items-start justify-between gap-4 border-b p-[clamp(1rem,2.4vw,1.5rem)]">
              <div>
                <Badge tone="lemon">출석 설정</Badge>
                <h2 className="mt-3 text-xl font-bold">출석 기록 방식을 정합니다.</h2>
                <p className="mt-2 break-keep text-sm leading-6 text-muted-foreground">
                  첫 채팅 자동 출석과 지정 명령어 출석 중 선택할 수 있습니다. 출석 포인트는 시청자 포인트에 함께 적립됩니다.
                </p>
              </div>
              <Button type="button" variant="outline" size="icon" onClick={() => setAttendanceOpen(false)} aria-label="닫기">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid min-h-0 gap-4 overflow-y-auto p-[clamp(1rem,2.4vw,1.5rem)]">
              <div className="grid gap-3 rounded-[var(--radius-control)] border bg-background/70 p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Button type="button" variant={attendanceEnabled ? 'soft' : 'outline'} onClick={() => setAttendanceEnabled((value) => !value)}>
                    {attendanceEnabled ? '출석 기능 사용' : '출석 기능 꺼짐'}
                  </Button>
                  <Button type="button" variant={attendanceCommandOnly ? 'soft' : 'outline'} onClick={() => setAttendanceCommandOnly((value) => !value)} disabled={!attendanceEnabled}>
                    {attendanceCommandOnly ? '명령어로만 출석' : '첫 채팅 자동 출석'}
                  </Button>
                </div>
                <label className="grid gap-2 text-sm font-semibold">
                  출석 명령어
                  <Input
                    value={attendanceCommandKeyword}
                    onChange={(event) => setAttendanceCommandKeyword(event.target.value)}
                    disabled={!attendanceEnabled}
                    placeholder="!출석"
                  />
                </label>
                <p className="text-xs leading-5 text-muted-foreground">
                  명령어 전용 모드를 켜면 일반 첫 채팅은 출석으로 기록하지 않고, 이 명령어를 입력했을 때만 출석을 기록합니다.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(var(--control-height),0.42fr)] md:items-end">
                <label className="grid gap-2 text-sm font-semibold">
                  출석 포인트
                  <Input value={attendancePoints} onChange={(event) => setAttendancePoints(event.target.value)} inputMode="numeric" disabled={!attendanceEnabled} />
                </label>
                <Button type="button" variant={attendanceAnnounce ? 'soft' : 'outline'} onClick={() => setAttendanceAnnounce((value) => !value)} disabled={!attendanceEnabled}>
                  {attendanceAnnounce ? '출석 메시지 표시' : '출석 메시지 숨김'}
                </Button>
              </div>
              <label className="grid gap-2 text-sm font-semibold">
                출석 메시지
                <textarea
                  value={attendanceMessage}
                  onChange={(event) => setAttendanceMessage(event.target.value)}
                  disabled={!attendanceEnabled}
                  className="box-border min-h-[clamp(8rem,20svh,12rem)] w-full min-w-0 max-w-full resize-y rounded-[var(--radius-control)] border bg-background/80 px-[clamp(0.85rem,1.6vw,1.1rem)] py-[clamp(0.85rem,1.6vw,1.1rem)] text-sm leading-7 outline-none focus:border-primary/45 focus:ring-2 focus:ring-ring"
                />
              </label>
              <div className="rounded-[var(--radius-control)] border bg-background/70 p-3 text-sm leading-6 text-muted-foreground">
                사용 가능한 변수: <code>{'{user.name}'}</code>, <code>{'{user.id}'}</code>, <code>{'{attendance.streak}'}</code>, <code>{'{attendance.totalDays}'}</code>, <code>{'{attendance.points}'}</code>, <code>{'{attendance.date}'}</code>
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t bg-background/64 p-[clamp(1rem,2.4vw,1.5rem)] sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => setAttendanceOpen(false)}>취소</Button>
              <Button type="button" onClick={saveAttendanceSettings} disabled={busyId === 'attendance'}>
                {busyId === 'attendance' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                저장
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
