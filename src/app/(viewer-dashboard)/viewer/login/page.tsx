import type { Metadata } from 'next';
import { ViewerLoginPage } from '@/features/viewer/viewer-login-page';

export const metadata: Metadata = {
  title: '시청자 로그인 | AruBot',
  description: '그림 후원과 시청자 포인트를 사용하기 위해 로그인합니다.',
};

export default async function ViewerLoginRoute({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const params = await searchParams;
  return <ViewerLoginPage returnTo={params.returnTo || null} />;
}
