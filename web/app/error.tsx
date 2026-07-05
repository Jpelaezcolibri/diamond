"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, MessageCircle } from "lucide-react";
import { Container } from "@/components/layout/container";
import { Button } from "@/components/design-system/button";

// Error boundary de segmento: captura fallos de render/datos (ej. Supabase
// caído) sin tumbar todo el sitio. NO se cachea, así que reintentar recarga
// datos frescos.
export default function SegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[REF] Render error:", error.digest ?? error.message);
  }, [error]);

  return (
    <main>
      <Container className="flex flex-col items-center py-32 text-center">
        <AlertTriangle className="size-10 text-muted" strokeWidth={1.25} aria-hidden="true" />
        <h1 className="mt-5 font-heading text-2xl md:text-3xl">Tuvimos un problema temporal</h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
          No pudimos cargar esta sección en este momento. Vuelve a intentarlo en unos
          segundos, o escríbenos directo y te atendemos de una.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Button onClick={reset}>
            <RefreshCw aria-hidden="true" />
            Reintentar
          </Button>
          <Button asChild variant="outline">
            <a href="/">Volver al inicio</a>
          </Button>
        </div>
        <p className="mt-6 inline-flex items-center gap-1.5 text-xs text-muted">
          <MessageCircle className="size-3.5" aria-hidden="true" />
          Si persiste, contáctanos por WhatsApp desde el botón flotante.
        </p>
      </Container>
    </main>
  );
}
