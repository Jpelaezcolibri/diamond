import type { Metadata } from "next";
import { getTenantConfig } from "@/config/tenant";
import { getProperties, getFilterOptions } from "@/services/properties";
import { parseFilters, applyFilters, paginate } from "@/lib/filters";
import { generalWhatsAppUrl } from "@/lib/whatsapp";
import { Container } from "@/components/layout/container";
import { FilterBar } from "@/components/search/filter-bar";
import { Pagination } from "@/components/search/pagination";
import { PropertyCard } from "@/components/property/property-card";
import { EmptyState } from "@/components/shared/empty-state";

export const revalidate = 300;

type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const config = getTenantConfig();
  const filters = parseFilters(await searchParams);

  // Cada combinación de filtros (y cada página >1) es una URL distinta pero
  // no aporta contenido único de cara a buscadores: se deja rastrear (para
  // que el PageRank siga fluyendo a las fichas de propiedad enlazadas) pero
  // no indexar. El canonical siempre apunta al catálogo base sin filtros.
  const hasActiveFilters =
    filters.pagina > 1 ||
    !!filters.operacion ||
    !!filters.tipo ||
    !!filters.zona ||
    !!filters.q ||
    !!filters.precioMax ||
    !!filters.habitaciones;

  return {
    title: config.catalog.title,
    description: config.catalog.subtitle ?? config.seo.description,
    alternates: { canonical: "/propiedades" },
    ...(hasActiveFilters ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const config = getTenantConfig();
  const params = await searchParams;
  const filters = parseFilters(params);

  const [all, options] = await Promise.all([getProperties(), getFilterOptions()]);
  const filtered = applyFilters(all, filters);
  const page = paginate(filtered, filters.pagina, config.catalog.pageSize);

  return (
    <main>
      <Container className="pb-section-sm pt-12 md:pt-16">
        <h1 className="text-3xl md:text-4xl">{config.catalog.title}</h1>
        {config.catalog.subtitle ? (
          <p className="mt-3 max-w-xl text-base text-muted">{config.catalog.subtitle}</p>
        ) : null}
      </Container>

      <FilterBar zonas={options.zonas} tipos={options.tipos} operaciones={options.operaciones} />

      <Container className="py-10 md:py-14">
        <p className="text-sm text-muted" role="status">
          {page.total === 0
            ? "Sin resultados con estos filtros"
            : `${page.total} ${page.total === 1 ? "propiedad" : "propiedades"}`}
        </p>

        {page.total === 0 ? (
          <EmptyState
            title="No encontramos propiedades con esos filtros"
            description="Prueba ampliando la zona o el presupuesto. También puedes contarnos qué buscas y te avisamos cuando llegue al inventario."
            whatsappUrl={generalWhatsAppUrl(config)}
            clearHref="/propiedades"
          />
        ) : (
          <>
            <div className="mt-8 grid grid-cols-1 gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
              {page.items.map((property, index) => (
                <PropertyCard key={property.ref} property={property} priority={index < 3} />
              ))}
            </div>
            <Pagination current={page.current} totalPages={page.totalPages} searchParams={params} />
          </>
        )}
      </Container>
    </main>
  );
}
