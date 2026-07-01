import fs from 'fs';
import path from 'path';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Download, HardDrive, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';

type LocalProgramManifest = {
  version: string;
  fileName: string;
  url: string;
  sha256: string;
  size: number;
  releasedAt: string;
  notes?: string[];
};

export const dynamic = 'force-dynamic';

function formatBytes(value: number) {
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(0)}KB`;
  return `${value}B`;
}

async function readManifest(): Promise<LocalProgramManifest | null> {
  const externalManifestUrl = process.env.LOCAL_PROGRAM_MANIFEST_URL || process.env.NEXT_PUBLIC_LOCAL_PROGRAM_MANIFEST_URL;
  if (externalManifestUrl) {
    try {
      const response = await fetch(externalManifestUrl, { cache: 'no-store' });
      if (!response.ok) return null;
      return await response.json() as LocalProgramManifest;
    } catch {
      return null;
    }
  }

  const manifestPath = path.join(process.cwd(), 'public', 'downloads', 'local-program', 'latest.json');
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as LocalProgramManifest;
  } catch {
    return null;
  }
}

export default async function LocalProgramDownloadPage() {
  const manifest = await readManifest();
  const releasedAt = manifest?.releasedAt ? new Date(manifest.releasedAt).toLocaleDateString('ko-KR') : null;

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
            <Badge tone="mint">방송 PC 자동화 프로그램</Badge>
            <h1 className="mt-5 max-w-4xl break-keep text-[clamp(2.4rem,6.4vw,5.4rem)] font-semibold leading-[1.03] tracking-normal">
              OBS와 로컬 방송 도구를 아루봇에 연결하세요.
            </h1>
            <p className="mt-6 max-w-2xl break-keep text-base leading-8 text-muted-foreground md:text-lg">
              AruBot Local Program은 방송 PC에서 T.I.T.S., Toonation, TTS, 사운드 파일, 제어 버튼을 실행합니다.
              민감한 키와 대용량 파일은 내 컴퓨터에 두고, 웹 콘솔에서는 필요한 액션만 편하게 보낼 수 있습니다.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {manifest ? (
                <LinkButton href={manifest.url} size="lg">
                  Windows용 다운로드
                  <Download className="h-4 w-4" />
                </LinkButton>
              ) : (
                <LinkButton href="/automations" size="lg">
                  자동화 설정 보기
                  <ArrowRight className="h-4 w-4" />
                </LinkButton>
              )}
              <LinkButton href="/automations" variant="soft" size="lg">
                연결 토큰 만들기
                <Sparkles className="h-4 w-4" />
              </LinkButton>
            </div>
          </div>

          <aside className="animate-fade-up rounded-[var(--radius-panel)] border bg-card/78 p-[clamp(1.15rem,2.4vw,1.75rem)] shadow-glow backdrop-blur-2xl" style={{ animationDelay: '80ms' }}>
            <div className="flex items-center justify-between gap-3">
              <div className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-pastel-mint/80 text-primary">
                <HardDrive className="h-5 w-5" />
              </div>
              <Badge tone={manifest ? 'mint' : 'neutral'}>{manifest ? '다운로드 가능' : '빌드 필요'}</Badge>
            </div>
            <h2 className="mt-5 text-2xl font-semibold">AruBot Local Program</h2>
            <div className="mt-5 grid gap-3">
              <div className="flex items-center justify-between rounded-[var(--radius-control)] border bg-background/70 px-4 py-3 text-sm">
                <span className="text-muted-foreground">버전</span>
                <strong>{manifest?.version || '준비 중'}</strong>
              </div>
              <div className="flex items-center justify-between rounded-[var(--radius-control)] border bg-background/70 px-4 py-3 text-sm">
                <span className="text-muted-foreground">파일 크기</span>
                <strong>{manifest ? formatBytes(manifest.size) : '-'}</strong>
              </div>
              <div className="flex items-center justify-between rounded-[var(--radius-control)] border bg-background/70 px-4 py-3 text-sm">
                <span className="text-muted-foreground">배포일</span>
                <strong>{releasedAt || '-'}</strong>
              </div>
            </div>
            <div className="mt-5 grid gap-3">
              {[
                { icon: RefreshCw, title: '프로그램 안에서 업데이트 확인', body: '새 버전이 있으면 버튼으로 설치 파일을 받아 실행합니다.' },
                { icon: ShieldCheck, title: '로컬 보관', body: '토큰과 후원 알림 키는 방송 PC 사용자 데이터 영역에 저장됩니다.' },
                { icon: CheckCircle2, title: '방송 도구 실행', body: 'TTS, 사운드, T.I.T.S. 작업을 웹 콘솔 액션과 연결합니다.' },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="grid grid-cols-[auto_1fr] gap-3 rounded-[var(--radius-card)] border bg-background/70 p-4">
                    <Icon className="mt-0.5 h-5 w-5 text-primary" />
                    <div>
                      <div className="text-sm font-semibold">{item.title}</div>
                      <p className="mt-1 break-keep text-xs leading-5 text-muted-foreground">{item.body}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            {manifest?.sha256 ? (
              <div className="mt-5 rounded-[var(--radius-control)] bg-muted p-3">
                <div className="text-xs font-semibold text-muted-foreground">SHA-256</div>
                <code className="mt-1 block break-all text-xs text-muted-foreground">{manifest.sha256}</code>
              </div>
            ) : null}
          </aside>
        </div>
      </section>
    </main>
  );
}
