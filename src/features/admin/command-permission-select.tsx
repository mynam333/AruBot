'use client';

import { ShieldCheck } from 'lucide-react';
import { COMMAND_PERMISSION_OPTIONS, type CommandPermission } from '../../../shared/command-permissions';

export function CommandPermissionSelect({ value, onChange, disabled = false }: {
  value: CommandPermission;
  onChange: (value: CommandPermission) => void;
  disabled?: boolean;
}) {
  return <label className="grid min-w-0 gap-2 text-sm font-semibold">
    <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-muted-foreground" />실행 권한</span>
    <select aria-label="실행 권한" value={value} onChange={event => onChange(event.target.value as CommandPermission)} disabled={disabled}
      className="min-h-[var(--control-height)] w-full min-w-0 rounded-[var(--radius-control)] border bg-background/80 px-3 py-2 text-sm font-normal text-foreground outline-none transition focus:border-primary/45 focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50">
      {COMMAND_PERMISSION_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>;
}
