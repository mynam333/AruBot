'use client';

import { useEffect, useState } from 'react';
import { BROADCAST_BONUS_CATEGORIES, MAX_BROADCAST_BONUS } from '../../../shared/broadcast-bonus.js';
import { readJson } from '@/shared/api/http';
import { BroadcastBonusDisclosure } from '@/features/points/broadcast-bonus-disclosure';

type PublicBonus = { live: boolean; amount: number; categories: string[]; remaining: number | null };

function isActive(bonus: PublicBonus | null): bonus is PublicBonus {
  return bonus?.live === true && Number.isSafeInteger(bonus.amount) && bonus.amount > 0 && bonus.amount <= MAX_BROADCAST_BONUS
    && Array.isArray(bonus.categories) && bonus.categories.length > 0
    && bonus.categories.every((id) => BROADCAST_BONUS_CATEGORIES.some((category) => category.id === id))
    && (bonus.remaining === null || (Number.isSafeInteger(bonus.remaining) && bonus.remaining >= 0 && bonus.remaining <= bonus.amount));
}

export function PublicBroadcastBonus({ channelUid }: { channelUid: string }) {
  const [bonus, setBonus] = useState<PublicBonus | null>(null);

  useEffect(() => {
    const path = `/api/public/${encodeURIComponent(channelUid)}/broadcast-bonus`;
    let request: AbortController | null = null;

    const load = async () => {
      if (request || document.hidden || !navigator.onLine) return;
      const controller = new AbortController();
      request = controller;
      const next = await readJson<PublicBonus>(path, {
        credentials: 'include', cache: 'no-store', signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      request = null;
      setBonus(isActive(next) ? next : null);
    };

    // A delayed response from the previous login must never repopulate a balance.
    const clear = () => {
      request?.abort();
      request = null;
      setBonus(null);
    };
    const revalidate = () => { clear(); void load(); };
    const events = ['focus', 'pageshow', 'online', 'arubot:auth-changed', 'arubot:logout', 'arubot:session-expired'];
    void load();
    const timer = window.setInterval(load, 10_000);
    events.forEach((event) => window.addEventListener(event, revalidate));
    window.addEventListener('pagehide', clear);
    window.addEventListener('offline', clear);
    document.addEventListener('visibilitychange', revalidate);
    return () => {
      request?.abort();
      window.clearInterval(timer);
      events.forEach((event) => window.removeEventListener(event, revalidate));
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('offline', clear);
      document.removeEventListener('visibilitychange', revalidate);
    };
  }, [channelUid]);

  const labels = BROADCAST_BONUS_CATEGORIES.filter(({ id }) => bonus?.categories.includes(id)).map(({ label }) => label);
  return (
    <BroadcastBonusDisclosure hidden={!bonus}>
      {bonus && <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">이번 방송에서만 사용할 수 있으며 랭킹에는 포함되지 않습니다.</p>
        <p className="mt-1 break-keep text-sm">사용처: {labels.join(' · ')}</p>
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-2">
        <div><dt className="text-xs text-muted-foreground">1인 한도</dt><dd className="font-semibold tabular-nums">{bonus.amount.toLocaleString('ko-KR')}P</dd></div>
        {bonus.remaining !== null ? (
          <div><dt className="text-xs text-muted-foreground">내 잔액</dt><dd className="font-semibold tabular-nums text-primary">{bonus.remaining.toLocaleString('ko-KR')}P</dd></div>
        ) : null}
      </dl>
      </div>}
    </BroadcastBonusDisclosure>
  );
}
