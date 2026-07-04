import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  Coins,
  Download,
  GalleryVerticalEnd,
  HeartHandshake,
  MessageSquare,
  Moon,
  PlaySquare,
  Radio,
  Sparkles,
  Sun,
  Vote,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';

const highlights = [
  { title: '채팅 명령어', body: '반복 안내는 봇에게 맡기고, 채팅은 더 빠르게 반응합니다.', icon: MessageSquare, tone: 'sky' },
  { title: '통합 포인트', body: 'CHZZK, CIME, YouTube Live 참여 포인트를 방송별로 모아 보여줍니다.', icon: Coins, tone: 'mint' },
  { title: '예측 투표', body: '!투표 한마디로 결과를 함께 고르고, 화면에서는 실시간 분위기가 살아납니다.', icon: Vote, tone: 'lemon' },
  { title: '영상 후원', body: '시청자가 보낸 영상은 순서대로 이어지고, 방송 화면에는 깔끔하게 재생됩니다.', icon: PlaySquare, tone: 'coral' },
  { title: '룰렛 이벤트', body: '포인트와 후원이 당첨의 긴장감으로 바뀌어 채팅 참여가 더 즐거워집니다.', icon: Sparkles, tone: 'mint' },
  { title: '후원 반응', body: '후원 순간에 맞춘 채팅 반응과 연출로 고마운 장면을 더 선명하게 남깁니다.', icon: HeartHandshake, tone: 'coral' },
] as const;

const flows = [
  { title: '방송인은 진행에 집중', body: '명령어와 참여 이벤트가 자연스럽게 움직여 방송 중 손이 덜 갑니다.', icon: Radio },
  { title: '시청자는 계속 참여', body: '플랫폼이 바뀌어도 포인트와 이벤트 참여를 이어갑니다.', icon: BadgeCheck },
  { title: '화면에는 필요한 장면만', body: '예측, 룰렛, 영상 후원이 방송 화면에 보기 좋게 나타납니다.', icon: GalleryVerticalEnd },
] as const;

