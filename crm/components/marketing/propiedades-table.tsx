"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PUBLICATION_STATUS_LABELS, PUBLICATION_STATUS_COLORS, STYLE_VARIANT_LABELS, type PublicationStatus } from "@/lib/marketing";

const STYLE_VARIANTS = Object.keys(STYLE_VARIANT_LABELS);

export interface PropiedadRow {
  id: string;
  ref: string;
  titulo: string;
  zona: string | null;
  ciudad: string | null;
  precio: string | null;
  isNew: boolean;
  publication: { id: string; status: string; styleVariant: string | null; scheduledAt: string | null } | null;
}

function GenerarInline({ orgId, propertyId, titulo }: { orgId: string; propertyId: string; titulo: string }) {
  const router = useRouter();
  const [styleVariant, setStyleVariant] = useState("lujo");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
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
        setError(body.message || body.error || "No se pudo generar");
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
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <select
          value={styleVariant}
          onChange={(e) => setStyleVariant(e.target.value)}
          className="rounded-lg border border-slate-300 px-1.5 py-1 text-xs"
        >
          {STYLE_VARIANTS.map((v) => (
            <option key={v} value={v}>
              {STYLE_VARIANT_LABELS[v]}
            </option>
          ))}
        </select>
        <button
          onClick={handleGenerate}
          disabled={loading}
          title={`Generar publicación para ${titulo}`}
          className="whitespace-nowrap rounded-lg bg-[#c9a24b] px-2.5 py-1 text-xs font-medium text-[#0b1526] transition hover:bg-[#c9a24b]/90 disabled:opacity-50"
        >
          {loading ? "Generando…" : "Publicar"}
        </button>
      </div>
      {error && <p className="text-[10px] text-red-600">{error}</p>}
    </div>
  );
}

export default function PropiedadesTable({ orgId, rows }: { orgId: string; rows: PropiedadRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => `${r.ref} ${r.titulo} ${r.zona ?? ""} ${r.ciudad ?? ""}`.toLowerCase().includes(q));
  }, [rows, query]);

  return (
    <div className="space-y-3">
      <input
        type="text"
        placeholder="Buscar por referencia, título o zona…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Propiedad</th>
              <th className="px-4 py-3">Precio</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3 text-right">Acción</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {r.isNew && (
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">Nueva</span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{r.titulo}</p>
                      <p className="text-xs text-slate-500">
                        {r.ref} {r.zona ? `· ${r.zona}` : ""}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-600">{r.precio ?? "—"}</td>
                <td className="px-4 py-3">
                  {r.publication ? (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        PUBLICATION_STATUS_COLORS[r.publication.status as PublicationStatus] ?? "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {PUBLICATION_STATUS_LABELS[r.publication.status as PublicationStatus] ?? r.publication.status}
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">Sin publicar</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {r.publication ? (
                    <Link href={`/marketing/publicaciones/${r.publication.id}`} className="text-xs font-medium text-[#0b1526] underline">
                      Ver publicación
                    </Link>
                  ) : (
                    <GenerarInline orgId={orgId} propertyId={r.id} titulo={r.titulo} />
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">
                  Sin resultados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
