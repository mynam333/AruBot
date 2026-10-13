'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { FlaskConical, Loader2, Monitor, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useBotChannel } from '@/components/app-shell/bot-channel-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { readJsonResult } from '@/shared/api/http';

type TestResult = { matchedCount: number; results: Array<{
  ruleId: string; ruleName: string; status: 'executed' | 'partial' | 'failed'; text: string;
  desktopSent: number; repeatCount: number; chatSent: boolean; features: string[]; errors: string[];
}> };

export function DonationTestDialog() {
  const { canWrite } = useBotChannel();
  const writable = canWrite('donations');
  const id = useId();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('1000');
  const [username, setUsername] = useState('시청자 1');
  const [message, setMessage] = useState('');
  const [provider, setProvider] = useState('chzzk');
  const [confirmed, setConfirmed] = useState(false);
  const [sendChat, setSendChat] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState('');

  const run = async () => {
    if (!writable || !confirmed || inFlight.current) return;
    const numeric = Number(amount);
    if (!Number.isSafeInteger(numeric) || numeric < 1 || numeric > 100000000 || !username.trim()) {
      setError('금액과 시청자명을 확인해 주세요.'); return;
    }
    inFlight.current = true;
    setBusy(true); setError(''); setResult(null);
    try {
      const response = await readJsonResult<TestResult>('/api/donation/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: numeric, username: username.trim(), message, provider, sendChat, confirmExecution: true, requestId: crypto.randomUUID() }),
      });
      if (!response.ok) {
        setError(response.status == null
          ? '실행 결과를 확인할 수 없습니다. 다시 실행하기 전에 이벤트 로그와 오버레이를 확인해 주세요.'
          : response.message);
        return;
      }
      setResult(response.data);
    } catch {
      setError('실행 결과를 확인할 수 없습니다. 다시 실행하기 전에 이벤트 로그와 오버레이를 확인해 주세요.');
    } finally { inFlight.current = false; setBusy(false); setConfirmed(false); }
  };

  return <Dialog.Root open={open} onOpenChange={next => { if (busy) return; setOpen(next); if (!next) setConfirmed(false); }}>
    <Button asChild variant="outline"><Dialog.Trigger disabled={!writable}><FlaskConical className="h-4 w-4" />후원 테스트</Dialog.Trigger></Button>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-background/65 backdrop-blur-sm" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid max-h-[90svh] w-[calc(100%_-_2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border bg-card p-5 shadow-xl">
        <header className="flex items-start justify-between gap-4">
          <div><Dialog.Title className="text-lg font-bold">후원 반응 테스트</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">저장된 조건으로 실제 효과를 실행합니다. 테스트 후원 포인트는 지급하지 않습니다.</Dialog.Description></div>
          <Button asChild size="icon" variant="ghost"><Dialog.Close disabled={busy} aria-label="닫기"><X className="h-4 w-4" /></Dialog.Close></Button>
        </header>
        <fieldset disabled={busy || !writable} className="grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-semibold" htmlFor={`${id}-provider`}>플랫폼<select id={`${id}-provider`} value={provider} onChange={e => setProvider(e.target.value)} className="h-10 rounded-md border bg-background px-3"><option value="chzzk">치지직</option><option value="cime">씨미</option><option value="youtube">YouTube</option></select></label>
          <label className="grid gap-2 text-sm font-semibold" htmlFor={`${id}-amount`}>후원 금액 (원)<Input id={`${id}-amount`} type="number" min={1} max={100000000} step={1} value={amount} onChange={e => setAmount(e.target.value)} /></label>
          <label className="grid gap-2 text-sm font-semibold sm:col-span-2" htmlFor={`${id}-name`}>시청자명<Input id={`${id}-name`} maxLength={80} value={username} onChange={e => setUsername(e.target.value)} /></label>
          <label className="grid gap-2 text-sm font-semibold sm:col-span-2" htmlFor={`${id}-message`}>후원 메시지<textarea id={`${id}-message`} maxLength={1000} value={message} onChange={e => setMessage(e.target.value)} className="min-h-24 w-full rounded-md border bg-background px-3 py-2 font-normal" /></label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={sendChat} disabled={!canWrite('commands')} onChange={e => setSendChat(e.target.checked)} />응답 문구·룰렛 결과 채팅 전송</label>
        </fieldset>
        <div className="space-y-2 border-y py-3 text-sm">
          <p className="text-muted-foreground">룰렛·블루프린트·로컬 명령과 그 후속 동작이 방송 여부와 관계없이 실제 실행됩니다. 연결된 오버레이와 방송 PC에 영향을 줍니다.</p>
          <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={confirmed} disabled={busy || !writable} onChange={e => setConfirmed(e.target.checked)} />실제 실행을 확인했습니다.</label>
        </div>
        {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
        {result ? <section aria-label="테스트 결과" className="min-w-0 space-y-3" aria-live="polite">
          <h3 className="text-sm font-semibold">일치한 반응 {result.matchedCount}개</h3>
          {result.results.map((item, index) => <div key={`${item.ruleId}-${index}`} className="space-y-2 border-l-2 border-primary/40 pl-3 text-sm">
            <div className="flex flex-wrap items-center gap-2"><strong className="break-all">{item.ruleName}</strong><Badge tone={item.status === 'executed' ? 'mint' : 'coral'}>{item.status === 'executed' ? '실행 처리' : item.status === 'partial' ? '일부 오류' : '실행 실패'}</Badge></div>
            {item.text ? <p className="whitespace-pre-wrap break-words text-muted-foreground">{item.text}</p> : null}
            {item.features?.includes('roulette') ? <p className="text-xs text-muted-foreground">룰렛 실행 요청 처리</p> : null}
            {item.features?.includes('action') ? <p className="text-xs text-muted-foreground">블루프린트 실행 요청 처리</p> : null}
            {item.repeatCount > 0 ? <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Monitor className="h-3.5 w-3.5 shrink-0" />{item.desktopSent > 0 ? `이름 기반 로컬 명령 전송 ${item.desktopSent}대 · ${item.repeatCount}회 요청` : '이름 기반 로컬 명령: 수신 연결 없음'}</p> : null}
            {item.chatSent ? <p className="text-xs text-muted-foreground">응답 채팅 전송 완료</p> : null}
            {item.errors.map((value, i) => <p key={i} className="break-words text-xs text-destructive">{value}</p>)}
          </div>)}
        </section> : null}
        <footer className="flex justify-end"><Button onClick={() => void run()} disabled={busy || !confirmed || !writable}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}{busy ? '실행 중' : '실제 효과 실행'}</Button></footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
