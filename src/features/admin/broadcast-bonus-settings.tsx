import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, Save } from 'lucide-react';
import { BROADCAST_BONUS_CATEGORIES, MAX_BROADCAST_BONUS } from '../../../shared/broadcast-bonus.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiUrl, readJson } from '@/shared/api/http';

type Bonus = { live: boolean; sessionKey: string | null; amount: number; categories: string[] };
type Draft = { sessionKey: string; amount: string; categories: string[] };
const endpoint = '/api/points/broadcast-bonus';

function isBonus(data: Bonus | null): data is Bonus {
  return !!data && typeof data.live === 'boolean'
    && (data.live ? typeof data.sessionKey === 'string' && !!data.sessionKey : data.sessionKey === null)
    && Number.isSafeInteger(data.amount) && data.amount >= 0 && data.amount <= MAX_BROADCAST_BONUS
    && Array.isArray(data.categories) && data.categories.every((id) => BROADCAST_BONUS_CATEGORIES.some((c) => c.id === id));
}

export function BroadcastBonusSettings({ writable }: { writable: boolean }) {
  const [saved, setSaved] = useState<Bonus | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const read = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const mounted = useRef(false);

  const refresh = useCallback(async () => {
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    const next = await readJson<Bonus>(endpoint, { signal: controller.signal });
    if (controller.signal.aborted) return;
    read.current = null;
    if (!isBonus(next)) {
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setSaved(next);
    setDraft((previous) => previous?.sessionKey === next.sessionKey ? previous : null);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const recheck = () => {
      if (!document.hidden && !writing.current && !read.current) void refresh();
    };
    const timer = window.setInterval(recheck, 30_000);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      mounted.current = false;
      read.current?.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [refresh]);

  const live = saved?.live === true && !!saved.sessionKey;
  const editable = writable && live && !loadFailed && !saving;
  const amount = draft?.amount ?? (live ? String(saved.amount) : '');
  const categories = draft?.categories ?? (live ? saved.categories : []);
  const value = Number(amount);
  const validAmount = /^\d+$/.test(amount) && Number.isSafeInteger(value) && value <= MAX_BROADCAST_BONUS;
  const invalidCategories = value > 0 && categories.length === 0;
  const changed = saved && (value !== saved.amount || categories.length !== saved.categories.length
    || categories.some((id) => !saved.categories.includes(id)));
  const canSave = editable && changed && validAmount && !invalidCategories;

  function edit(nextAmount: string, nextCategories: string[]) {
    if (!editable || !saved?.sessionKey) return;
    setNotice('');
    setDraft({ sessionKey: saved.sessionKey, amount: nextAmount, categories: nextCategories });
  }

  async function save() {
    if (!canSave || !saved?.sessionKey || writing.current) return;
    writing.current = true;
    read.current?.abort();
    setSaving(true);
    setNotice('');
    try {
      const response = await fetch(apiUrl(endpoint), {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionKey: saved.sessionKey, amount: value, categories }),
      });
      if (!mounted.current) return;
      if (response.ok) {
        setDraft(null);
        setNotice(value === 0 ? '방송 한정 포인트를 껐습니다.' : '방송 한정 포인트를 저장했습니다.');
      } else if (response.status === 409) {
        setDraft(null);
        setNotice('방송 상태가 바뀌었습니다. 현재 방송을 확인해 주세요.');
      } else {
        setNotice(response.status === 403 ? '포인트 쓰기 권한이 없습니다.' : '저장하지 못했습니다. 다시 시도해 주세요.');
      }
      await refresh();
    } catch {
      if (mounted.current) {
        setNotice('저장 여부를 확인하지 못했습니다. 현재 설정을 다시 확인해 주세요.');
        await refresh();
      }
    } finally {
      writing.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  const status = loadFailed ? '조회 실패' : !saved ? '확인 중' : !live ? '오프라인'
    : saved.amount === 0 ? '방송 중 · 사용 안 함' : '방송 중 · 사용 중';
  return (
    <section aria-labelledby="broadcast-bonus-heading" className="grid min-w-0 gap-4 border-y py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="broadcast-bonus-heading" className="text-base font-semibold">방송 한정 포인트</h2>
        <Badge tone={live && !loadFailed ? 'mint' : 'neutral'}>{status}</Badge>
        <Button type="button" size="icon" variant="ghost" className="ml-auto" title="방송 상태 새로고침"
          aria-label="방송 상태 새로고침" disabled={saving} onClick={() => void refresh()}>
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        시청자마다 이번 방송에서만 쓸 수 있는 한도입니다. 한도나 사용처를 바꿔도 이미 쓴 포인트는 초기화되지 않습니다.
      </p>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset disabled={!editable} className="flex min-w-0 flex-wrap items-end gap-x-6 gap-y-3">
          <div className="grid w-full gap-1.5 sm:w-44">
            <label htmlFor="broadcast-bonus-amount" className="text-sm font-semibold">1인 한도 (P)</label>
            <Input id="broadcast-bonus-amount" type="number" min={0} max={MAX_BROADCAST_BONUS} step={1} inputMode="numeric"
              value={amount} placeholder="0" onChange={(event) => edit(event.target.value, categories)}
              aria-invalid={editable && !validAmount} aria-describedby="broadcast-bonus-help" />
          </div>
          <fieldset className="min-w-0">
            <legend className="mb-1.5 text-sm font-semibold">사용처</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {BROADCAST_BONUS_CATEGORIES.map(({ id, label }) => (
                <label key={id} className="inline-flex min-h-[var(--control-height)] items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={categories.includes(id)}
                    onChange={(event) => edit(amount, event.target.checked ? [...categories, id] : categories.filter((c) => c !== id))} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <Button type="submit" variant="outline" disabled={!canSave}>
            {saving ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Save aria-hidden="true" className="h-4 w-4" />}
            한도 저장
          </Button>
        </fieldset>
        <p id="broadcast-bonus-help" className="mt-2 text-sm text-muted-foreground" role="status">
          {loadFailed ? '방송 상태를 불러오지 못했습니다. 새로고침해 주세요.' : !saved ? '방송 상태를 확인하고 있습니다.'
            : !live ? '방송 중에만 설정할 수 있습니다.' : !writable ? '포인트 쓰기 권한이 필요합니다.'
            : !validAmount ? `0~${MAX_BROADCAST_BONUS.toLocaleString('ko-KR')} 사이의 정수를 입력해 주세요.`
            : invalidCategories ? '사용처를 하나 이상 선택해 주세요.' : '0P로 저장하면 사용을 중지합니다.'}
        </p>
        {notice ? <p className="mt-1 text-sm font-semibold" role="status">{notice}</p> : null}
      </form>
    </section>
  );
}
