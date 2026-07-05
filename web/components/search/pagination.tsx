import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaginationProps {
  current: number;
  totalPages: number;
  /** searchParams actuales (para preservar filtros en los links). */
  searchParams: Record<string, string | string[] | undefined>;
  basePath?: string;
}

function pageHref(basePath: string, searchParams: PaginationProps["searchParams"], page: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "pagina" || value === undefined) continue;
    params.set(key, Array.isArray(value) ? value[0] : value);
  }
  if (page > 1) params.set("pagina", String(page));
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** Paginacion server-rendered con links reales (SEO + sin JS). */
export function Pagination({ current, totalPages, searchParams, basePath = "/propiedades" }: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = Array.from({ length: totalPages }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === totalPages || Math.abs(p - current) <= 1
  );
  const withGaps: (number | "gap")[] = [];
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1] > 1) withGaps.push("gap");
    withGaps.push(p);
  });

  const linkClass = "flex h-10 min-w-10 items-center justify-center rounded-brand border border-line px-3 text-sm transition-colors hover:border-foreground/30";

  return (
    <nav aria-label="Paginación" className="mt-14 flex items-center justify-center gap-2">
      {current > 1 ? (
        <Link href={pageHref(basePath, searchParams, current - 1)} className={linkClass} aria-label="Página anterior">
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Link>
      ) : null}

      {withGaps.map((p, i) =>
        p === "gap" ? (
          <span key={`gap-${i}`} className="px-1 text-muted" aria-hidden="true">
            …
          </span>
        ) : (
          <Link
            key={p}
            href={pageHref(basePath, searchParams, p)}
            aria-current={p === current ? "page" : undefined}
            className={cn(linkClass, p === current && "border-foreground bg-primary text-primary-foreground")}
          >
            {p}
          </Link>
        )
      )}

      {current < totalPages ? (
        <Link href={pageHref(basePath, searchParams, current + 1)} className={linkClass} aria-label="Página siguiente">
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      ) : null}
    </nav>
  );
}
