import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, BellOff, CheckCircle2, Clock3, PlaySquare, Settings2, ShieldCheck, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';

const CHROME_EXTENSION_URL = 'https://chromewebstore.google.com/detail/dmjipmhbheplkfpmjikdmcofnhlhkbmh';
const FIREFOX_EXTENSION_URL = 'https://addons.mozilla.org/ko/firefox/addon/donate-youtube-pause/';

const benefits = [
  {
    icon: BellOff,
    title: '후원 영상이 묻히지 않게',
    body: '시청자가 보낸 영상 후원이 재생되는 동안 다른 YouTube 영상 소리를 자연스럽게 멈춥니다.',
  },
  {
    icon: Clock3,
    title: '여러 후원도 차분하게',
    body: '치지직, 씨미, 투네이션, 아루봇 후원이 겹쳐도 가장 늦게 끝나는 후원에 맞춰 재생을 이어갑니다.',
  },
  {
    icon: ShieldCheck,
    title: '방송 흐름은 그대로',
    body: '브라우저 안에서 동작하므로 별도 프로그램 없이 방송 중 열어둔 YouTube 탭만 조용히 관리합니다.',
  },
] as const;

const steps = [
  '사용하는 브라우저 스토어에서 확장 프로그램을 설치합니다.',
  '확장 옵션에서 치지직, 씨미, 투네이션, 아루봇 오버레이 주소를 붙여넣습니다.',
  'Monitoring을 켜고 방송 중 사용할 YouTube 영상을 브라우저에 열어둡니다.',
  '영상 후원이 들어오면 YouTube가 멈추고, 대기열이 끝나면 자동으로 다시 재생됩니다.',
] as const;

