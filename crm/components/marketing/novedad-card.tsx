"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { STYLE_VARIANT_LABELS } from "@/lib/marketing";

const STYLE_VARIANTS = Object.keys(STYLE_VARIANT_LABELS);

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "ahora mismo";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

export default function NovedadCard({
  orgId,
  propertyId,
  changeLabel,
  propertyRef,
  titulo,
  zona,
  precio,
  createdAt,
}: {
  orgId: string;
  propertyId: string | null;
  changeLabel: string;
  propertyRef: string;
  titulo: string;
  zona?: string | null;
  precio?: string | null;
  createdAt: string;
}) {
  const router = useRouter();
  const [styleVariant, setStyleVariant] = useState("lujo");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/marketing/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, orgId, styleVariant }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || body.message || "No se pudo generar la publicación");
        return;
      }
      router.push(`/marketing/publicaciones/${body.publicationId}`);
    } catch {
      setError("No se pudo conectar con DMAP");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{titulo}</p>
          <p className="text-xs text-slate-500">
            {propertyRef} {zona ? `· ${zona}` : ""} {precio ? `· ${precio}` : ""}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">{changeLabel}</span>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">{relativeTime(createdAt)}</p>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <select
          value={styleVariant}
          onChange={(e) => setStyleVariant(e.target.value)}
          className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
        >
          {STYLE_VARIANTS.map((v) => (
            <option key={v} value={v}>
              {STYLE_VARIANT_LABELS[v]}
            </option>
          ))}
        </select>
        <button
          onClick={handleGenerate}
          disabled={loading || !propertyId}
          className="rounded-lg bg-[#c9a24b] px-3 py-1 text-xs font-medium text-[#0b1526] transition hover:bg-[#c9a24b]/90 disabled:opacity-50"
        >
          {loading ? "Generando…" : "Generar publicación"}
        </button>
      </div>
    </div>
  );
}
