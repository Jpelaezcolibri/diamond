"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// "Marcar atendida" de una respuesta de colega (pestaña Publicaciones). La
// escritura la hace el bot; al volver se refresca la pagina server.
export default function MarcarAtendida({ id }: { id: string }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function marcar() {
    setEnviando(true);
    setError(null);
    const res = await fetch("/api/respuestas/atendida", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => null);
    if (!res || !res.ok) {
      const b = res ? await res.json().catch(() => ({})) : {};
      setError((b as { error?: string }).error || "No se pudo marcar");
      setEnviando(false);
      return;
    }
    router.refresh();
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={marcar}
        disabled={enviando}
        className="whitespace-nowrap rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:border-emerald-500 hover:text-emerald-700 disabled:opacity-50"
      >
        {enviando ? "Marcando…" : "Marcar atendida"}
      </button>
      {error && <span className="text-[10px] text-rose-600">{error}</span>}
    </span>
  );
}
