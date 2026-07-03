'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const current = resolvedTheme === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  const Icon = current === 'dark' ? Moon : Sun;
  const nextLabel = next === 'dark' ? '다크 모드' : '라이트 모드';

  return (
    <Tooltip content={`${nextLabel}로 변경`}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={`${nextLabel}로 변경`}
        onClick={() => setTheme(next)}
      >
        <Icon className="h-4 w-4" />
      </Button>
    </Tooltip>
  );
}
