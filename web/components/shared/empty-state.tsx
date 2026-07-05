import { SearchX, MessageCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/design-system/button";

interface EmptyStateProps {
  title: string;
  description: string;
  whatsappUrl?: string;
  clearHref?: string;
}

/** Estado vacio con salida clara: limpiar filtros o hablar con un humano. */
export function EmptyState({ title, description, whatsappUrl, clearHref }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center py-24 text-center">
      <SearchX className="size-10 text-muted" strokeWidth={1.25} aria-hidden="true" />
      <h2 className="mt-5 font-heading text-2xl">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">{description}</p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        {clearHref ? (
          <Button asChild variant="outline">
            <Link href={clearHref}>Ver todas las propiedades</Link>
          </Button>
        ) : null}
        {whatsappUrl ? (
          <Button asChild variant="whatsapp">
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
              <MessageCircle aria-hidden="true" />
              Cuéntanos qué buscas
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
