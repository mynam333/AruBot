import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  Cable,
  Coins,
  Download,
  HeartHandshake,
  MessageSquare,
  PlaySquare,
  Radio,
  ShieldCheck,
  Sparkles,
  Vote,
  Workflow,
} from 'lucide-react';
import { LinkButton } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';

const features = [
  { title: '채팅 명령어', description: '반복 안내와 시청자 참여 명령을 채널별로 운영합니다.', icon: MessageSquare },
  { title: '통합 포인트', description: '플랫폼별 참여 내역과 시청자 잔액을 한곳에서 관리합니다.', icon: Coins },
  { title: '예측 베팅', description: '실시간 예측을 열고 참여 포인트와 결과를 확정합니다.', icon: Vote },
  { title: '영상·그림 후원', description: '대기열, 재생 상태와 시청자 그림을 방송 화면으로 연결합니다.', icon: PlaySquare },
  { title: '룰렛 오버레이', description: '실제 항목과 결과를 OBS 브라우저 소스에 바로 표시합니다.', icon: Sparkles },
  { title: '방송 자동화', description: 'OBS, TTS, VTube Studio와 로컬 액션을 순서대로 실행합니다.', icon: Workflow },
] as const;

const platforms = [
  { name: 'CHZZK', icon: '/brands/chzzk.svg' },
  { name: 'CIME', icon: '/brands/cime.svg' },
  { name: 'YouTube', icon: '/brands/youtube.svg' },
] as const;

export function LandingPage() {
  return (
    <main className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-3 px-[var(--page-gutter)]">
          <Link href="/" className="inline-flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Image src="/files/logo.png" alt="AruBot" width={36} height={36} className="h-9 w-9 rounded-lg border object-contain" priority />
            <span className="text-sm font-bold tracking-tight">AruBot</span>
          </Link>
          <nav className="flex items-center gap-2" aria-label="주요 메뉴">
            <LinkButton href="/viewer/me" variant="ghost" size="sm" className="hidden sm:inline-flex">시청자 페이지</LinkButton>
            <LinkButton href="/streamer" variant="outline" size="sm">관리 콘솔</LinkButton>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <section className="border-b px-[var(--page-gutter)] py-[clamp(4rem,10vw,8rem)]">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(22rem,0.7fr)] lg:items-center">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-primary"><Radio className="h-4 w-4" />Live operations</div>
            <h1 className="max-w-4xl break-keep text-[clamp(2.5rem,6vw,5rem)] font-bold leading-[1.04] tracking-[-0.04em]">
              참여형 방송을<br />한곳에서 운영하세요.
            </h1>
            <p className="mt-6 max-w-2xl break-keep text-base leading-8 text-muted-foreground md:text-lg">
              AruBot은 CHZZK, CIME, YouTube 방송의 채팅 참여, 포인트, 후원, 룰렛과 자동화를 연결하는 운영 콘솔입니다.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href="/streamer" size="lg">스트리머로 시작<ArrowRight className="h-4 w-4" /></LinkButton>
              <LinkButton href="/viewer/me" variant="outline" size="lg">시청자 페이지<Coins className="h-4 w-4" /></LinkButton>
            </div>
          </div>

          <aside className="rounded-2xl border bg-slate-950 p-[clamp(1.5rem,3vw,2.25rem)] text-slate-50 shadow-soft dark:border-border">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-emerald-300"><ShieldCheck className="h-4 w-4" />Production ready</div>
            <h2 className="mt-5 break-keep text-2xl font-bold tracking-tight">실제 방송 계정과 OBS에 바로 연결됩니다.</h2>
            <div className="mt-6 divide-y divide-white/10 rounded-xl border border-white/10">
              <div className="flex items-center gap-3 p-4"><Cable className="h-5 w-5 text-emerald-300" /><span className="text-sm font-semibold">플랫폼 계정 연결</span></div>
              <div className="flex items-center gap-3 p-4"><Sparkles className="h-5 w-5 text-emerald-300" /><span className="text-sm font-semibold">토큰 기반 OBS 오버레이</span></div>
              <div className="flex items-center gap-3 p-4"><Workflow className="h-5 w-5 text-emerald-300" /><span className="text-sm font-semibold">로컬 프로그램 자동화</span></div>
            </div>
          </aside>
        </div>
      </section>

      <section className="px-[var(--page-gutter)] py-[clamp(3.5rem,8vw,6rem)]">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-6 border-b pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.1em] text-primary">Core features</div>
              <h2 className="mt-3 text-2xl font-bold tracking-tight md:text-3xl">방송 운영에 필요한 핵심 기능</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {platforms.map((platform) => <span key={platform.name} className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs font-semibold shadow-subtle"><Image src={platform.icon} alt="" width={18} height={18} className="h-[1.125rem] w-[1.125rem] object-contain" />{platform.name}</span>)}
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <article key={feature.title} className="rounded-[var(--radius-card)] border bg-card p-5 shadow-subtle">
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
                  <h3 className="mt-5 text-base font-semibold">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{feature.description}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-y bg-card px-[var(--page-gutter)] py-[clamp(3rem,7vw,5rem)]">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">방송 PC 도구도 함께 사용하세요.</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">로컬 프로그램과 브라우저 확장은 실제 방송 환경에서 자동화와 영상 후원을 연결합니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/downloads/local-program" variant="outline"><Download className="h-4 w-4" />로컬 프로그램</LinkButton>
            <LinkButton href="/downloads/browser-extension" variant="outline"><PlaySquare className="h-4 w-4" />브라우저 확장</LinkButton>
          </div>
        </div>
      </section>

      <footer className="px-[var(--page-gutter)] py-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>© AruBot</span>
          <div className="flex gap-4"><Link href="/terms" className="hover:text-foreground">이용약관</Link><Link href="/privacy" className="hover:text-foreground">개인정보처리방침</Link><span className="inline-flex items-center gap-1"><HeartHandshake className="h-3.5 w-3.5" />방송 참여 도우미</span></div>
        </div>
      </footer>
    </main>
  );
}
