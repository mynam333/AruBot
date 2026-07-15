import type { AdminStreamer } from '@/features/admin/arubot-admin-types';

export function providerLabel(provider?: string | null) {
  if (provider === 'chzzk') return 'CHZZK';
  if (provider === 'cime') return 'CIME';
  if (provider === 'youtube') return 'YouTube';
  return provider || '플랫폼';
}

export function runtimeStatusLabel(status?: AdminStreamer['runtime']['status']) {
  if (status === 'running') return '봇 응답 중';
  if (status === 'managed_elsewhere') return '다른 서버에서 관리 중';
  if (status === 'attention') return '점검 필요';
  if (status === 'checking') return '상태 확인 중';
  if (status === 'disabled') return '봇 꺼짐';
  if (status === 'unconfigured') return '연결 필요';
  return '방송 대기';
}
