"use client";

import { useState } from "react";
import NovedadCard from "./novedad-card";

interface Novedad {
  id: number;
  propertyId: string | null;
  changeLabel: string;
  propertyRef: string;
  titulo: string;
  zona?: string | null;
  precio?: string | null;
  createdAt: string;
  existingPublication?: { id: string; status: string } | null;
}

export default function NovedadesSection({
  orgId,
  pendientes,
  pendientesTotal,
  retiradas,
  retiradasTotal,
}: {
  orgId: string;
  pendientes: Novedad[];
  pendientesTotal: number;
  retiradas: Novedad[];
  retiradasTotal: number;
}) {
  const [tab, setTab] = useState<"pendientes" | "retiradas">("pendientes");
  const active = tab === "pendientes" ? pendientes : retiradas;
  const activeTotal = tab === "pendientes" ? pendientesTotal : retiradasTotal;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
          <button
            onClick={() => setTab("pendientes")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              tab === "pendientes" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Pendientes ({pendientesTotal})
          </button>
          <button
            onClick={() => setTab("retiradas")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              tab === "retiradas" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Retiradas ({retiradasTotal})
          </button>
        </div>
        {activeTotal > active.length && (
          <span className="text-xs text-slate-500">
            Mostrando las {active.length} más recientes de {activeTotal}
          </span>
        )}
      </div>

      {active.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          {tab === "pendientes"
            ? "Sin novedades pendientes. Cuando Wasi tenga una propiedad nueva o un cambio de precio, aparecerá aquí."
            : "Ninguna propiedad retirada del catálogo de Wasi por ahora."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {active.map((n) => (
            <NovedadCard
              key={n.id}
              orgId={orgId}
              propertyId={n.propertyId}
              changeLabel={n.changeLabel}
              propertyRef={n.propertyRef}
              titulo={n.titulo}
              zona={n.zona}
              precio={n.precio}
              createdAt={n.createdAt}
              existingPublication={n.existingPublication}
              readOnly={tab === "retiradas"}
            />
          ))}
        </div>
      )}
    </section>
  );
}
