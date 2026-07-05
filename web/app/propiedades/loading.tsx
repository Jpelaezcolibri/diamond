import { Container } from "@/components/layout/container";
import { Skeleton } from "@/components/design-system/skeleton";

// Estado de carga del catálogo (streaming): esqueleto mientras el RSC resuelve.
export default function CatalogLoading() {
  return (
    <main>
      <Container className="pb-6 pt-12 md:pt-16">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="mt-3 h-5 w-72" />
      </Container>
      <Container className="py-10 md:py-14">
        <Skeleton className="h-5 w-32" />
        <div className="mt-8 grid grid-cols-1 gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="aspect-[3/2] w-full rounded-brand-lg" />
              <Skeleton className="mt-4 h-6 w-32" />
              <Skeleton className="mt-2 h-4 w-40" />
            </div>
          ))}
        </div>
      </Container>
    </main>
  );
}
