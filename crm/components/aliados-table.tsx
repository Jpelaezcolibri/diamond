"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ALLY_ESTADO_COLORS, ALLY_ESTADO_LABELS, ALLY_ESTADOS, absoluteDateTime, type AllyProperty } from "@/lib/types";
import type { TeamMember } from "@/lib/team";

const EDITABLE_FIELDS: Array<{ key: keyof AllyProperty; label: string }> = [
  { key: "ref", label: "Referencia" },
  { key: "titulo", label: "Título" },
  { key: "tipo", label: "Tipo" },
  { key: "zona", label: "Zona" },
  { key: "ciudad", label: "Ciudad" },
  { key: "precio", label: "Precio" },
  { key: "notas", label: "Notas del asesor" },
];

export default function AliadosTable({ items, roster }: { items: AllyProperty[]; roster: Record<string, TeamMember> }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<string>("todos");
  const [editing, setEditing] = useState<AllyProperty | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items
      .filter((a) => filtroEstado === "todos" || a.estado === filtroEstado)
      .filter((a) => {
        if (!term) return true;
        return [a.zona, a.tipo, a.ref, a.titulo, a.inmobiliaria_origen, a.contacto_nombre]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(term));
      });
  }, [items, q, filtroEstado]);

  async function cambiarEstado(id: string, estado: string) {
    setBusyId(id);
    const res = await fetch("/api/aliados/estado", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, estado }),
    });
    if (res.ok) {
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      alert(body.error || "No se pudo actualizar el estado");
    }
    setBusyId(null);
  }

  async function guardarEdicion() {
    if (!editing) return;
    setBusyId(editing.id);
    const patch: Record<string, string | null> = { id: editing.id };
    for (const { key } of EDITABLE_FIELDS) patch[key] = (editing[key] as string | null) ?? null;
    const res = await fetch("/api/aliados/actualizar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      setEditing(null);
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      alert(body.error || "No se pudo guardar");
    }
    setBusyId(null);
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por zona, tipo, referencia, contacto..."
          className="w-full max-w-sm rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none focus:border-[#c9a24b]"
        />
        <select
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value)}
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#c9a24b]"
        >
          <option value="todos">Todos los estados</option>
          {ALLY_ESTADOS.map((e) => (
            <option key={e} value={e}>
              {ALLY_ESTADO_LABELS[e]}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Propiedad</th>
              <th className="px-4 py-3">Zona</th>
              <th className="px-4 py-3">Precio</th>
              <th className="px-4 py-3">Contacto</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr
                key={a.id}
                onClick={() => setEditing(a)}
                title="Ver / editar la propiedad"
                className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50/80"
              >
                <td className="px-4 py-3">
                  <p className="font-semibold text-slate-900">{a.titulo || a.tipo || "Sin título"}</p>
                  <p className="text-xs text-slate-400">
                    {a.operacion || "—"} {a.ref && `· ref ${a.ref}`}
                  </p>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {a.zona || "—"}
                  {a.ciudad && <span className="text-slate-400">, {a.ciudad}</span>}
                </td>
                <td className="px-4 py-3 text-slate-600">{a.precio || "—"}</td>
                <td className="px-4 py-3">
                  <p className="text-slate-700">{a.contacto_nombre || "Sin nombre"}</p>
                  <p className="text-xs text-slate-400">
                    {a.inmobiliaria_origen || "—"} {a.contacto_telefono && `· +${a.contacto_telefono}`}
                  </p>
                  {a.registrado_por && roster[a.registrado_por] && (
                    <p className="text-[11px] font-medium text-[#8a6a1f]">
                      🧑‍💼 Ingresada por {roster[a.registrado_por].nombre}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ALLY_ESTADO_COLORS[a.estado] || "bg-slate-100"}`}>
                    {ALLY_ESTADO_LABELS[a.estado] || a.estado}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1.5 whitespace-nowrap">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(a);
                      }}
                      className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-50"
                    >
                      Editar
                    </button>
                    {a.estado !== "confirmada" && (
                      <button
                        disabled={busyId === a.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          void cambiarEstado(a.id, "confirmada");
                        }}
                        className="rounded-full border border-emerald-200 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                      >
                        Confirmar
                      </button>
                    )}
                    {a.estado !== "no_disponible" && (
                      <button
                        disabled={busyId === a.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          void cambiarEstado(a.id, "no_disponible");
                        }}
                        className="rounded-full border border-red-200 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-40"
                      >
                        No disponible
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  {items.length === 0 ? "Sin propiedades de aliados todavía." : "Sin resultados para esa búsqueda."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(null)}>
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-start justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900">{editing.titulo || editing.tipo || "Propiedad de aliado"}</h2>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${ALLY_ESTADO_COLORS[editing.estado] || "bg-slate-100"}`}>
                {ALLY_ESTADO_LABELS[editing.estado] || editing.estado}
              </span>
            </div>

            {/* Ficha del colega y trazabilidad — solo lectura */}
            <div className="mb-3 rounded-lg bg-[#faf8f3] p-3 text-xs text-slate-600">
              <p>
                <span className="font-semibold">Colega:</span> {editing.contacto_nombre || "Sin nombre"}
                {editing.inmobiliaria_origen && ` · ${editing.inmobiliaria_origen}`}
                {editing.contacto_telefono && ` · +${editing.contacto_telefono}`}
              </p>
              {editing.registrado_por && roster[editing.registrado_por] && (
                <p className="mt-0.5 font-medium text-[#8a6a1f]">
                  🧑‍💼 Ingresada por {roster[editing.registrado_por].nombre}
                </p>
              )}
              <p className="mt-0.5 text-slate-400">Registrada el {absoluteDateTime(editing.created_at)}</p>
            </div>

            {editing.mensaje_original && (
              <p className="mb-4 rounded-lg bg-slate-50 p-2 text-xs text-slate-500">
                Mensaje original: “{editing.mensaje_original}”
              </p>
            )}
            <div className="space-y-3">
              {EDITABLE_FIELDS.map(({ key, label }) => (
                <div key={key}>
                  <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
                  <input
                    value={(editing[key] as string | null) || ""}
                    onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-[#c9a24b]"
                  />
                </div>
              ))}
            </div>

            {/* Aprobar / marcar no disponible desde el detalle */}
            <div className="mt-4 flex flex-wrap gap-2">
              {editing.estado !== "confirmada" && (
                <button
                  disabled={busyId === editing.id}
                  onClick={async () => {
                    await cambiarEstado(editing.id, "confirmada");
                    setEditing(null);
                  }}
                  className="rounded-full border border-emerald-200 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                >
                  ✓ Confirmar disponible
                </button>
              )}
              {editing.estado !== "no_disponible" && (
                <button
                  disabled={busyId === editing.id}
                  onClick={async () => {
                    await cambiarEstado(editing.id, "no_disponible");
                    setEditing(null);
                  }}
                  className="rounded-full border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
                >
                  ✕ Ya no disponible
                </button>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-50">
                Cancelar
              </button>
              <button
                onClick={guardarEdicion}
                disabled={busyId === editing.id}
                className="rounded-lg bg-[#0b1526] px-4 py-2 text-sm font-medium text-[#c9a24b] hover:bg-[#0b1526]/90 disabled:opacity-40"
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
