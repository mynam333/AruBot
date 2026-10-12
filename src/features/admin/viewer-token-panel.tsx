'use client';

import { useBotChannel } from '@/components/app-shell/bot-channel-provider';

import { Copy, Eye, EyeOff, RefreshCw, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiUrl, readJson } from '@/shared/api/http';

type TokenResponse = {
  ownerOnly?: boolean;
  token?: string;
  path?: string;
  sid?: string;
  bgmPath?: string;
  queuePath?: string;
};

function PrivateViewerAddress({ label, path }: { label: string; path?: string }) {
  const [revealed, setRevealed] = useState(false);
  const url = useMemo(() => path && typeof window !== 'undefined' ? new URL(path, window.location.origin).toString() : path || '', [path]);
  useEffect(() => setRevealed(false), [path]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(`${label} 복사 완료`);
    } catch { toast.error('복사에 실패했습니다.'); }
  }

  return (
    <section className="min-w-0 border-t py-4 first:border-t-0" aria-label={label}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{label}</h3>
        <div className="flex shrink-0 gap-1">
          <Button type="button" size="icon" variant="ghost" disabled={!url} aria-label={`${label} ${revealed ? '숨기기' : '표시'}`} title={revealed ? '주소 숨기기' : '주소 표시'} aria-pressed={revealed} onClick={() => setRevealed((value) => !value)}>
            {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
          <Button type="button" size="icon" variant="outline" disabled={!url} aria-label={`${label} 복사`} title="주소 복사" onClick={copy}><Copy className="h-4 w-4" /></Button>
        </div>
      </div>
      <button type="button" disabled={!url} onClick={() => setRevealed((value) => !value)} aria-label={`${label} ${revealed ? '숨기기' : '표시'}`} aria-expanded={revealed} className="block w-full min-w-0 rounded-md border bg-muted/40 px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
        <span aria-hidden={!revealed} className={`block break-all text-sm leading-6 transition-[filter] ${revealed ? 'blur-0 select-text' : 'blur-sm select-none'}`}>{url || '-'}</span>
      </button>
    </section>
  );
}

export function ViewerTokenPanel({
  title,
  description,
  endpoint,
  rotateEndpoint,
}: {
  title: string;
  description: string;
  endpoint: string;
  rotateEndpoint?: string;
}) {
  const { active } = useBotChannel();
  const ownerControls = active?.role !== 'manager';
  const [data, setData] = useState<TokenResponse | null>(null);
  const [isPending, startTransition] = useTransition();
  const isVideo = endpoint === '/api/video-donation/viewer-url';

  const load = useCallback(() => {
    if (!ownerControls) { setData(null); return; }
    startTransition(async () => {
      setData(await readJson<TokenResponse>(endpoint));
    });
  }, [endpoint, ownerControls]);

  useEffect(() => {
    load();
  }, [load]);

  async function rotate() {
    if (!ownerControls || !rotateEndpoint) return;
    startTransition(async () => {
      try {
        const response = await fetch(apiUrl(rotateEndpoint), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!response.ok) throw new Error('failed');
        setData(await response.json());
        toast.success('OBS 주소를 새로 만들었습니다.');
      } catch {
        toast.error('OBS 주소를 새로 만들지 못했습니다.');
      }
    });
  }

  if (!ownerControls || data?.ownerOnly) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={load} disabled={isPending}>
              <RefreshCw className={isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              새로고침
            </Button>
            {rotateEndpoint ? (
              <Button type="button" variant="secondary" onClick={rotate} disabled={isPending}>
                <RotateCcw className="h-4 w-4" />
                주소 새로 만들기
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge tone={data?.token ? 'mint' : 'amber'}>{data?.token ? '주소 준비됨' : '준비 중'}</Badge>
            {data?.sid ? <Badge tone="cyan">연결 채널 확인됨</Badge> : null}
          </div>
          <div className="min-w-0">
            <PrivateViewerAddress label={isVideo ? '영상 후원 플레이어 주소' : 'OBS 브라우저 소스 주소'} path={data?.path} />
            {isVideo ? <>
              <PrivateViewerAddress label="BGM 플레이어 주소" path={data?.bgmPath} />
              <PrivateViewerAddress label="신청곡 리스트 주소" path={data?.queuePath} />
            </> : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
