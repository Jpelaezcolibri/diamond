"use client";

import { useState } from "react";
import { fechaHoraLarga } from "@/lib/fecha";

export type PosibleVenta = {
  id: string;
  ref: string;
  visita_quien: string | null;
  visita_origen: "cliente" | "colega" | null;
  visita_fecha_hora_iso: string | null;
  alertado_at: string;
  estado: "pendiente" | "confirmada" | "descartada";
  /** Opcional: la consulta cruda de visita_venta_alertas no lo trae, se
   *  agrega despues en page.tsx cruzando con `properties` por ref. */
  propiedad?: { titulo: string | null; link: string | null } | null;
};

const ESTADO_LABEL: Record<PosibleVenta["estado"], { texto: string; clase: string }> = {
  pendiente: { texto: "Por confirmar", clase: "bg-amber-50 text-amber-700" },
  confirmada: { texto: "Confirmada ✓", clase: "bg-emerald-50 text-emerald-700" },
  descartada: { texto: "Descartada", clase: "bg-slate-100 text-slate-500" },
};

function Fila({ venta }: { venta: PosibleVenta }) {
  const [estado, setEstado] = useState(venta.estado);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function marcar(nuevo: PosibleVenta["estado"]) {
    const previo = estado;
    setEstado(nuevo);
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch("/api/grupos/venta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: venta.id, estado: nuevo }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "No se pudo guardar");
    } catch (e) {
      setEstado(previo);
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  const badge = ESTADO_LABEL[estado];

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-slate-900">
            {venta.propiedad?.link ? (
              <a href={venta.propiedad.link} target="_blank" rel="noopener noreferrer" className="hover:underline">
                Ref {venta.ref} — {venta.propiedad?.titulo || "sin título"}
              </a>
            ) : (
              `Ref ${venta.ref} — ${venta.propiedad?.titulo || "sin título"}`
            )}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Visita con {venta.visita_quien || "alguien"}
            {venta.visita_origen ? ` (${venta.visita_origen === "cliente" ? "cliente directo" : "colega"})` : ""}
            {venta.visita_fecha_hora_iso ? ` · ${fechaHoraLarga(venta.visita_fecha_hora_iso)}` : ""}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">Avisado {fechaHoraLarga(venta.alertado_at)}</p>
        </div>
        <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${badge.clase}`}>{badge.texto}</span>
      </div>

      {estado === "pendiente" ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={guardando}
            onClick={() => marcar("confirmada")}
            className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Confirmar venta
          </button>
          <button
            type="button"
            disabled={guardando}
            onClick={() => marcar("descartada")}
            className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            No fue por esto
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={guardando}
          onClick={() => marcar("pendiente")}
          className="mt-2 text-xs text-slate-400 hover:text-slate-600 disabled:opacity-50"
        >
          Deshacer
        </button>
      )}
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

export default function PosiblesVentas({
  ventas,
  embebido = false,
}: {
  ventas: PosibleVenta[];
  /** Sin borde propio: vive dentro de una tarjeta que ya lo tiene. */
  embebido?: boolean;
}) {
  if (ventas.length === 0) {
    return (
      <div className={`p-6 text-center text-sm text-slate-500 ${embebido ? "" : "rounded-lg border border-dashed border-slate-300"}`}>
        Todavía no hay ninguna propiedad con visita agendada que haya dejado de estar disponible.
      </div>
    );
  }

  return (
    <div className={`divide-y divide-slate-100 bg-white ${embebido ? "" : "rounded-lg border border-slate-200"}`}>
      {ventas.map((v) => (
        <Fila key={v.id} venta={v} />
      ))}
    </div>
  );
}
