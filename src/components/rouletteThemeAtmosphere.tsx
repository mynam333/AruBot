import React from 'react';
import type { RouletteAtmosphereKind } from './rouletteThemeMaterials';

const dust = Array.from({ length: 18 }, (_, index) => ({
  id: index,
  x: (index * 37) % 100,
  y: (index * 61) % 100,
  size: 1 + (index % 3),
  delay: -((index * 0.47) % 5),
}));

const petals = Array.from({ length: 12 }, (_, index) => ({
  id: index,
  x: (index * 29) % 100,
  delay: -((index * 0.83) % 8),
  duration: 7 + (index % 4),
  rotate: (index * 47) % 180,
}));

const bubbles = Array.from({ length: 10 }, (_, index) => ({
  id: index,
  x: 8 + ((index * 31) % 84),
  size: 8 + ((index * 7) % 18),
  delay: -((index * 0.71) % 7),
}));

function ThemeMotif({ kind }: { kind: RouletteAtmosphereKind }) {
  if (kind === 'sakura') {
    return (
      <div className="roulette-atmosphere__particles" aria-hidden="true">
        {petals.map((petal) => (
          <span
            key={petal.id}
            className="roulette-atmosphere__petal"
            style={{ left: `${petal.x}%`, animationDelay: `${petal.delay}s`, animationDuration: `${petal.duration}s`, ['--petal-rotate' as string]: `${petal.rotate}deg` }}
          />
        ))}
      </div>
    );
  }

  if (kind === 'ocean') {
    return (
      <div className="roulette-atmosphere__particles" aria-hidden="true">
        {bubbles.map((bubble) => (
          <span
            key={bubble.id}
            className="roulette-atmosphere__bubble"
            style={{ left: `${bubble.x}%`, width: bubble.size, height: bubble.size, animationDelay: `${bubble.delay}s` }}
          />
        ))}
      </div>
    );
  }

  if (kind === 'nova' || kind === 'gold' || kind === 'velvet' || kind === 'solar') {
    return (
      <div className="roulette-atmosphere__particles" aria-hidden="true">
        {dust.map((particle) => (
          <span
            key={particle.id}
            className="roulette-atmosphere__dust"
            style={{ left: `${particle.x}%`, top: `${particle.y}%`, width: particle.size, height: particle.size, animationDelay: `${particle.delay}s` }}
          />
        ))}
      </div>
    );
  }

  return null;
}

