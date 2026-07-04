/* eslint-disable react-refresh/only-export-components */
import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';

const initialThemeScript = `
(() => {
  try {
    const key = 'theme';
    const stored = window.localStorage.getItem(key);
    if (stored === 'light' || stored === 'dark') return;
    const preferred = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    window.localStorage.setItem(key, preferred);
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(preferred);
    document.documentElement.style.colorScheme = preferred;
  } catch {}
})();
`;

export const metadata: Metadata = {
  title: 'AruBot | 방송 참여 관리 콘솔',
  description: 'CHZZK, CIME, YouTube 방송을 위한 명령어, 포인트, 룰렛, 영상 후원 관리 서비스',
  icons: {
    icon: '/files/logo.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0f1f' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <meta name="google-site-verification" content="KQ4i9w640cJZF6iM9Tw5k5XthFvOwq78L8QOoQHWdxk" />
        <script dangerouslySetInnerHTML={{ __html: initialThemeScript }} />
      </head>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
