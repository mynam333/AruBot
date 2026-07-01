import { Suspense } from 'react';
import { ConnectionPage } from '@/features/admin/connection-page';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ConnectionPage />
    </Suspense>
  );
}