export const RouletteThemeAtmosphere = React.memo(function RouletteThemeAtmosphere({
  kind,
  active,
  compact = false,
}: {
  kind: RouletteAtmosphereKind;
  active: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={`roulette-atmosphere ${active ? 'roulette-atmosphere--active' : ''} ${compact ? 'roulette-atmosphere--compact' : ''}`}
      data-kind={kind}
      aria-hidden="true"
    >
      <div className="roulette-atmosphere__ambient" />
      <div className="roulette-atmosphere__grid" />
      <div className="roulette-atmosphere__orb roulette-atmosphere__orb--a" />
      <div className="roulette-atmosphere__orb roulette-atmosphere__orb--b" />
      <div className="roulette-atmosphere__sweep" />
      <div className="roulette-atmosphere__rings">
        <span />
        <span />
        <span />
      </div>
      <div className="roulette-atmosphere__corners">
        <span />
        <span />
        <span />
        <span />
      </div>
      <ThemeMotif kind={kind} />
      <style>{`
        .roulette-atmosphere { position:absolute; inset:-14%; z-index:0; overflow:hidden; pointer-events:none; opacity:0; transition:opacity 360ms ease; }
        .roulette-atmosphere--active { opacity:var(--roulette-atmosphere-opacity,.8); }
        .roulette-atmosphere--compact { inset:0; }
        .roulette-atmosphere__ambient { position:absolute; inset:0; background:var(--roulette-stage-ambient); filter:blur(10px); }
        .roulette-atmosphere__grid { position:absolute; inset:5%; opacity:.3; mask-image:radial-gradient(circle, #000 18%, transparent 72%); }
        .roulette-atmosphere__orb { position:absolute; width:46%; aspect-ratio:1; border-radius:999px; filter:blur(52px); opacity:.22; animation:roulette-atmosphere-drift 10s ease-in-out infinite alternate; }
        .roulette-atmosphere__orb--a { left:7%; top:9%; background:var(--roulette-accent); }
        .roulette-atmosphere__orb--b { right:5%; bottom:7%; background:var(--roulette-accent-2); animation-delay:-4s; animation-direction:alternate-reverse; }
        .roulette-atmosphere__sweep { position:absolute; inset:-35%; opacity:0; transform:rotate(-18deg); background:linear-gradient(90deg,transparent 42%,rgba(255,255,255,.22) 49%,transparent 56%); animation:roulette-atmosphere-sweep 7s ease-in-out infinite; }
        .roulette-atmosphere__rings { position:absolute; inset:14%; display:grid; place-items:center; }
        .roulette-atmosphere__rings span { position:absolute; width:var(--ring-size); aspect-ratio:1; border:1px solid var(--roulette-line); border-radius:999px; opacity:.16; }
        .roulette-atmosphere__rings span:nth-child(1){--ring-size:66%}.roulette-atmosphere__rings span:nth-child(2){--ring-size:84%}.roulette-atmosphere__rings span:nth-child(3){--ring-size:100%}
        .roulette-atmosphere__corners { position:absolute; inset:12%; opacity:0; }
        .roulette-atmosphere__corners span { position:absolute; width:18%; aspect-ratio:1; border-color:var(--roulette-accent); border-style:solid; }
        .roulette-atmosphere__corners span:nth-child(1){left:0;top:0;border-width:1px 0 0 1px}.roulette-atmosphere__corners span:nth-child(2){right:0;top:0;border-width:1px 1px 0 0}.roulette-atmosphere__corners span:nth-child(3){left:0;bottom:0;border-width:0 0 1px 1px}.roulette-atmosphere__corners span:nth-child(4){right:0;bottom:0;border-width:0 1px 1px 0}
        .roulette-atmosphere__particles { position:absolute; inset:0; overflow:hidden; }
        .roulette-atmosphere__dust { position:absolute; border-radius:999px; background:var(--roulette-accent-2); box-shadow:0 0 10px currentColor; opacity:.3; animation:roulette-atmosphere-twinkle 2.8s ease-in-out infinite; }
        .roulette-atmosphere__petal { position:absolute; top:-8%; width:10px; height:15px; border-radius:70% 35% 65% 35%; background:linear-gradient(145deg,#fff1f2,var(--roulette-accent)); opacity:.42; transform:rotate(var(--petal-rotate)); animation:roulette-atmosphere-fall 8s linear infinite; }
        .roulette-atmosphere__bubble { position:absolute; bottom:-12%; border:1px solid var(--roulette-accent-2); border-radius:999px; opacity:.24; animation:roulette-atmosphere-rise 7s ease-in infinite; }
        .roulette-atmosphere[data-kind='precision'] .roulette-atmosphere__grid,
        .roulette-atmosphere[data-kind='mono'] .roulette-atmosphere__grid { background-image:linear-gradient(var(--roulette-line) 1px,transparent 1px),linear-gradient(90deg,var(--roulette-line) 1px,transparent 1px); background-size:34px 34px; }
        .roulette-atmosphere[data-kind='precision'] .roulette-atmosphere__corners,
        .roulette-atmosphere[data-kind='cyber'] .roulette-atmosphere__corners,
        .roulette-atmosphere[data-kind='arcade'] .roulette-atmosphere__corners { opacity:.42; }
        .roulette-atmosphere[data-kind='spectrum'] .roulette-atmosphere__sweep,
        .roulette-atmosphere[data-kind='crystal'] .roulette-atmosphere__sweep,
        .roulette-atmosphere[data-kind='gold'] .roulette-atmosphere__sweep { opacity:.48; }
        .roulette-atmosphere[data-kind='aurora'] .roulette-atmosphere__orb { width:68%; border-radius:42% 58% 67% 33%; filter:blur(64px); opacity:.34; }
        .roulette-atmosphere[data-kind='velvet'] .roulette-atmosphere__grid { background:radial-gradient(circle at center,transparent 36%,rgba(0,0,0,.55) 78%); opacity:.72; mask-image:none; }
        .roulette-atmosphere[data-kind='deco'] .roulette-atmosphere__grid { background:repeating-conic-gradient(from 0deg,transparent 0 13deg,var(--roulette-line) 14deg 14.5deg); opacity:.28; }
        .roulette-atmosphere[data-kind='deco'] .roulette-atmosphere__rings span { border-radius:0; transform:rotate(45deg); }
        .roulette-atmosphere[data-kind='ink'] .roulette-atmosphere__orb { filter:blur(34px); opacity:.16; border-radius:34% 66% 42% 58%; }
        .roulette-atmosphere[data-kind='nova'] .roulette-atmosphere__rings { animation:roulette-atmosphere-orbit 16s linear infinite; }
        .roulette-atmosphere[data-kind='nova'] .roulette-atmosphere__rings span:nth-child(2) { border-style:dashed; }
        .roulette-atmosphere[data-kind='ceramic'] .roulette-atmosphere__grid { background:repeating-radial-gradient(ellipse at bottom,transparent 0 24px,var(--roulette-line) 25px 26px); opacity:.24; mask-image:linear-gradient(#000,transparent 82%); }
        .roulette-atmosphere[data-kind='arcade'] .roulette-atmosphere__grid,
        .roulette-atmosphere[data-kind='cyber'] .roulette-atmosphere__grid { background:repeating-linear-gradient(0deg,transparent 0 5px,var(--roulette-line) 6px 6px); opacity:.24; mask-image:none; }
        .roulette-atmosphere[data-kind='ocean'] .roulette-atmosphere__grid { background:repeating-radial-gradient(ellipse at 50% 100%,transparent 0 26px,var(--roulette-line) 27px 28px); opacity:.24; mask-image:linear-gradient(#000,transparent); }
        .roulette-atmosphere[data-kind='solar'] .roulette-atmosphere__grid { background:repeating-conic-gradient(from 0deg,transparent 0 8deg,var(--roulette-line) 9deg 9.5deg); opacity:.26; }
        .roulette-atmosphere[data-kind='gold'] .roulette-atmosphere__rings span { border-color:var(--roulette-accent); opacity:.28; }
        @keyframes roulette-atmosphere-drift { to { transform:translate3d(8%,6%,0) scale(1.08); } }
        @keyframes roulette-atmosphere-sweep { 0%,18%{transform:translateX(-34%) rotate(-18deg);opacity:0}42%{opacity:.5}68%,100%{transform:translateX(34%) rotate(-18deg);opacity:0} }
        @keyframes roulette-atmosphere-orbit { to { transform:rotate(360deg); } }
        @keyframes roulette-atmosphere-twinkle { 50% { opacity:.9; transform:scale(1.7); } }
        @keyframes roulette-atmosphere-fall { to { transform:translate3d(35px,125vh,0) rotate(calc(var(--petal-rotate) + 420deg)); } }
        @keyframes roulette-atmosphere-rise { to { transform:translate3d(18px,-120vh,0) scale(1.25); opacity:0; } }
        @media (prefers-reduced-motion:reduce) { .roulette-atmosphere * { animation:none !important; } }
      `}</style>
    </div>
  );
});

