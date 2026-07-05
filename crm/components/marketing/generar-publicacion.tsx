"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PUBLICATION_STATUS_LABELS, PUBLICATION_STATUS_COLORS, STYLE_VARIANT_LABELS, type PublicationStatus } from "@/lib/marketing";

const STYLE_VARIANTS = Object.keys(STYLE_VARIANT_LABELS);

interface PropertyOption {
  id: string;
  ref: string;
  titulo: string;
  zona: string | null;
  ciudad: string | null;
  operacion: string | null;
  precio: string | null;
  existingPublication: { id: string; status: string } | null;
}

export default function GenerarPublicacion({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [properties, setProperties] = useState<PropertyOption[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PropertyOption | null>(null);
  const [styleVariant, setStyleVariant] = useState("lujo");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || properties) return;
    fetch("/api/marketing/properties")
      .then((res) => res.json())
      .then((body) => setProperties(body.properties || []))
      .catch(() => setProperties([]));
  }, [open, properties]);

  const filtered = useMemo(() => {
    if (!properties) return [];
    const q = query.trim().toLowerCase();
    if (!q) return properties.slice(0, 30);
    return properties.filter((p) => `${p.ref} ${p.titulo} ${p.zona ?? ""} ${p.ciudad ?? ""}`.toLowerCase().includes(q)).slice(0, 30);
  }, [properties, query]);

  async function handleGenerate() {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/marketing/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: selected.id, orgId, styleVariant }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.message || body.error || "No se pudo generar la publicación");
        return;
      }
      router.push(`/marketing/publicaciones/${body.publicationId}`);
    } catch {
      setError("No se pudo conectar con DMAP");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-[#c9a24b] px-4 py-2 text-sm font-medium text-[#0b1526] transition hover:bg-[#c9a24b]/90"
      >
        + Nueva publicación
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-900">Elegí una propiedad</h3>
        <button onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:text-slate-700">
          Cancelar
        </button>
      </div>

      <input
        type="text"
        placeholder="Buscar por referencia, título o zona…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(null);
        }}
        className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />

      {properties === null ? (
        <p className="mt-3 text-sm text-slate-500">Cargando propiedades…</p>
      ) : (
        <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto">
          {filtered.length === 0 && <li className="text-sm text-slate-500">Sin resultados.</li>}
          {filtered.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => setSelected(p)}
                disabled={Boolean(p.existingPublication)}
                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
                  selected?.id === p.id
                    ? "border-[#c9a24b] bg-[#c9a24b]/10"
                    : p.existingPublication
                      ? "cursor-not-allowed border-slate-100 opacity-60"
                      : "border-slate-200 hover:border-[#c9a24b]/50"
                }`}
              >
                <span className="min-w-0 truncate">
                  <span className="font-medium text-slate-900">{p.titulo}</span>{" "}
                  <span className="text-xs text-slate-500">
                    {p.ref} {p.zona ? `· ${p.zona}` : ""} {p.precio ? `· ${p.precio}` : ""}
                  </span>
                </span>
                {p.existingPublication && (
                  <span
                    className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      PUBLICATION_STATUS_COLORS[p.existingPublication.status as PublicationStatus] ?? "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {PUBLICATION_STATUS_LABELS[p.existingPublication.status as PublicationStatus] ?? p.existingPublication.status}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
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
            disabled={loading}
            className="rounded-lg bg-[#c9a24b] px-3 py-1.5 text-xs font-medium text-[#0b1526] transition hover:bg-[#c9a24b]/90 disabled:opacity-50"
          >
            {loading ? "Generando…" : `Generar para "${selected.titulo}"`}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
