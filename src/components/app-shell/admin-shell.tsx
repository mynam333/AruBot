'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Cable, Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { adminNav, adminNavGroups } from '@/shared/config/navigation';
import { cn } from '@/shared/lib/utils';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Button, LinkButton } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { LegalFooter } from '@/components/app-shell/legal-footer';
import { readJsonResult } from '@/shared/api/http';

type AdminAccess = {
  isAdmin?: boolean;
};

let adminAccessCache: { value: boolean; expiresAt: number } | null = null;
let adminAccessPromise: Promise<boolean> | null = null;

async function readAdminAccess() {
  const now = Date.now();
  if (adminAccessCache && adminAccessCache.expiresAt > now) return adminAccessCache.value;
  if (!adminAccessPromise) {
    adminAccessPromise = readJsonResult<AdminAccess>('/api/arubot-admin/me')
      .then((result) => {
        if (!result.ok) return false;
        const value = result.data?.isAdmin === true;
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

function isItemActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function getActiveLabel(pathname: string, isAdmin: boolean) {
  return getVisibleNav(isAdmin).find((item) => isItemActive(pathname, item.href))?.label || '방송 관리';
}

function Brand({ compact = false, onClick }: { compact?: boolean; onClick?: () => void }) {
  return (
    <Link
      href="/"
      onClick={onClick}
      aria-label={compact ? 'AruBot 홈' : undefined}
      className={cn(
        'flex items-center rounded-[var(--radius-control)] transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        compact ? 'justify-center p-2' : 'gap-3 px-2 py-2.5',
      )}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg border bg-card shadow-subtle">
        <img src="/files/logo.png" alt="" aria-hidden="true" className="h-full w-full object-cover" draggable={false} />
      </span>
      {!compact ? (
        <span className="min-w-0">
          <span className="block text-sm font-bold leading-tight tracking-tight">AruBot</span>
          <span className="mt-0.5 block truncate text-[0.6875rem] font-medium text-muted-foreground">방송 운영 콘솔</span>
        </span>
      ) : null}
    </Link>
  );
}

function NavItem({
  item,
  pathname,
  compact = false,
  onNavigate,
}: {
  item: (typeof adminNav)[number];
  pathname: string;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const active = isItemActive(pathname, item.href);
  const Icon = item.icon;
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      prefetch={false}
      aria-current={active ? 'page' : undefined}
      aria-label={compact ? item.label : undefined}
      className={cn(
        'group relative flex min-h-[var(--control-height)] items-center rounded-[var(--radius-control)] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        compact ? 'justify-center px-2' : 'gap-3 px-3',
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {active ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" /> : null}
      <Icon className="h-[1.125rem] w-[1.125rem] shrink-0" strokeWidth={active ? 2.25 : 1.8} />
      {!compact ? <span className="truncate">{item.label}</span> : null}
    </Link>
  );

  return compact ? <Tooltip content={item.label} side="right">{link}</Tooltip> : link;
}

function GroupedNav({ compact = false, onNavigate, isAdmin }: { compact?: boolean; onNavigate?: () => void; isAdmin: boolean }) {
  const pathname = usePathname();
  const nav = getVisibleNav(isAdmin);
  if (compact) {
    return (
      <nav aria-label="관리 메뉴" className="grid gap-1">
        {nav.map((item) => <NavItem key={item.href} item={item} pathname={pathname} compact onNavigate={onNavigate} />)}
      </nav>
    );
  }

  return (
    <nav aria-label="관리 메뉴" className="grid gap-5">
      {adminNavGroups.map((group) => {
        const items = nav.filter((item) => item.group === group.id);
        if (!items.length) return null;
        return (
          <div key={group.id}>
            <div className="mb-1.5 px-3 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">{group.label}</div>
            <div className="grid gap-1">
              {items.map((item) => <NavItem key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />)}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function MobileBottomNav({ isAdmin, openMenu }: { isAdmin: boolean; openMenu: () => void }) {
  const pathname = usePathname();
  const nav = getVisibleNav(isAdmin);
  const items = ['/dashboard', '/commands', '/points', '/roulette']
    .map((href) => nav.find((item) => item.href === href))
    .filter((item): item is (typeof adminNav)[number] => Boolean(item));

  return (
    <nav aria-label="빠른 메뉴" className="fixed inset-x-0 bottom-0 z-40 grid h-[calc(4rem+env(safe-area-inset-bottom))] grid-cols-5 border-t bg-card/95 px-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_hsl(222_30%_6%/0.08)] backdrop-blur md:hidden">
      {items.map((item) => {
        const Icon = item.icon;
        const active = isItemActive(pathname, item.href);
        return (
          <Link key={item.href} href={item.href} prefetch={false} aria-current={active ? 'page' : undefined} className={cn('flex min-w-0 flex-col items-center justify-center gap-1 text-[0.625rem] font-semibold transition-colors', active ? 'text-primary' : 'text-muted-foreground')}>
            <Icon className="h-5 w-5" strokeWidth={active ? 2.3 : 1.8} />
            <span className="truncate">{item.label.replace('채팅 ', '').replace('시청자 ', '')}</span>
          </Link>
        );
      })}
      <button type="button" onClick={openMenu} className="flex min-w-0 flex-col items-center justify-center gap-1 text-[0.625rem] font-semibold text-muted-foreground" aria-label="전체 메뉴 열기">
        <Menu className="h-5 w-5" />
        <span>전체</span>
      </button>
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
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[var(--shell-sidebar)] overflow-y-auto border-r bg-card p-4 scrollbar-none overscroll-contain xl:block">
        <Brand />
        <div className="mt-6 pb-4"><GroupedNav isAdmin={isAdmin} /></div>
      </aside>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[var(--shell-rail)] flex-col border-r bg-card px-2 py-3 md:flex xl:hidden">
        <Brand compact />
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto scrollbar-none"><GroupedNav compact isAdmin={isAdmin} /></div>
      </aside>

      <header className="sticky top-0 z-20 border-b bg-card/95 backdrop-blur">
        <div className="flex min-h-[var(--shell-header)] items-center gap-3 px-[var(--page-gutter)] md:pl-[calc(var(--shell-rail)+var(--page-gutter))] xl:pl-[calc(var(--shell-sidebar)+var(--page-gutter))]">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(true)} aria-label="전체 메뉴 열기">
            <Menu className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold tracking-tight">{title}</div>
            <div className="hidden truncate text-xs text-muted-foreground sm:block">실시간 방송 운영과 시청자 참여를 관리합니다.</div>
          </div>
          <div className="flex items-center gap-2">
            <LinkButton href="/connection" variant="outline" size="sm" className="hidden sm:inline-flex">
              <Cable className="h-4 w-4" />플랫폼 연결
            </LinkButton>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {open ? (
        <div className="fixed inset-0 z-50 xl:hidden" role="dialog" aria-modal="true" aria-label="전체 메뉴">
          <button className="absolute inset-0 bg-slate-950/55" aria-label="메뉴 닫기" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[min(88vw,20rem)] flex-col overflow-hidden border-r bg-card p-4 shadow-2xl">
            <div className="mb-5 flex shrink-0 items-center justify-between">
              <Brand onClick={() => setOpen(false)} />
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="메뉴 닫기"><X className="h-5 w-5" /></Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-none overscroll-contain">
              <GroupedNav isAdmin={isAdmin} onNavigate={() => setOpen(false)} />
            </div>
          </aside>
        </div>
      ) : null}

      <main className="px-[var(--page-gutter)] pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-[clamp(1.25rem,2.4vw,1.75rem)] md:pb-7 md:pl-[calc(var(--shell-rail)+var(--page-gutter))] xl:pl-[calc(var(--shell-sidebar)+var(--page-gutter))]">
        <div className="mx-auto flex w-full max-w-[90rem] flex-col gap-5 md:gap-6">
          {children}
          <LegalFooter className="mt-2" />
        </div>
      </main>
      <MobileBottomNav isAdmin={isAdmin} openMenu={() => setOpen(true)} />
    </div>
  );
}
