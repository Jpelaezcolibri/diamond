"use client";

// Boton "Descartar" de una visita vencida sin confirmar (brief citas-avisos
// §1): la marca vencida en el bot y sale de "Para atender". No le escribe a
// nadie.
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DescartarCita({ leadId, oscuro = false }: { leadId: string; oscuro?: boolean }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function descartar() {
    setEnviando(true);
    setError(null);
    const r = await fetch("/api/citas/accion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId, accion: "descartar" }),
    });
    const body = await r.json().catch(() => ({}));
    setEnviando(false);
    if (r.ok) router.refresh();
    else setError(body.error || "No se pudo, intenta de nuevo.");
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        disabled={enviando}
        onClick={descartar}
        className={`rounded-md px-2.5 py-1 text-xs font-semibold disabled:opacity-60 ${
          oscuro ? "bg-white/10 text-white ring-1 ring-white/30 hover:bg-white/20" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
        }`}
      >
        {enviando ? "Descartando…" : "Descartar"}
      </button>
      {error && <span className={`text-xs ${oscuro ? "text-red-300" : "text-red-600"}`}>{error}</span>}
    </span>
  );
}
