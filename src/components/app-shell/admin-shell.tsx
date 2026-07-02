'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Cable, Menu, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { adminNav } from '@/shared/config/navigation';
import { cn } from '@/shared/lib/utils';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Button, LinkButton } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';

function getActiveLabel(pathname: string) {
  const active = adminNav.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  return active?.label || '방송 관리';
}

function Brand({ onClick }: { onClick?: () => void }) {
  return (
    <Link href="/dashboard" onClick={onClick} className="group flex items-center gap-3 rounded-[var(--radius-control)] px-[clamp(0.5rem,1vw,0.75rem)] py-[clamp(0.5rem,1vw,0.75rem)] transition hover:bg-muted/70">
      <span className="grid aspect-square w-[var(--icon-box)] place-items-center overflow-hidden rounded-[var(--radius-control)] bg-card shadow-subtle transition group-hover:-translate-y-0.5 group-hover:shadow-lift">
        <img
          src="/files/logo.png"
          alt=""
          aria-hidden="true"
          className="h-full w-full object-cover"
          draggable={false}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-base font-semibold leading-tight">AruBot</span>
        <span className="block truncate text-xs font-medium text-muted-foreground">CHZZK · CIME 방송 도우미</span>
      </span>
    </Link>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="grid gap-1">
      {adminNav.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            prefetch={false}
            className={cn(
              'group flex min-h-[var(--control-height)] items-center gap-3 rounded-[var(--radius-control)] px-[clamp(0.75rem,1.4vw,1rem)] text-sm font-medium text-muted-foreground transition',
              'hover:bg-muted/75 hover:text-foreground',
              active && 'bg-pastel-mint/70 text-foreground shadow-subtle ring-1 ring-primary/15 dark:bg-primary/20',
            )}
          >
            <Icon className={cn('h-4 w-4 shrink-0 transition group-hover:text-primary', active && 'text-primary')} />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const title = getActiveLabel(pathname);
  const quickNav = useMemo(
    () =>
      adminNav
        .filter((item) => ['/dashboard', '/connection', '/commands', '/points', '/roulette'].includes(item.href))
        .map((item) => ({
          ...item,
          mobileLabel:
            item.href === '/dashboard'
              ? '홈'
              : item.href === '/connection'
                ? '연결'
                : item.href === '/commands'
                  ? '명령어'
                  : item.href === '/points'
                    ? '포인트'
                    : '룰렛',
        })),
    [],
  );

  return (
    <div className="min-h-screen pb-20 xl:pb-0">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[var(--shell-sidebar)] border-r bg-card/90 p-[var(--page-gutter)] backdrop-blur-xl xl:block">
        <Brand />
        <div className="mt-5 max-h-[calc(100vh-7rem)] overflow-y-auto pr-1">
          <NavList />
        </div>
      </aside>

      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur-xl">
        <div className="flex min-h-[var(--shell-header)] items-center gap-3 px-[var(--page-gutter)] xl:pl-[calc(var(--shell-sidebar)+var(--page-gutter))] xl:pr-[var(--page-gutter)]">
          <Tooltip content="메뉴 열기">
            <Button variant="outline" size="icon" className="xl:hidden" onClick={() => setOpen(true)} aria-label="메뉴 열기">
              <Menu className="h-4 w-4" />
            </Button>
          </Tooltip>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold md:text-base">{title}</div>
            <div className="hidden truncate text-xs text-muted-foreground sm:block">방송 전 설정부터 진행 중 관리까지 한 화면 흐름으로 이어집니다.</div>
          </div>
          <div className="flex items-center gap-2">
            <LinkButton href="/connection" variant="outline" size="sm" className="hidden sm:inline-flex">
              <Cable className="h-4 w-4" />
              플랫폼 연결
            </LinkButton>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {open ? (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button className="absolute inset-0 bg-black/40" aria-label="메뉴 닫기" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[min(86vw,calc(var(--shell-sidebar)*1.12))] border-r bg-background p-[var(--page-gutter)] shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <Brand onClick={() => setOpen(false)} />
              <Tooltip content="메뉴 닫기">
                <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="메뉴 닫기">
                  <X className="h-4 w-4" />
                </Button>
              </Tooltip>
            </div>
            <NavList onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      ) : null}

      <main className="px-[var(--page-gutter)] py-[clamp(1.25rem,2.4vw,1.75rem)] xl:pl-[calc(var(--shell-sidebar)+var(--page-gutter))] xl:pr-[var(--page-gutter)]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 md:gap-6">{children}</div>
      </main>

      <nav className="fixed inset-x-[clamp(0.75rem,2vw,1rem)] bottom-[clamp(0.75rem,2vw,1rem)] z-40 grid grid-cols-5 gap-1 rounded-[var(--radius-panel)] border bg-card/95 p-[clamp(0.25rem,0.8vw,0.375rem)] shadow-lift backdrop-blur-xl xl:hidden">
        {quickNav.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              className={cn(
                'flex min-w-0 flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] px-[clamp(0.25rem,1vw,0.5rem)] py-[clamp(0.5rem,1.4vw,0.75rem)] text-[0.6875rem] font-semibold text-muted-foreground transition',
                active && 'bg-pastel-mint/70 text-foreground shadow-subtle dark:bg-primary/20',
              )}
            >
              <Icon className={cn('h-4 w-4', active && 'text-primary')} />
              <span className="max-w-full truncate">{item.mobileLabel}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
