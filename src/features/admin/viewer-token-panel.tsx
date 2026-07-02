'use client';

import { Copy, RefreshCw, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiUrl, readJson } from '@/shared/api/http';

type TokenResponse = {
  token?: string;
  path?: string;
  sid?: string;
};

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
  const [data, setData] = useState<TokenResponse | null>(null);
  const [isPending, startTransition] = useTransition();
  const fullUrl = useMemo(() => {
    if (!data?.path || typeof window === 'undefined') return data?.path || '';
    return new URL(data.path, window.location.origin).toString();
  }, [data?.path]);

  const load = useCallback(() => {
    startTransition(async () => {
      setData(await readJson<TokenResponse>(endpoint));
    });
  }, [endpoint]);

  useEffect(() => {
    load();
  }, [load]);

  async function rotate() {
    if (!rotateEndpoint) return;
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

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} 복사 완료`);
    } catch {
      toast.error('복사에 실패했습니다.');
    }
  }

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
          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => fullUrl && copy(fullUrl, 'OBS 주소')}
              disabled={!fullUrl}
              className="group rounded-2xl border bg-background/60 p-3 text-left transition hover:border-primary/35 hover:bg-pastel-sky/35 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <div className="text-xs font-bold text-muted-foreground">OBS 브라우저 소스 주소</div>
              <div className="mt-2 break-all text-sm font-semibold blur-sm transition group-hover:blur-0 group-focus-visible:blur-0">{fullUrl || '-'}</div>
              <div className="mt-3 inline-flex min-h-[var(--control-height-sm)] items-center gap-2 rounded-[var(--radius-control)] border bg-card px-3 text-xs font-bold">
                <Copy className="h-3.5 w-3.5" />
                클릭해서 복사
              </div>
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
