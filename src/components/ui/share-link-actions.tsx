'use client';

import { Copy, Loader2, Share2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/shared/lib/utils';
import { createShortShareUrl, writeClipboardText } from '@/shared/lib/share-links';

type PendingAction = 'copy' | 'share' | null;

export function ShareLinkActions({
  path,
  title,
  text,
  className,
  showCopy = false,
  copyLabel = '짧은 링크 복사',
  shareLabel = '공유',
  disabled = false,
  size = 'sm',
}: {
  path: string;
  title: string;
  text?: string;
  className?: string;
  showCopy?: boolean;
  copyLabel?: string;
  shareLabel?: string;
  disabled?: boolean;
  size?: 'sm' | 'default';
}) {
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const unavailable = disabled || !path || pendingAction !== null;

  const copy = async () => {
    setPendingAction('copy');
    try {
      const shortUrl = await createShortShareUrl(path);
      await writeClipboardText(shortUrl);
      toast.success('짧은 링크를 복사했어요.');
    } catch {
      toast.error('짧은 링크를 만들지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setPendingAction(null);
    }
  };

  const share = async () => {
    setPendingAction('share');
    try {
      const shortUrl = await createShortShareUrl(path);
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title, text, url: shortUrl });
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return;
        }
      }
      await writeClipboardText(shortUrl);
      toast.success('공유할 짧은 링크를 복사했어요.');
    } catch {
      toast.error('공유 링크를 준비하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className={cn('flex min-w-0 flex-wrap gap-2', className)}>
      {showCopy ? (
        <Button type="button" variant="secondary" size={size} onClick={copy} disabled={unavailable}>
          {pendingAction === 'copy' ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
          {copyLabel}
        </Button>
      ) : null}
      <Button type="button" variant="outline" size={size} onClick={share} disabled={unavailable}>
        {pendingAction === 'share' ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Share2 aria-hidden="true" className="h-4 w-4" />}
        {shareLabel}
      </Button>
    </div>
  );
}
