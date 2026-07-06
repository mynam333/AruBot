'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ImagePlus, Loader2, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { apiUrl, readJson } from '@/shared/api/http';

type Provider = {
  id: 'chzzk' | 'cime' | 'youtube';
  label: string;
  loginPath: string;
  iconPath: string;
};

const providers: Provider[] = [
  { id: 'chzzk', label: 'CHZZK', loginPath: '/api/auth/chzzk/login', iconPath: '/brands/chzzk.svg' },
  { id: 'cime', label: 'CIME', loginPath: '/api/auth/cime/login', iconPath: '/brands/cime.svg' },
  { id: 'youtube', label: 'YouTube', loginPath: '/api/auth/youtube/login?mode=viewer', iconPath: '/brands/youtube.svg' },
];

function safeReturnTo(value?: string | null) {
  const text = String(value || '').trim();
  if (!text) return '/viewer/me';
  if (text.startsWith('/viewer/') || text.startsWith('/c/')) return text;
  return '/viewer/me';
}

function loginHref(provider: Provider, returnTo: string) {
  const separator = provider.loginPath.includes('?') ? '&' : '?';
  return apiUrl(`${provider.loginPath}${separator}returnTo=${encodeURIComponent(returnTo)}`);
}

export function ViewerLoginPage({ returnTo: rawReturnTo }: { returnTo?: string | null }) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const returnTo = useMemo(() => safeReturnTo(rawReturnTo), [rawReturnTo]);

  useEffect(() => {
    let alive = true;
    readJson<{ userId?: string | null }>('/api/account/platforms')
      .then((payload) => {
        if (!alive) return;
        if (payload?.userId) router.replace(returnTo);
        else setChecking(false);
      })
      .catch(() => {
        if (alive) setChecking(false);
      });
    return () => {
      alive = false;
    };
  }, [returnTo, router]);

  return (
    <main className="min-h-screen px-[var(--page-gutter)] py-[clamp(1rem,2.6vw,1.75rem)]">
      <header className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <Link href="/" className="inline-flex items-center gap-3 rounded-full bg-card/75 px-3 py-2 shadow-subtle backdrop-blur-xl transition hover:-translate-y-0.5">
          <img src="/files/logo.png" alt="" className="aspect-square w-[clamp(2rem,4vw,2.5rem)] object-contain" />
          <span className="text-sm font-semibold">AruBot</span>
        </Link>
        <ThemeToggle />
      </header>

      <section className="mx-auto mt-[clamp(3rem,8vw,6rem)] grid max-w-6xl gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.42fr)] lg:items-center">
        <div className="rounded-[var(--radius-panel)] border bg-[linear-gradient(135deg,hsl(var(--card)),hsl(var(--accent-mint)/0.36),hsl(var(--accent-sky)/0.24))] p-[clamp(1.5rem,4vw,3rem)] shadow-soft">
          <Badge tone="mint">
            <ImagePlus className="mr-1 h-3.5 w-3.5" />
            그림 후원 로그인
          </Badge>
          <h1 className="mt-5 max-w-3xl break-keep text-[clamp(2.2rem,5.8vw,4.6rem)] font-semibold leading-tight">
            로그인하고 방송 화면 위에 그림을 그려요.
          </h1>
          <p className="mt-5 max-w-2xl break-keep text-sm leading-7 text-muted-foreground md:text-base">
            시청자 포인트를 확인한 뒤, 스트리머가 켜둔 그림 후원 페이지로 바로 이동합니다.
          </p>
          <p className="mt-3 max-w-2xl break-keep text-xs leading-6 text-muted-foreground">
            로그인과 그림 후원 참여 기록은 저장형 기능입니다. 만 14세 미만은 법정대리인 동의 후 이용해야 합니다.
          </p>
          {checking ? (
            <div className="mt-7 inline-flex items-center gap-2 rounded-full border bg-background/70 px-4 py-2 text-sm font-semibold text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              로그인 상태 확인 중
            </div>
          ) : null}
        </div>

        <Card className="bg-card/86">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              시청자 계정으로 계속하기
            </CardTitle>
            <CardDescription>사용 중인 플랫폼으로 로그인하면 신청 가능한 그림 후원 화면으로 돌아갑니다.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {providers.map((provider) => (
              <Button key={provider.id} asChild variant="outline" className="min-h-[var(--control-height-lg)] justify-start bg-background/75">
                <a href={loginHref(provider, returnTo)}>
                  <span className="grid aspect-square h-8 w-8 place-items-center rounded-[var(--radius-control)] border bg-white">
                    <img src={provider.iconPath} alt="" aria-hidden="true" className="max-h-[72%] max-w-[72%] object-contain" />
                  </span>
                  {provider.label}로 로그인
                </a>
              </Button>
            ))}
            <LinkButton href="/viewer/connect" variant="soft" className="mt-2 justify-center">
              계정 연결 페이지로 이동
            </LinkButton>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