export function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden">
      <section className="relative isolate min-h-[92svh] px-[var(--page-gutter)] py-[clamp(1rem,2.6vw,1.75rem)]">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_20%_10%,hsl(var(--accent-mint)/0.55),transparent_35%),radial-gradient(ellipse_at_82%_18%,hsl(var(--accent-coral)/0.46),transparent_34%),linear-gradient(135deg,hsl(var(--background)),hsl(var(--accent-sky)/0.34)_48%,hsl(var(--accent-lemon)/0.22))]" />
        <div className="absolute inset-x-0 top-[12%] -z-10 h-[42%] -skew-y-3 bg-[linear-gradient(90deg,transparent,hsl(var(--card)/0.42),transparent)] landing-sheen" />

        <header className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <Link href="/" className="group inline-flex items-center gap-3 rounded-full bg-card/70 px-3 py-2 shadow-subtle backdrop-blur-xl transition hover:-translate-y-0.5">
            <Image src="/files/logo.png" alt="AruBot" width={36} height={36} className="aspect-square w-[clamp(2rem,4vw,2.5rem)] object-contain" priority />
            <span className="text-sm font-semibold">AruBot</span>
          </Link>
          <nav className="hidden items-center gap-2 md:flex">
            <LinkButton href="/viewer/me" variant="ghost">시청자 포인트</LinkButton>
            <LinkButton href="/streamer" variant="ghost">스트리머 콘솔</LinkButton>
            <ThemeToggle />
          </nav>
          <div className="flex items-center gap-2 md:hidden">
            <ThemeToggle />
          </div>
        </header>

        <div className="mx-auto grid max-w-7xl gap-[clamp(2rem,6vw,5rem)] pt-[clamp(4rem,10vw,7rem)] lg:grid-cols-[minmax(0,1.02fr)_minmax(36%,0.74fr)] lg:items-center">
          <div className="animate-fade-up">
            <Badge tone="mint">인터넷 방송 참여를 한 계정으로</Badge>
            <h1 className="mt-5 max-w-4xl break-keep text-[clamp(2.5rem,7vw,5.75rem)] font-semibold leading-[1.02] tracking-normal">
              채팅봇은<br />가볍게,<br />참여 경험은<br />더 선명하게.
            </h1>
            <p className="mt-6 max-w-2xl break-keep text-base leading-8 text-muted-foreground md:text-lg">
              AruBot은 CHZZK, CIME, YouTube Live 방송의 채팅 참여, 포인트, 룰렛, 영상 후원, 예측 투표를 한곳에서 관리합니다.
              방송인은 진행에 더 집중하고, 시청자는 어디서 보든 편하게 참여합니다.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href="/streamer" size="lg">
                스트리머로 시작
                <ArrowRight className="h-4 w-4" />
              </LinkButton>
              <LinkButton href="/viewer/me" variant="soft" size="lg">
                시청자로 시작
                <Coins className="h-4 w-4" />
              </LinkButton>
              <LinkButton href="/downloads/local-program" variant="outline" size="lg">
                로컬 프로그램
                <Download className="h-4 w-4" />
              </LinkButton>
              <LinkButton href="/downloads/browser-extension" variant="outline" size="lg">
                브라우저 확장
                <PlaySquare className="h-4 w-4" />
              </LinkButton>
            </div>
          </div>

          <div className="relative animate-fade-up" style={{ animationDelay: '90ms' }}>
            <div className="landing-device relative rounded-[clamp(1.35rem,3vw,2rem)] border bg-card/75 p-[clamp(0.75rem,1.6vw,1.125rem)] shadow-glow backdrop-blur-2xl">
              <div className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] bg-background/75 px-[clamp(0.85rem,1.8vw,1.2rem)] py-[clamp(0.75rem,1.5vw,1rem)]">
                <div className="flex items-center gap-3">
                  <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-pastel-mint/80 text-primary">
                    <Radio className="h-5 w-5" />
                  </span>
                  <div>
                    <div className="text-sm font-semibold">방송 참여 허브</div>
                    <div className="text-xs text-muted-foreground">명령어 · 포인트 · 예측 · 후원</div>
                  </div>
                </div>
                <Badge tone="mint">연결됨</Badge>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {[
                  ['!투표', '예측 참여'],
                  ['!포인트', '잔액 확인'],
                  ['!룰렛', '이벤트 참여'],
                  ['!영도', '영상 신청'],
                ].map(([command, label], index) => (
                  <div key={command} className="landing-chip rounded-[var(--radius-card)] border bg-background/70 p-[clamp(0.875rem,1.8vw,1.15rem)]" style={{ animationDelay: `${120 + index * 80}ms` }}>
                    <div className="text-xl font-semibold">{command}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{label}</div>
                  </div>
                ))}
              </div>

              <div className="mt-3 overflow-hidden rounded-[var(--radius-card)] border bg-background/70 p-[clamp(1rem,2vw,1.35rem)]">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">통합 포인트</div>
                    <div className="text-xs text-muted-foreground">어느 플랫폼에서 봐도 같은 내 포인트</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Sun className="h-4 w-4 text-amber-500" />
                    <Moon className="h-4 w-4 text-sky-500" />
                  </div>
                </div>
                <div className="grid gap-2">
                  {['채팅 참여', '후원 반응', '예측 오버레이'].map((label, index) => (
                    <div key={label} className="grid grid-cols-[minmax(0,1fr)_36%] items-center gap-3">
                      <span className="truncate text-sm text-muted-foreground">{label}</span>
                      <span className="relative h-[clamp(0.55rem,1vw,0.7rem)] overflow-hidden rounded-full bg-muted">
                        <span
                          className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,hsl(var(--primary)),hsl(var(--accent)))] landing-bar"
                          style={{ width: '100%', animationDelay: `${index * 130}ms` }}
                        />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-[var(--page-gutter)] py-[clamp(3rem,7vw,5rem)]">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <Badge tone="sky">방송에 바로 쓰는 기능</Badge>
              <h2 className="mt-4 max-w-3xl break-keep text-[clamp(2rem,4.8vw,4rem)] font-semibold leading-tight">
                시청자가 채팅에서 느끼는 순간까지 설계했습니다.
              </h2>
            </div>
            <p className="max-w-md text-sm leading-7 text-muted-foreground">
              공개 페이지, 방송 화면, 채팅 명령어로 처음 온 시청자도 바로 참여할 수 있습니다.
            </p>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {highlights.map((item, index) => {
              const Icon = item.icon;
              return (
                <article
                  key={item.title}
                  className="group animate-fade-up rounded-[var(--radius-card)] border bg-card/78 p-[clamp(1.15rem,2.2vw,1.55rem)] shadow-subtle backdrop-blur-xl transition hover:-translate-y-1 hover:shadow-glow"
                  style={{ animationDelay: `${index * 55}ms` }}
                >
                  <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-muted text-primary transition group-hover:scale-105">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-5 text-lg font-semibold">{item.title}</h3>
                  <p className="mt-2 break-keep text-sm leading-7 text-muted-foreground">{item.body}</p>
                  <div className="mt-5 h-[max(0.08rem,0.12vw)] overflow-hidden rounded-full bg-muted">
                    <div className="h-full w-full bg-[linear-gradient(90deg,hsl(var(--primary)),hsl(var(--accent)))] landing-bar" />
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="px-[var(--page-gutter)] pb-[clamp(3rem,8vw,6rem)]">
        <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-3">
          {flows.map((item, index) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="rounded-[var(--radius-card)] border bg-[linear-gradient(135deg,hsl(var(--card)/0.95),hsl(var(--surface-tint)/0.75))] p-[clamp(1.25rem,2.5vw,1.75rem)] shadow-soft">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-pastel-sky/70 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="text-sm font-semibold text-muted-foreground">0{index + 1}</span>
                </div>
                <h3 className="text-xl font-semibold">{item.title}</h3>
                <p className="mt-3 break-keep text-sm leading-7 text-muted-foreground">{item.body}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="px-[var(--page-gutter)] pb-[clamp(3rem,8vw,6rem)]">
        <div className="mx-auto max-w-5xl rounded-[clamp(1.35rem,3vw,2rem)] border bg-[linear-gradient(135deg,hsl(var(--accent-mint)/0.52),hsl(var(--card)/0.92)_46%,hsl(var(--accent-coral)/0.35))] p-[clamp(1.5rem,4vw,3rem)] text-center shadow-glow">
          <div className="mx-auto grid aspect-square w-[clamp(4rem,9vw,6rem)] place-items-center rounded-[var(--radius-panel)] bg-card/80 shadow-subtle">
            <Image src="/files/logo.png" alt="" width={72} height={72} className="aspect-square w-[70%] object-contain" />
          </div>
          <h2 className="mx-auto mt-6 max-w-3xl break-keep text-[clamp(1.8rem,4vw,3.4rem)] font-semibold leading-tight">
            방송인과 시청자가 함께 쓰는 채팅봇.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
            지금 연결하면 방송 진행과 시청자 참여가 자연스럽게 이어집니다.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <LinkButton href="/streamer" size="lg">
              콘솔 열기
              <ArrowRight className="h-4 w-4" />
            </LinkButton>
            <LinkButton href="/viewer/me" variant="outline" size="lg">
              시청자 페이지
              <Coins className="h-4 w-4" />
            </LinkButton>
            <LinkButton href="/downloads/local-program" variant="soft" size="lg">
              로컬 프로그램 다운로드
              <Download className="h-4 w-4" />
            </LinkButton>
            <LinkButton href="/downloads/browser-extension" variant="outline" size="lg">
              브라우저 확장 설치
              <PlaySquare className="h-4 w-4" />
            </LinkButton>
          </div>
        </div>
      </section>

      <footer className="px-[var(--page-gutter)] pb-[clamp(1.5rem,4vw,2.5rem)]">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 border-t pt-6 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            방송 참여와 진행을 자연스럽게 이어주는 AruBot
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/streamer" className="transition hover:text-foreground">스트리머 콘솔</Link>
            <Link href="/viewer/me" className="transition hover:text-foreground">시청자 포인트</Link>
            <Link href="/downloads/local-program" className="transition hover:text-foreground">로컬 프로그램</Link>
            <Link href="/downloads/browser-extension" className="transition hover:text-foreground">브라우저 확장</Link>
            <Link href="/privacy" className="transition hover:text-foreground">개인정보처리방침</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
