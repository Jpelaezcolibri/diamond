import type { ReactNode } from "react";

// Tarjeta plegable genérica sobre <details> nativo: funciona como server
// component, sin estado ni JS del lado del cliente. Se usa para lo que casi
// no cambia (cargar grupos, escucha en vivo) y por eso arranca cerrado --
// rediseño de /grupos (Juan, 2026-09-02): lo de configuración no puede
// ocupar media pantalla por encima de lo que se revisa a diario.
export default function PanelPlegable({
  titulo,
  resumen,
  abierto = false,
  children,
}: {
  titulo: ReactNode;
  /** Texto corto a la derecha, visible aun plegado ("solo admin", "2 líneas"). */
  resumen?: ReactNode;
  abierto?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={abierto} className="group rounded-2xl border border-slate-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 font-semibold text-slate-900">
          <span className="inline-block text-slate-400 transition-transform group-open:rotate-90">▸</span>
          {titulo}
        </span>
        {resumen && <span className="text-xs text-slate-500">{resumen}</span>}
      </summary>
      <div className="border-t border-slate-100 p-4">{children}</div>
    </details>
  );
}
