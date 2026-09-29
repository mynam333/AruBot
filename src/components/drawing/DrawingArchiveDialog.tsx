'use client';

import { useEffect, useRef, useState } from 'react';
import { FolderOpen, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { DrawingArchivePlayer } from './DrawingArchivePlayer';

export function DrawingArchiveDialog({ compact = false, onOpen }: { compact?: boolean; onOpen?: () => void }) {
  const [open, setOpen] = useState(false), dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  return <>
    <Tooltip content="로컬 파일 재생"><Button type="button" size={compact ? 'icon' : 'default'} variant="outline" aria-label="로컬 파일 재생" onClick={() => { onOpen?.(); setOpen(true); }}><FolderOpen size={17} />{compact ? null : '로컬 파일 재생'}</Button></Tooltip>
    <dialog ref={dialog} aria-label="로컬 파일 재생" onKeyDown={(event) => event.stopPropagation()} onCancel={() => setOpen(false)} onClose={() => setOpen(false)} className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-5xl overflow-y-auto rounded-lg border bg-background text-foreground shadow-xl backdrop:bg-black/60">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-4 py-2"><h2 className="text-base font-semibold">로컬 파일 재생</h2><Button size="icon" variant="ghost" aria-label="로컬 파일 재생 닫기" onClick={() => setOpen(false)}><X size={17} /></Button></div>
      {open ? <DrawingArchivePlayer /> : null}
    </dialog>
  </>;
}
