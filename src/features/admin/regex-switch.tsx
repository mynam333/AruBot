'use client';

import * as Switch from '@radix-ui/react-switch';
import { Regex } from 'lucide-react';
import { Tooltip } from '@/components/ui/tooltip';

export function RegexSwitch({ checked, onCheckedChange, disabled = false }: {
  checked: boolean; onCheckedChange: (checked: boolean) => void; disabled?: boolean;
}) {
  return <div className="flex items-center gap-2 text-sm">
    <Tooltip content="최대 256자 · 대소문자 구분 없음 · RE2 문법 (전후방 탐색·역참조 제외). 명령어는 채팅 시작에서 일치하며 공백도 패턴에 포함됩니다.">
      <span className="inline-flex items-center gap-1.5"><Regex className="h-4 w-4" />정규식</span>
    </Tooltip>
    <Switch.Root checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-label="정규식 사용"
      className="h-6 w-11 shrink-0 rounded-full bg-muted transition-colors data-[state=checked]:bg-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" />
    </Switch.Root>
  </div>;
}
