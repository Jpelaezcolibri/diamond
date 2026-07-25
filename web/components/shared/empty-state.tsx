import type { ReactNode } from "react";
import { SearchX, MessageCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/design-system/button";
import type { LocalizedText } from "@/config/i18n";
import { T } from "./t";
import { WaLink } from "./wa-link";

interface EmptyStateProps {
  title: ReactNode;
  description: ReactNode;
  /** Numero + mensaje bilingue: el CTA de WhatsApp se arma en el idioma activo. */
  waNumber?: string;
  waMessage?: LocalizedText;
  clearHref?: string;
}

/** Estado vacio con salida clara: limpiar filtros o hablar con un humano. */
export function EmptyState({ title, description, waNumber, waMessage, clearHref }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center py-24 text-center">
      <SearchX className="size-10 text-muted" strokeWidth={1.25} aria-hidden="true" />
      <h2 className="mt-5 font-heading text-2xl">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">{description}</p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        {clearHref ? (
          <Button asChild variant="outline">
            <Link href={clearHref}>
              <T k="emptyState.viewAll" />
            </Link>
          </Button>
        ) : null}
        {waNumber && waMessage ? (
          <Button asChild variant="whatsapp">
            <WaLink number={waNumber} message={waMessage}>
              <MessageCircle aria-hidden="true" />
              <T k="emptyState.tellUs" />
            </WaLink>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
