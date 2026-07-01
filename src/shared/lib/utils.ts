import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(value: unknown) {
  const number = Number(value || 0);
  return new Intl.NumberFormat('ko-KR').format(Number.isFinite(number) ? number : 0);
}

export function compactDateTime(value: unknown) {
  if (!value) return '-';
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
