import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/shared/lib/utils';

type PaginationItem = number | 'ellipsis';

function getPaginationItems(currentPage: number, totalPages: number): PaginationItem[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);

  const pages = new Set<number>([1, totalPages, currentPage]);
  for (const page of [currentPage - 1, currentPage + 1]) {
    if (page > 1 && page < totalPages) pages.add(page);
  }
  if (currentPage <= 3) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
  }
  if (currentPage >= totalPages - 2) {
    pages.add(totalPages - 1);
    pages.add(totalPages - 2);
    pages.add(totalPages - 3);
  }

  const sorted = Array.from(pages).filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  const items: PaginationItem[] = [];
  sorted.forEach((page, index) => {
    const previous = sorted[index - 1];
    if (previous && page - previous > 1) items.push('ellipsis');
    items.push(page);
  });
  return items;
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  className,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  if (totalPages <= 1) return null;
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const items = getPaginationItems(currentPage, totalPages);

  return (
    <nav className={cn('flex flex-wrap items-center justify-center gap-1.5', className)} aria-label="페이지 이동">
      <Button type="button" variant="outline" size="icon" onClick={() => onPageChange(1)} disabled={currentPage === 1} aria-label="첫 페이지">
        <ChevronsLeft className="h-4 w-4" />
      </Button>
      <Button type="button" variant="outline" size="icon" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} aria-label="이전 페이지">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      {items.map((item, index) => {
        if (item === 'ellipsis') {
          return (
            <span key={`ellipsis-${index}`} className="grid aspect-square min-h-[var(--control-height-sm)] w-[var(--control-height-sm)] place-items-center text-muted-foreground">
              <MoreHorizontal className="h-4 w-4" />
            </span>
          );
        }
        return (
          <Button
            key={item}
            type="button"
            variant={item === currentPage ? 'soft' : 'outline'}
            size="sm"
            className="aspect-square px-0"
            onClick={() => onPageChange(item)}
            aria-current={item === currentPage ? 'page' : undefined}
          >
            {item}
          </Button>
        );
      })}
      <Button type="button" variant="outline" size="icon" onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages} aria-label="다음 페이지">
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Button type="button" variant="outline" size="icon" onClick={() => onPageChange(totalPages)} disabled={currentPage === totalPages} aria-label="마지막 페이지">
        <ChevronsRight className="h-4 w-4" />
      </Button>
    </nav>
  );
}
