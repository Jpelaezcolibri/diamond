"use client";

import { useState, type ReactNode } from "react";

// Tarjeta plegable sobre <details> nativo. Cliente con estado a proposito
// (auditoria 2026-09-02): el contenido NO se monta hasta que se abre. Antes
// "Escucha en vivo" montaba VincularLinea plegado, y ese componente sondea el
// estado de la sesion de WAHA al montarse -- hasta 15 llamadas al bot por
// cada apertura de /grupos que nadie miraba (en local, 502 tras 502).
//
// Los children pueden ser server components: llegan ya renderizados como
// payload y aca solo se decide si entran al DOM.
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
  const [open, setOpen] = useState(abierto);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="group rounded-2xl border border-slate-200 bg-white"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <span className="inline-block text-slate-400 transition-transform group-open:rotate-90">▸</span>
          {titulo}
        </h2>
        {resumen && <span className="text-xs text-slate-500">{resumen}</span>}
      </summary>
      {open && <div className="border-t border-slate-100 p-4">{children}</div>}
    </details>
  );
}
