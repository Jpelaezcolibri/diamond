export type Mandato = {
  id: string;
  cliente_nombre: string;
  operacion: string | null;
  tipo: string | null;
  zonas: string[];
  precio_max: number | null;
  habitaciones: number | null;
  area_min: number | null;
  exigencias: string[];
  estado: string;
  created_at: string;
};

export type MatchPendiente = {
  id: string;
  mandato_id: string;
  ally_property_id: string;
  puntaje: number | null;
  error: string | null;
  escalado_a: string | null;
  created_at: string;
};

function pesos(n: number | null) {
  return n ? `$${n.toLocaleString("es-CO")}` : null;
}

export function MandatosPanel({ mandatos }: { mandatos: Mandato[] }) {
  if (mandatos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        Todavía no hay mandatos de compra cargados. Reenviale a Sofi el pedido de un
        cliente comprador para que empiece a cruzarlo contra lo que publican los colegas.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {mandatos.map((m) => (
        <div key={m.id} className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900">{m.cliente_nombre}</p>
            <span className="text-xs text-slate-400">
              {m.operacion || "?"} · {m.tipo || "?"}
            </span>
          </div>
          <p className="text-xs text-slate-600">
            {[
              pesos(m.precio_max) ? `hasta ${pesos(m.precio_max)}` : null,
              m.habitaciones ? `${m.habitaciones} hab` : null,
              m.area_min ? `${m.area_min} m² min` : null,
              m.zonas?.length ? m.zonas.join(", ") : null,
            ].filter(Boolean).join(" · ") || "sin más detalle"}
          </p>
          {m.exigencias?.length > 0 && (
            <p className="mt-1 text-xs text-slate-400">Debe tener: {m.exigencias.join(", ")}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function MatchesPendientesPanel({ matches }: { matches: MatchPendiente[] }) {
  if (matches.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        Ningún match sin entregar. Cuando un aviso no se pueda mandar al asesor
        (ventana cerrada y plantilla fallida, o número inválido) aparece acá.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {matches.map((m) => (
        <div key={m.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="text-slate-800">
            Mandato <code className="text-xs">{m.mandato_id.slice(0, 8)}</code> · Oferta{" "}
            <code className="text-xs">{m.ally_property_id.slice(0, 8)}</code>
          </p>
          <p className="mt-1 text-xs text-amber-800">
            {m.escalado_a
              ? "Escalado a +" + m.escalado_a
              : m.error
                ? "Sin entregar: " + m.error
                : "Sin entregar todavía"}
          </p>
        </div>
      ))}
    </div>
  );
}
