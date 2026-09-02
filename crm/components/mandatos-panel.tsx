import { absoluteDateTime } from "@/lib/types";

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

export type MatchEncontrado = {
  id: string;
  mandato_id: string;
  ally_property_id: string;
  puntaje: number | null;
  entregado_at: string | null;
  escalado_a: string | null;
  texto: string | null;
  created_at: string;
  ally_properties: { mensaje_original: string | null } | null;
};

function pesos(n: number | null) {
  return n ? `$${n.toLocaleString("es-CO")}` : null;
}

export function MandatosPanel({
  mandatos,
  conteo,
}: {
  mandatos: Mandato[];
  /** Matches entregados por mandato (mandato_id → cantidad), opcional. Se
   *  calcula en page.tsx sobre los matches que ya trae: ninguna consulta más. */
  conteo?: Map<string, number>;
}) {
  if (mandatos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        Todavía no hay mandatos de compra cargados. Reenviale a Sofi el pedido de un
        cliente comprador para que empiece a cruzarlo contra lo que publican los colegas.
      </div>
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {mandatos.map((m) => (
        <div key={m.id} className="rounded-xl border border-slate-200 border-t-[3px] border-t-sky-600 bg-white p-3">
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
          {conteo && (
            <p className={`mt-2 text-xs font-semibold ${conteo.get(m.id) ? "text-emerald-700" : "text-slate-400"}`}>
              {conteo.get(m.id)
                ? `${conteo.get(m.id)} match${conteo.get(m.id) === 1 ? "" : "es"} entregado${conteo.get(m.id) === 1 ? "" : "s"}`
                : "todavía sin match"}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// El link a la publicacion (cuando el colega lo pego) solo vive dentro del
// texto crudo que compartio en el grupo -- mandato_match_alerts.texto (el
// aviso que ya se le mando a la asesora) NUNCA lo incluye.
function extraerLink(texto: string | null): string | null {
  if (!texto) return null;
  const m = texto.match(/https?:\/\/\S+/);
  return m ? m[0] : null;
}

export function MatchesEncontradosPanel({ matches }: { matches: MatchEncontrado[] }) {
  if (matches.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        Todavía ningún colega publicó algo que le sirva a un mandato activo. En cuanto pase, la
        asesora dueña del mandato ya lo recibe por WhatsApp — acá queda el registro.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {matches.map((m) => (
        <div key={m.id} className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-sm">
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-emerald-800">
              {m.entregado_at ? "Entregado a la asesora" : "Match encontrado"}
              {m.escalado_a && " · escalado por silencio"}
            </span>
            <span className="text-xs text-slate-400">{absoluteDateTime(m.created_at)}</span>
          </div>
          <p className="whitespace-pre-wrap text-slate-800">{m.texto || "(sin texto guardado)"}</p>
          {(() => {
            const link = extraerLink(m.ally_properties?.mensaje_original ?? null);
            return link ? (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-xs font-medium text-blue-700 underline"
              >
                🔗 Ver publicación original
              </a>
            ) : (
              <p className="mt-1 text-xs text-slate-400">Sin link — contactá al colega directo.</p>
            );
          })()}
        </div>
      ))}
    </div>
  );
}
