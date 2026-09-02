"use client";

import { useState } from "react";

export type Grupo = {
  id: string;
  jid: string;
  nombre: string | null;
  modo: "ignorar" | "sombra" | "sugerir";
  responde: boolean;
  activo: boolean;
  created_at: string;
};

// De dónde salió cada grupo. El prefijo del jid lo dice: los que se crean al
// subir un export llevan "export:", el buzón de reenvíos lleva "reenvio:", y
// los que tienen un jid real de WhatsApp vienen de una línea vinculada.
function origen(jid: string) {
  if (jid.startsWith("export:")) return { etiqueta: "export", clase: "bg-sky-50 text-sky-700" };
  if (jid.startsWith("reenvio:")) return { etiqueta: "reenvío", clase: "bg-violet-50 text-violet-700" };
  return { etiqueta: "en vivo", clase: "bg-amber-50 text-amber-700" };
}

// Acordeón plegable (Juan, 2026-09-02): "los grupos en una pestaña
// desplegable a un click y que se pueda ver de manera horizontal" -- la
// lista vertical ocupaba media pantalla para algo que casi no cambia,
// desplazando las dos tablas de match que si se revisan a diario.
export default function GruposPanel({ grupos }: { grupos: Grupo[] }) {
  const [abierto, setAbierto] = useState(false);

  if (grupos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        Todavía no cargaste ningún grupo. Subí arriba el <code>.txt</code> que exporta WhatsApp
        y aparece acá.
      </div>
    );
  }

  // Cuántos de cada origen, visibles aun plegado: es lo único del listado
  // que cambia con alguna frecuencia.
  const porOrigen = new Map<string, { etiqueta: string; clase: string; n: number }>();
  for (const g of grupos) {
    const o = origen(g.jid);
    const ya = porOrigen.get(o.etiqueta);
    if (ya) ya.n++;
    else porOrigen.set(o.etiqueta, { ...o, n: 1 });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <span className={`inline-block text-slate-400 transition-transform ${abierto ? "rotate-90" : ""}`}>▸</span>
          Grupos
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
            {grupos.length} cargado{grupos.length === 1 ? "" : "s"}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {[...porOrigen.values()].map((o) => (
            <span key={o.etiqueta} className={`rounded px-2 py-0.5 text-xs font-medium ${o.clase}`}>
              {o.n} {o.etiqueta}
            </span>
          ))}
          <span className="ml-1 text-xs text-slate-400">clic para {abierto ? "ocultar" : "ver"}</span>
        </span>
      </button>
      {abierto && (
        <div className="flex gap-2 overflow-x-auto border-t border-slate-100 px-4 py-3">
          {grupos.map((g) => {
            const o = origen(g.jid);
            return (
              <div key={g.id} className="min-w-[160px] shrink-0 rounded-lg border border-slate-200 p-2.5">
                <p className="truncate text-sm font-medium text-slate-900">
                  {g.nombre || "Grupo sin nombre"}
                </p>
                <span className={`mt-1 inline-block rounded px-2 py-0.5 text-xs font-medium ${o.clase}`}>
                  {o.etiqueta}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
