"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

interface BackButtonProps {
  /** Destino si no hay historial de navegación (entrada directa por link/SEO). */
  fallbackHref?: string;
  label?: string;
}

/**
 * Volver a la vista anterior. Si el usuario llegó desde el catálogo (incluso
 * filtrado), router.back() lo devuelve a esa misma vista; si entró directo por
 * un link compartido, cae al fallback.
 */
export function BackButton({ fallbackHref = "/propiedades", label = "Volver" }: BackButtonProps) {
  const router = useRouter();

  function onClick() {
    // history.length > 1 indica que hay una pagina previa dentro del sitio.
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {label}
    </button>
  );
}
