'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Cable, Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { adminNav } from '@/shared/config/navigation';
import { cn } from '@/shared/lib/utils';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Button, LinkButton } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { LegalFooter } from '@/components/app-shell/legal-footer';
import { readJson } from '@/shared/api/http';

type AdminAccess = {
  isAdmin?: boolean;
};

let adminAccessCache: { value: boolean; expiresAt: number } | null = null;
let adminAccessPromise: Promise<boolean> | null = null;

async function readAdminAccess() {
  const now = Date.now();
  if (adminAccessCache && adminAccessCache.expiresAt > now) return adminAccessCache.value;
  if (!adminAccessPromise) {
    adminAccessPromise = readJson<AdminAccess>('/api/arubot-admin/me')
      .then((status) => {
        const value = status?.isAdmin === true;
        adminAccessCache = { value, expiresAt: Date.now() + 5 * 60 * 1000 };
        return value;
      })
      .finally(() => {
        adminAccessPromise = null;
      });
  }
  return adminAccessPromise;
}

function getVisibleNav(isAdmin: boolean) {
  return adminNav.filter((item) => !item.adminOnly || isAdmin);
}

function getActiveLabel(pathname: string, isAdmin: boolean) {
  const active = getVisibleNav(isAdmin).find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
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
        <span className="block truncate text-xs font-medium text-muted-foreground">멀티플랫폼 방송 도우미</span>
      </span>
    </Link>
  );
}

function NavList({ onNavigate, isAdmin }: { onNavigate?: () => void; isAdmin: boolean }) {
  const pathname = usePathname();
  const nav = getVisibleNav(isAdmin);
  return (
    <nav className="grid gap-1">
      {nav.map((item) => {
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
  const [isAdmin, setIsAdmin] = useState(false);
  const pathname = usePathname();
  const title = getActiveLabel(pathname, isAdmin);

  useEffect(() => {
    let alive = true;
    readAdminAccess().then((nextIsAdmin) => {
      if (alive) setIsAdmin(nextIsAdmin);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[var(--shell-sidebar)] overflow-y-auto border-r bg-card/90 p-[var(--page-gutter)] backdrop-blur-xl scrollbar-none overscroll-contain xl:block">
        <Brand />
        <div className="mt-5 pr-1">
          <NavList isAdmin={isAdmin} />
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
            <div className="hidden truncate text-xs text-muted-foreground sm:block">방송 준비와 진행 관리를 한 화면에서 확인해요.</div>
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
          <aside className="absolute inset-y-0 left-0 flex w-[min(86vw,calc(var(--shell-sidebar)*1.12))] flex-col overflow-hidden border-r bg-background p-[var(--page-gutter)] shadow-2xl">
            <div className="mb-5 flex shrink-0 items-center justify-between">
              <Brand onClick={() => setOpen(false)} />
              <Tooltip content="메뉴 닫기">
                <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="메뉴 닫기">
                  <X className="h-4 w-4" />
                </Button>
              </Tooltip>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-none overscroll-contain">
              <NavList isAdmin={isAdmin} onNavigate={() => setOpen(false)} />
            </div>
          </aside>
        </div>
      ) : null}

      <main className="px-[var(--page-gutter)] py-[clamp(1.25rem,2.4vw,1.75rem)] xl:pl-[calc(var(--shell-sidebar)+var(--page-gutter))] xl:pr-[var(--page-gutter)]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 md:gap-6">
          {children}
          <LegalFooter className="mt-2" />
        </div>
      </main>
    </div>
  );
}
