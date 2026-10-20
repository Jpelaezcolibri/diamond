"use client";

// Tarjeta de "Tus propiedades por renovar" en Para atender (Juan, 2026-10-20;
// mockup docs/superpowers/mockups/2026-10-20-vigencia-crm.html). El resultado
// queda en la misma tarjeta hasta recargar.
import { useState } from "react";

export type PropiedadPorRenovar = {
  ref: string;
  titulo: string | null;
  precio: string | null;
  periodo: string | null;
  foto: string | null;
  link: string | null;
  venceTexto: string;
  nuevaVigenciaTexto: string;
};

export default function RenovarPropiedad({ p }: { p: PropiedadPorRenovar }) {
  const [enviando, setEnviando] = useState<"si" | "no" | null>(null);
  const [resultado, setResultado] = useState<"renovada" | "baja" | null>(null);
  const [error, setError] = useState(false);

  async function responder(sigue: boolean) {
    if (!sigue && !window.confirm(`¿Confirmás que la ${p.ref} ya no está disponible?`)) return;
    setEnviando(sigue ? "si" : "no");
    setError(false);
    try {
      const r = await fetch("/api/propiedades/vigencia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: p.ref, sigue }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok && (body.estado === "renovada" || body.estado === "baja")) setResultado(body.estado);
      else setError(true);
    } catch {
      setError(true);
    }
    setEnviando(null);
  }

  if (resultado === "renovada") {
    return (
      <li className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">
        ✓ <b>{p.ref}</b> sigue publicada 30 días más (hasta {p.nuevaVigenciaTexto}).
      </li>
    );
  }
  if (resultado === "baja") {
    return (
      <li className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <b>{p.ref}</b> salió del inventario y de los grupos.{" "}
        <span className="text-slate-500">Si vuelve a estar disponible, pedile a Sofi que la publique de nuevo.</span>
      </li>
    );
  }

  return (
    <li className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex gap-3">
        {p.foto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.foto} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="h-16 w-16 shrink-0 rounded-lg bg-amber-100" />
        )}
        <div className="min-w-0">
          <div className="font-medium text-slate-900">{p.titulo || `Propiedad ${p.ref}`}</div>
          <div className="text-sm text-slate-700">
            Ref {p.ref}
            {p.precio ? ` · ${p.precio}` : ""}
            {p.periodo ? ` ${p.periodo}` : ""}
          </div>
          <div className="text-xs text-amber-800">Vence el {p.venceTexto} · sale de los grupos</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={enviando !== null}
          onClick={() => responder(true)}
          className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {enviando === "si" ? "Guardando…" : "✓ Sigue disponible"}
        </button>
        <button
          type="button"
          disabled={enviando !== null}
          onClick={() => responder(false)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {enviando === "no" ? "Guardando…" : "Ya no está"}
        </button>
        {p.link && (
          <a href={p.link} target="_blank" rel="noopener noreferrer" className="ml-auto text-sm text-slate-500 hover:underline">
            Ver ficha ↗
          </a>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">No se pudo, intentá de nuevo.</p>}
    </li>
  );
}
