'use client';

import { useEffect } from 'react';

export function ViewerBodyClass() {
  useEffect(() => {
    const root = document.documentElement;
    const previousRootBackground = root.style.background;
    const previousBodyBackground = document.body.style.background;
    root.classList.add('arubot-viewer-root');
    document.body.classList.add('arubot-viewer-body');
    root.style.background = 'transparent';
    document.body.style.background = 'transparent';
    return () => {
      root.classList.remove('arubot-viewer-root');
      document.body.classList.remove('arubot-viewer-body');
      root.style.background = previousRootBackground;
      document.body.style.background = previousBodyBackground;
    };
  }, []);

  return null;
}