export default function BrowserExtensionPage() {
  return (
    <main className="min-h-screen overflow-hidden">
      <section className="relative isolate min-h-screen px-[var(--page-gutter)] py-[clamp(1rem,2.6vw,1.75rem)]">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_18%_8%,hsl(var(--accent-mint)/0.58),transparent_36%),radial-gradient(ellipse_at_86%_18%,hsl(var(--accent-coral)/0.42),transparent_34%),linear-gradient(135deg,hsl(var(--background)),hsl(var(--accent-sky)/0.34)_48%,hsl(var(--accent-lemon)/0.2))]" />
        <header className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-3 rounded-full bg-card/72 px-3 py-2 shadow-subtle backdrop-blur-xl transition hover:-translate-y-0.5">
            <Image src="/files/logo.png" alt="AruBot" width={36} height={36} className="aspect-square w-[clamp(2rem,4vw,2.5rem)] object-contain" priority />
            <span className="text-sm font-semibold">AruBot</span>
          </Link>
          <nav className="flex items-center gap-2">
            <LinkButton href="/streamer" variant="ghost">스트리머 콘솔</LinkButton>
            <ThemeToggle />
          </nav>
        </header>

        <div className="mx-auto grid max-w-7xl gap-[clamp(2rem,6vw,4.5rem)] pt-[clamp(4rem,9vw,7rem)] lg:grid-cols-[minmax(0,1fr)_minmax(34%,0.78fr)] lg:items-center">
          <div className="animate-fade-up">
            <Badge tone="mint">Chrome · Firefox 확장 프로그램</Badge>
            <h1 className="mt-5 max-w-4xl break-keep text-[clamp(2.35rem,6.2vw,5.25rem)] font-semibold leading-[1.03] tracking-normal">
              영상 후원 순간엔 YouTube가 조용히 멈춥니다.
            </h1>
            <p className="mt-6 max-w-2xl break-keep text-base leading-8 text-muted-foreground md:text-lg">
              후원시 유튜브 일시정지는 방송 중 열어둔 YouTube 영상을 후원 영상 길이에 맞춰 자동으로 멈춥니다.
              치지직, 씨미, 투네이션, 아루봇 영상 후원을 함께 감지해 시청자가 보낸 장면에 집중할 수 있게 해줍니다.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <StoreButton href={CHROME_EXTENSION_URL} label="Chrome에 추가" browser="chrome" />
              <StoreButton href={FIREFOX_EXTENSION_URL} label="Firefox에 추가" browser="firefox" />
            </div>
          </div>

          <aside className="animate-fade-up rounded-[var(--radius-panel)] border bg-card/78 p-[clamp(1.15rem,2.4vw,1.75rem)] shadow-glow backdrop-blur-2xl" style={{ animationDelay: '80ms' }}>
            <div className="flex items-center justify-between gap-3">
              <div className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-pastel-mint/80 text-primary">
                <PlaySquare className="h-5 w-5" />
              </div>
              <Badge tone="mint">스토어 배포</Badge>
            </div>
            <h2 className="mt-5 text-2xl font-semibold">후원시 유튜브 일시정지</h2>
            <p className="mt-3 break-keep text-sm leading-7 text-muted-foreground">
              후원 영상이 들어오는 동안 YouTube가 잠시 쉬고, 모든 서비스의 영상 후원 대기열이 끝나면 재생이 다시 이어집니다.
            </p>
            <div className="mt-5 grid gap-3">
              {[
                ['지원 브라우저', 'Chrome, Firefox'],
                ['지원 후원', 'CHZZK, CIME, Toonation, AruBot'],
                ['재생 방식', '후원 종료 시 자동 재개'],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between rounded-[var(--radius-control)] border bg-background/70 px-4 py-3 text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <strong className="text-right">{value}</strong>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-[var(--radius-card)] border bg-background/70 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">일시정지 타이머</div>
                <Badge tone="sky">자동</Badge>
              </div>
              <div className="text-[clamp(2rem,5vw,3.25rem)] font-semibold leading-none tabular-nums">03:01</div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full w-[72%] rounded-full bg-[linear-gradient(90deg,hsl(var(--primary)),hsl(var(--accent)))]" />
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[0.68rem] font-semibold text-muted-foreground">
                {['CHZZK', 'CIME', 'Toonation', 'AruBot'].map((service) => (
                  <span key={service} className="truncate rounded-full bg-muted/70 px-2 py-1">{service}</span>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="px-[var(--page-gutter)] py-[clamp(3rem,7vw,5rem)]">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <Badge tone="sky">방송 중 신경 쓸 일을 줄입니다</Badge>
              <h2 className="mt-4 max-w-3xl break-keep text-[clamp(2rem,4.8vw,4rem)] font-semibold leading-tight">
                후원 영상의 집중도를 지켜주는 작은 자동화.
              </h2>
            </div>
            <p className="max-w-md break-keep text-sm leading-7 text-muted-foreground">
              확장 프로그램은 후원 영상의 길이를 따라 YouTube만 잠시 멈춥니다. 방송인은 전환을 신경 쓰지 않고, 시청자는 보낸 영상을 더 선명하게 봅니다.
            </p>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {benefits.map((item, index) => {
              const Icon = item.icon;
              return (
                <article
                  key={item.title}
                  className="animate-fade-up rounded-[var(--radius-card)] border bg-card/78 p-[clamp(1.15rem,2.2vw,1.55rem)] shadow-subtle backdrop-blur-xl"
                  style={{ animationDelay: `${index * 70}ms` }}
                >
                  <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-muted text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-5 text-lg font-semibold">{item.title}</h3>
                  <p className="mt-2 break-keep text-sm leading-7 text-muted-foreground">{item.body}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="px-[var(--page-gutter)] pb-[clamp(3rem,8vw,6rem)]">
        <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[0.72fr_1fr]">
          <div className="rounded-[var(--radius-panel)] border bg-[linear-gradient(135deg,hsl(var(--card)/0.95),hsl(var(--surface-tint)/0.75))] p-[clamp(1.25rem,2.8vw,2rem)] shadow-soft">
            <Badge tone="lemon">설정은 한 번만</Badge>
            <h2 className="mt-4 break-keep text-[clamp(1.6rem,3.2vw,2.5rem)] font-semibold leading-tight">
              오버레이 주소를 저장하면 방송 때마다 바로 사용할 수 있습니다.
            </h2>
            <p className="mt-4 break-keep text-sm leading-7 text-muted-foreground">
              각 서비스의 영상 후원 오버레이 주소를 확장 옵션에 넣고 Monitoring을 켜두면 됩니다. 서비스별 대기열은 따로 관리되고, 재생 재개는 가장 늦게 끝나는 후원에 맞춰집니다.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <StoreButton href={CHROME_EXTENSION_URL} label="Chrome 설치" browser="chrome" variant="outline" />
              <StoreButton href={FIREFOX_EXTENSION_URL} label="Firefox 설치" browser="firefox" variant="outline" />
            </div>
          </div>

          <div className="grid gap-3">
            {steps.map((step, index) => (
              <div key={step} className="grid grid-cols-[auto_1fr] gap-4 rounded-[var(--radius-card)] border bg-card/78 p-4 shadow-subtle backdrop-blur-xl">
                <span className="grid aspect-square w-10 place-items-center rounded-[var(--radius-control)] bg-pastel-sky/70 text-sm font-semibold text-primary">
                  {index + 1}
                </span>
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {index === 1 ? <Settings2 className="h-4 w-4 text-primary" /> : <CheckCircle2 className="h-4 w-4 text-primary" />}
                    사용 방법
                  </div>
                  <p className="mt-1 break-keep text-sm leading-7 text-muted-foreground">{step}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-[var(--page-gutter)] pb-[clamp(3rem,8vw,6rem)]">
        <div className="mx-auto max-w-5xl rounded-[clamp(1.35rem,3vw,2rem)] border bg-[linear-gradient(135deg,hsl(var(--accent-mint)/0.52),hsl(var(--card)/0.92)_46%,hsl(var(--accent-coral)/0.35))] p-[clamp(1.5rem,4vw,3rem)] text-center shadow-glow">
          <div className="mx-auto grid aspect-square w-[clamp(4rem,9vw,6rem)] place-items-center rounded-[var(--radius-panel)] bg-card/80 shadow-subtle">
            <Sparkles className="h-[42%] w-[42%] text-primary" />
          </div>
          <h2 className="mx-auto mt-6 max-w-3xl break-keep text-[clamp(1.8rem,4vw,3.4rem)] font-semibold leading-tight">
            후원 영상이 시작되면, YouTube는 알아서 잠시 멈춥니다.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl break-keep text-sm leading-7 text-muted-foreground md:text-base">
            방송 중에는 한 번 켜두는 것만으로 충분합니다. Chrome과 Firefox 중 사용하는 브라우저에 설치하세요.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <StoreButton href={CHROME_EXTENSION_URL} label="Chrome 웹 스토어" browser="chrome" />
            <StoreButton href={FIREFOX_EXTENSION_URL} label="Firefox 부가 기능" browser="firefox" variant="outline" />
          </div>
        </div>
      </section>
    </main>
  );
}

function StoreButton({
  href,
  label,
  browser,
  variant = 'default',
}: {
  href: string;
  label: string;
  browser: 'chrome' | 'firefox';
  variant?: 'default' | 'outline';
}) {
  return (
    <Button asChild size="lg" variant={variant}>
      <a href={href} target="_blank" rel="noreferrer">
        {browser === 'chrome' ? <ChromeIcon /> : <FirefoxIcon />}
        {label}
        <ArrowRight className="h-4 w-4" />
      </a>
    </Button>
  );
}

function ChromeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0">
      <path fill="#ea4335" d="M12 3a9 9 0 0 1 7.79 4.5h-7.64a4.5 4.5 0 0 0-3.9 2.25L5.05 4.22A8.96 8.96 0 0 1 12 3Z" />
      <path fill="#fbbc04" d="M19.79 7.5A9 9 0 0 1 12 21l3.82-6.62A4.5 4.5 0 0 0 12.15 7.5h7.64Z" />
      <path fill="#34a853" d="M12 21a9 9 0 0 1-7.8-13.5l3.83 6.64A4.5 4.5 0 0 0 12 16.5c.8 0 1.54-.21 2.19-.57L12 21Z" />
      <circle cx="12" cy="12" r="4.05" fill="#4285f4" />
      <circle cx="12" cy="12" r="2.08" fill="#e8f0fe" />
    </svg>
  );
}

function FirefoxIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0">
      <defs>
        <linearGradient id="firefox-flame" x1="4" x2="20" y1="20" y2="4" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffb000" />
          <stop offset="0.48" stopColor="#ff5a1f" />
          <stop offset="1" stopColor="#8a2be2" />
        </linearGradient>
      </defs>
      <path fill="url(#firefox-flame)" d="M20.5 12.2A8.5 8.5 0 1 1 8.73 4.35c.72-.3 1.05-.88.95-1.84 1.22.5 2.18 1.32 2.84 2.45.54-.98 1.58-1.72 3.14-2.22-.28 1.08.04 1.98.96 2.7 2.2 1.72 3.88 3.62 3.88 6.76Z" />
      <path fill="#ffffff" fillOpacity="0.92" d="M16.84 13.25c0 2.36-1.9 4.27-4.25 4.27a4.55 4.55 0 0 1-4.5-4.56c0-1.58.82-2.92 2.06-3.7-.18.56-.1 1.08.26 1.57.44.6 1.08.72 1.92.38-.3-.58-.18-1.22.36-1.9 1.1.35 2.09.9 2.95 1.67.8.72 1.2 1.48 1.2 2.27Z" />
      <path fill="#5f2eea" fillOpacity="0.88" d="M16.65 6.05c-1.58.75-2.68 1.72-3.3 2.92 1.62.14 2.92.7 3.9 1.7.78.8 1.12 1.72 1.02 2.74 1.42-2.35.88-4.8-1.62-7.36Z" />
    </svg>
  );
}
