import Link from 'next/link';
import { Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>페이지를 찾을 수 없어요</CardTitle>
          <CardDescription>주소가 바뀌었거나 아직 준비되지 않은 화면이에요.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/dashboard">
              <Home className="h-4 w-4" />
              홈으로
            </Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
