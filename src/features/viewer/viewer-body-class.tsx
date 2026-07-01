'use client';

import { useEffect } from 'react';

export function ViewerBodyClass() {
  useEffect(() => {
    document.body.classList.add('arubot-viewer-body');
    return () => {
      document.body.classList.remove('arubot-viewer-body');
    };
  }, []);

  return null;
}
