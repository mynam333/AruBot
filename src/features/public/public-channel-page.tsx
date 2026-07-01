import Link from 'next/link';
import { ChevronRight, Coins, ListChecks, Radio, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataView } from '@/components/ui/data-view';
import { cn } from '@/shared/lib/utils';
import { readPublicChannelData, readPublicChannelHub, type PublicChannelKind } from '@/shared/api/public';

const meta = {
  commands: { title: '명령어', description: '채팅에서 바로 사용할 수 있는 명령어를 확인해요.', icon: ListChecks, tone: 'sky' },
  points: { title: '포인트', description: '시청자 포인트와 랭킹을 확인해요.', icon: Coins, tone: 'mint' },
  roulette: { title: '룰렛', description: '참여 가능한 룰렛과 보상을 확인해요.', icon: Sparkles, tone: 'lemon' },
  rouletteLogs: { title: '룰렛 결과', description: '최근 룰렛 결과를 확인해요.', icon: Sparkles, tone: 'coral' },
  live: { title: '라이브', description: '현재 방송 상태를 확인해요.', icon: Radio, tone: 'coral' },
} as const;

const tabs = [
  { href: 'commands', label: '명령어', icon: ListChecks },
  { href: 'points', label: '포인트', icon: Coins },
  { href: 'roulette', label: '룰렛', icon: Sparkles },
  { href: 'live', label: '라이브', icon: Radio },
] as const;

function pickRows(data: unknown) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  const object = data as Record<string, unknown>;
  return (
    (['items', 'rules', 'rows', 'data', 'points', 'logs', 'definitions']
      .map((key) => object[key])
      .find(Array.isArray) as unknown[] | undefined) || []
  );
}

function isLive(data: unknown) {
  if (!data || typeof data !== 'object') return false;
  const object = data as Record<string, unknown>;
  return object.live === true || object.isLive === true || object.status === 'live';
}

function PublicShell({
  channelUid,
  active,
  children,
}: {
  channelUid: string;
  active?: PublicChannelKind | 'hub';
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen px-4 py-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <section className="rounded-[var(--radius-panel)] border bg-[linear-gradient(135deg,hsl(var(--card)),hsl(var(--accent-sky)/0.24))] p-[clamp(1.25rem,2.6vw,1.75rem)] shadow-subtle">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <Link href={`/c/${channelUid}`} className="mb-4 inline-flex items-center gap-2 text-sm font-semibold">
                <span className="grid aspect-square w-[calc(var(--icon-box)*0.9)] place-items-center overflow-hidden rounded-[var(--radius-control)] bg-card shadow-subtle ring-1 ring-border">
                  <img
                    src="/files/logo.png"
                    alt=""
                    aria-hidden="true"
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                </span>
                AruBot
              </Link>
              <h1 className="break-keep text-3xl font-semibold leading-tight md:text-4xl">방송 참여 정보를 한눈에 확인해요</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                명령어, 포인트, 룰렛, 라이브 상태를 모바일에서도 편하게 볼 수 있어요.
              </p>
            </div>
            <nav className="flex flex-wrap gap-2 text-sm font-semibold">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const href = `/c/${channelUid}/${tab.href}`;
                const selected = active === tab.href;
                return (
                  <Link
                    key={tab.href}
                    href={href}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-[var(--radius-control)] border bg-background/75 px-[clamp(0.75rem,1.4vw,1rem)] py-[clamp(0.5rem,1vw,0.75rem)] transition hover:bg-muted',
                      selected && 'border-primary/30 bg-pastel-mint/55 text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4 text-primary" />
                    {tab.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </section>
        {children}
      </div>
    </main>
  );
}

export async function PublicChannelPage({ channelUid, kind }: { channelUid: string; kind: PublicChannelKind }) {
  const config = meta[kind];
  const Icon = config.icon;
  const data = await readPublicChannelData(channelUid, kind);

  return (
    <PublicShell channelUid={channelUid} active={kind}>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Badge tone={config.tone}>{config.title}</Badge>
              <CardTitle className="mt-3 flex items-center gap-2">
                <Icon className="h-5 w-5 text-primary" />
                {config.title}
              </CardTitle>
              <CardDescription>{config.description}</CardDescription>
            </div>
            <Link href={`/c/${channelUid}`} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border px-[clamp(0.75rem,1.4vw,1rem)] py-[clamp(0.5rem,1vw,0.75rem)] text-sm font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground">
              채널 홈
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </CardHeader>
      </Card>
      <DataView
        title="공개 목록"
        description="시청자가 사용할 수 있는 항목만 표시합니다."
        data={data}
        empty="아직 공개된 항목이 없어요."
      />
    </PublicShell>
  );
}

export async function PublicChannelHub({ channelUid }: { channelUid: string }) {
  const data = await readPublicChannelHub(channelUid);
  const cards = [
    { href: 'commands', title: '명령어', body: '채팅에서 바로 쓸 수 있는 안내를 확인해요.', count: pickRows(data.commands).length, icon: ListChecks, tone: 'sky' },
    { href: 'points', title: '포인트', body: '참여로 쌓은 포인트와 랭킹을 확인해요.', count: pickRows(data.points).length, icon: Coins, tone: 'mint' },
    { href: 'roulette', title: '룰렛', body: '참여 가능한 룰렛과 보상을 살펴봐요.', count: pickRows(data.roulette).length, icon: Sparkles, tone: 'lemon' },
    { href: 'live', title: '라이브', body: isLive(data.live) ? '지금 방송 중이에요.' : '방송 정보가 준비되면 표시돼요.', count: isLive(data.live) ? 1 : 0, icon: Radio, tone: 'coral' },
  ] as const;

  return (
    <PublicShell channelUid={channelUid} active="hub">
      <section className="grid gap-4 sm:grid-cols-2">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link key={card.href} href={`/c/${channelUid}/${card.href}`} className="group rounded-[var(--radius-card)] border bg-card/90 p-[clamp(1.25rem,2.2vw,1.5rem)] shadow-subtle transition hover:-translate-y-0.5 hover:bg-card hover:shadow-glow">
              <div className="flex items-start justify-between gap-3">
                <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-muted text-primary">
                  <Icon className="h-5 w-5" />
                </span>
                <Badge tone={card.tone}>{card.count ? `${card.count}개` : '준비 중'}</Badge>
              </div>
              <h2 className="mt-4 text-lg font-semibold">{card.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{card.body}</p>
              <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary">
                보러 가기
                <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </div>
            </Link>
          );
        })}
      </section>
    </PublicShell>
  );
}
