'use client';

import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>화면을 불러오지 못했어요</CardTitle>
          <CardDescription>잠시 후 다시 시도하거나 이전 화면으로 돌아가 주세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" onClick={reset}>
            <RefreshCw className="h-4 w-4" />
            다시 불러오기
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
