"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type CreativeEngine = "ai" | "template";

export default function CreativeEngineSettings({ orgId, engine }: { orgId: string; engine: CreativeEngine }) {
  const router = useRouter();
  const [value, setValue] = useState<CreativeEngine>(engine);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSave() {
    setLoading(true);
    setMessage(null);
    const res = await fetch("/api/marketing/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, creativeEngine: value }),
    });
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (res.ok) {
      setMessage("Motor de creativos guardado");
      router.refresh();
    } else {
      setMessage(body.message || body.error || "No se pudo guardar");
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold text-slate-900">Motor de creativos</h2>
      <p className="mt-1 text-sm text-slate-500">
        Cómo se generan las imágenes de las publicaciones. Con IA, un director creativo (Claude) diseña la pieza, GPT Image la
        genera sobre la foto real de la propiedad y un crítico creativo la evalúa antes de mostrártela. Si el servicio de
        imágenes falla, se usa automáticamente la plantilla clásica.
      </p>

      {message && <p className="mt-2 text-sm text-emerald-700">{message}</p>}

      <div className="mt-4 max-w-md">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Motor</label>
        <select
          value={value}
          onChange={(e) => setValue(e.target.value as CreativeEngine)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="ai">IA multiagente (GPT Image) — recomendado</option>
          <option value="template">Plantilla clásica</option>
        </select>
      </div>

      <button
        onClick={handleSave}
        disabled={loading || value === engine}
        className="mt-4 rounded-lg bg-[#0b1526] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#0b1526]/90 disabled:opacity-50"
      >
        {loading ? "Guardando…" : "Guardar motor"}
      </button>
    </section>
  );
}
