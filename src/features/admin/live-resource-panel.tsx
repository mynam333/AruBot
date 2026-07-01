'use client';

import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { readJson } from '@/shared/api/http';

export function LiveResourcePanel({ endpoint }: { endpoint?: string }) {
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'ok' | 'error'>('idle');

  const preview = useMemo(() => {
    if (!data || typeof data !== 'object') return [];
    const object = data as Record<string, unknown>;
    return [
      ['상태', object.ok === true ? '정상' : object.ok === false ? '확인 필요' : status === 'ok' ? '응답 수신' : '대기'],
      ['연결 번호', object.pid ? String(object.pid) : undefined],
      ['시작 시간', object.startedAt ? String(object.startedAt) : undefined],
      ['실시간 전송', object.wsPvdPerMessageDeflate === false ? '압축 비활성' : object.wsPvdPerMessageDeflate === true ? '압축 활성' : undefined],
    ].filter((item): item is [string, string] => Boolean(item[1]));
  }, [data, status]);

  const load = useCallback(async () => {
    if (!endpoint) return;
    setLoading(true);
    const result = await readJson(endpoint);
    setData(result);
    setStatus(result ? 'ok' : 'error');
    setLoading(false);
  }, [endpoint]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="rounded-lg border bg-background/55 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge tone={status === 'ok' ? 'emerald' : status === 'error' ? 'rose' : 'neutral'}>
            {status === 'ok' ? '응답 정상' : status === 'error' ? '확인 필요' : '대기'}
          </Badge>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={load} disabled={loading || !endpoint}>
          <RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
          새로고침
        </Button>
      </div>
      {preview.length ? (
        <div className="mt-4 grid gap-2">
          {preview.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 rounded-md border bg-card/70 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{label}</span>
              <span className="truncate font-semibold">{value}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-md border bg-card/70 p-4 text-sm text-muted-foreground">
          연결 상태를 확인하는 중입니다. 준비되면 필요한 정보가 표시돼요.
        </div>
      )}
    </div>
  );
}
