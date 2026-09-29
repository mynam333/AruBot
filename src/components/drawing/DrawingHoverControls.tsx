'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

export function DrawingHoverControls({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false), [drawing, setDrawing] = useState(false);

  useEffect(() => {
    const drawingPointers = new Set<number>(), controlPointers = new Set<number>();
    const update = (event: PointerEvent) => {
      const blocked = drawingPointers.size > 0 || (event.buttons !== 0 && controlPointers.size === 0);
      setDrawing(blocked);
      if (blocked) { setHovered(false); return; }
      const bounds = ref.current?.getBoundingClientRect();
      setHovered(controlPointers.size > 0 || Boolean(bounds && event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom));
    };
    const down = (event: PointerEvent) => {
      (ref.current?.contains(event.target as Node) ? controlPointers : drawingPointers).add(event.pointerId);
      setFocused(false); update(event);
    };
    const up = (event: PointerEvent) => { drawingPointers.delete(event.pointerId); controlPointers.delete(event.pointerId); update(event); };
    const cancel = (event: PointerEvent) => { drawingPointers.delete(event.pointerId); controlPointers.delete(event.pointerId); setDrawing(drawingPointers.size > 0); setHovered(false); };
    const leave = () => { if (!controlPointers.size) setHovered(false); };
    const blur = () => { drawingPointers.clear(); controlPointers.clear(); setDrawing(false); setHovered(false); setFocused(false); };
    window.addEventListener('pointermove', update, true);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    document.documentElement.addEventListener('pointerleave', leave);
    window.addEventListener('scroll', leave, true);
    window.addEventListener('resize', leave);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('pointermove', update, true);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      document.documentElement.removeEventListener('pointerleave', leave);
      window.removeEventListener('scroll', leave, true);
      window.removeEventListener('resize', leave);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const visible = !drawing && (hovered || focused);
  return <div ref={ref} role="group" aria-label="방송 음량 조절" data-visible={visible}
    onFocusCapture={(event) => { if (event.target.matches(':focus-visible')) setFocused(true); }}
    onKeyDownCapture={() => setFocused(true)}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    className={`absolute right-3 top-3 z-40 flex max-w-[calc(100%_-_1.5rem)] items-center gap-2 rounded-lg border bg-card/90 px-2 py-1.5 shadow-subtle backdrop-blur-xl ${visible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'} ${!drawing ? '[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100' : ''}`}>
    {children}
  </div>;
}
