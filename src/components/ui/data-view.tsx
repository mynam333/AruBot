import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { compactDateTime, formatNumber } from '@/shared/lib/utils';

function pickRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
  if (data && typeof data === 'object') {
    const object = data as Record<string, unknown>;
    const arrayValue = ['items', 'rules', 'macros', 'rows', 'data', 'points', 'logs', 'definitions']
      .map((key) => object[key])
      .find(Array.isArray);
    if (Array.isArray(arrayValue)) {
      return arrayValue.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
    }
  }
  return [];
}

function readable(value: unknown) {
  if (value == null || value === '') return '-';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return value ? 'ON' : 'OFF';
  if (typeof value === 'string' && /at|date|time/i.test(value) && !Number.isNaN(new Date(value).getTime())) return compactDateTime(value);
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 80);
  return String(value);
}

function labelKey(key: string) {
  const labels: Record<string, string> = {
    id: '번호',
    name: '이름',
    title: '제목',
    command: '명령어',
    response: '응답',
    enabled: '사용',
    active: '사용',
    user_id: '시청자',
    username: '시청자',
    nickname: '닉네임',
    points: '포인트',
    amount: '금액',
    created_at: '생성일',
    updated_at: '수정일',
  };
  return labels[key] || key.replace(/_/g, ' ');
}

export function DataView({
  title,
  description,
  data,
  empty = '아직 보여줄 항목이 없어요.',
}: {
  title: string;
  description?: string;
  data: unknown;
  empty?: string;
}) {
  const rows = pickRows(data);
  const visibleRows = rows.slice(0, 80);
  const keys = visibleRows.length
    ? Array.from(new Set(visibleRows.flatMap((row) => Object.keys(row)))).slice(0, 7)
    : [];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          <Badge tone={rows.length ? 'emerald' : 'neutral'}>{rows.length}개</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <div className="overflow-x-auto rounded-[var(--radius-control)] border">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-muted/70 text-xs uppercase text-muted-foreground">
                <tr>
                  {keys.map((key) => (
                    <th key={key} className="px-[clamp(0.75rem,1.4vw,1rem)] py-[clamp(0.75rem,1.4vw,1rem)] font-semibold">{labelKey(key)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, index) => (
                  <tr key={String(row.id || row.user_id || row.name || index)} className="border-t bg-background/45">
                    {keys.map((key) => (
                      <td key={key} className="max-w-[24ch] truncate px-[clamp(0.75rem,1.4vw,1rem)] py-[clamp(0.75rem,1.4vw,1rem)] text-muted-foreground">
                        {readable(row[key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-[var(--radius-control)] border bg-background/55 p-[clamp(1.25rem,2.6vw,1.75rem)] text-sm text-muted-foreground">{empty}</div>
        )}
      </CardContent>
    </Card>
  );
}
