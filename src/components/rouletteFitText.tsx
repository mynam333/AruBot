import React from 'react';

/** Fits the complete result inside a fixed slot without changing spin geometry. */
export const RouletteFitText = React.memo(function RouletteFitText({
  children, max = 36, min = 10, className = '',
}: { children: string; max?: number; min?: number; className?: string }) {
  const hostRef = React.useRef<HTMLSpanElement>(null);
  const textRef = React.useRef<HTMLSpanElement>(null);
  React.useLayoutEffect(() => {
    const host = hostRef.current;
    const text = textRef.current;
    if (!host || !text) return;
    let disposed = false;
    const fit = () => {
      if (disposed || !host.clientWidth || !host.clientHeight) return;
      let low = min;
      let high = max;
      text.style.fontSize = `${high}px`;
      const fits = () => text.scrollWidth <= host.clientWidth + 1 && text.scrollHeight <= host.clientHeight + 1;
      if (fits()) return;
      for (let step = 0; step < 7; step += 1) {
        const middle = (low + high) / 2;
        text.style.fontSize = `${middle}px`;
        if (fits()) low = middle;
        else high = middle;
      }
      text.style.fontSize = `${low}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    document.fonts?.ready.then(fit).catch(() => {});
    return () => { disposed = true; observer.disconnect(); };
  }, [children, max, min]);
  return <span ref={hostRef} className={`roulette-fit ${className}`}><span ref={textRef} style={{ fontSize: max }}>{children}</span></span>;
});
