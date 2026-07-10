'use client';

import { Moon, Sun, SunMoon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const current = mounted && resolvedTheme === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  const Icon = !mounted ? SunMoon : current === 'dark' ? Moon : Sun;
  const nextLabel = next === 'dark' ? '다크 모드' : '라이트 모드';
  const label = mounted ? `${nextLabel}로 변경` : '테마 설정 불러오는 중';

  return (
    <Tooltip content={label}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={label}
        disabled={!mounted}
        onClick={() => setTheme(next)}
      >
        <Icon className="h-4 w-4" />
      </Button>
    </Tooltip>
  );
}
