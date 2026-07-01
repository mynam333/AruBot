'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  return (
    <Tooltip content={`테마 변경: ${next}`}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={`테마 변경: ${next}`}
        onClick={() => setTheme(next)}
      >
        <Icon className="h-4 w-4" />
      </Button>
    </Tooltip>
  );
}
