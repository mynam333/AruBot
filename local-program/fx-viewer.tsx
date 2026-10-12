import React from 'react';
import { createRoot } from 'react-dom/client';
import { FxOverlay } from '../src/components/FxOverlay';

const root = createRoot(document.getElementById('root')!);

async function start() {
  try {
    const response = await fetch(`/fx-viewer/config${window.location.search}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('FX connection unavailable');
    const { token, apiBase } = await response.json();
    if (!token || !apiBase) throw new Error('FX connection unavailable');
    root.render(<FxOverlay token={token} apiBase={apiBase} />);
  } catch {
    window.setTimeout(start, 5000);
  }
}

void start();
