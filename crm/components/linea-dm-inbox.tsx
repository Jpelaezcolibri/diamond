"use client";

import { fechaHoraLarga } from "@/lib/fecha";

export type DmMensaje = {
  id: string;
  remitente_telefono: string | null;
  remitente_nombre: string | null;
  texto: string | null;
  created_at: string;
  tiene_cita: boolean | null;
  avance_tipo: "cita_confirmada" | "agendando" | "interes_avanzado" | "ninguno" | null;
  cita_fecha_hora_iso: string | null;
  senal_id: string | null;
  /** Texto del pedido de grupo que este remitente publico, si se resolvio
   *  por telefono (group_signals.texto_original). Opcional: la consulta cruda
   *  de linea_dm no lo trae, se agrega despues en page.tsx. */
  pedido_original?: string | null;
};

const AVANCE_LABEL: Record<string, { texto: string; clase: string }> = {
  cita_confirmada: { texto: "📅 Cita confirmada", clase: "bg-emerald-50 text-emerald-700" },
  agendando: { texto: "🗓️ Coordinando visita", clase: "bg-amber-50 text-amber-700" },
  interes_avanzado: { texto: "🔥 Posible venta", clase: "bg-rose-50 text-rose-700" },
};

/** id estable del anchor de un hilo — el mismo que usa calendar-events.ts
 *  para el link "ver chat" desde el Calendario del equipo. */
export function anclaHilo(telefono: string | null): string {
  return `dm-${telefono || "sin-telefono"}`;
}

type Hilo = { telefono: string | null; nombre: string | null; mensajes: DmMensaje[]; avanceMasReciente: DmMensaje | null };

function agruparPorRemitente(mensajes: DmMensaje[]): Hilo[] {
  const porTelefono = new Map<string, DmMensaje[]>();
  for (const m of mensajes) {
    const key = m.remitente_telefono || `sin-telefono:${m.id}`;
    if (!porTelefono.has(key)) porTelefono.set(key, []);
    porTelefono.get(key)!.push(m);
  }
  const hilos: Hilo[] = [];
  for (const [telefono, lista] of porTelefono) {
    lista.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const avance = [...lista].reverse().find((m) => m.tiene_cita && m.avance_tipo && m.avance_tipo !== "ninguno") || null;
    hilos.push({
      telefono: lista[0].remitente_telefono,
      nombre: lista[lista.length - 1].remitente_nombre,
      mensajes: lista,
      avanceMasReciente: avance,
    });
  }
  // Mas reciente actividad primero.
  hilos.sort(
    (a, b) =>
      new Date(b.mensajes[b.mensajes.length - 1].created_at).getTime() -
      new Date(a.mensajes[a.mensajes.length - 1].created_at).getTime()
  );
  return hilos;
}

function Hilo({ hilo }: { hilo: Hilo }) {
  const ultimo = hilo.mensajes[hilo.mensajes.length - 1];
  const badge = hilo.avanceMasReciente?.avance_tipo ? AVANCE_LABEL[hilo.avanceMasReciente.avance_tipo] : null;
  const pedido = hilo.mensajes.find((m) => m.pedido_original)?.pedido_original;

  return (
    <details id={anclaHilo(hilo.telefono)} className="group scroll-mt-24 px-4 py-3 open:bg-slate-50">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">
            {hilo.nombre || `+${hilo.telefono}` || "Sin nombre"}
          </p>
          <p className="truncate text-sm text-slate-500">{ultimo.texto}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {badge ? (
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge.clase}`}>{badge.texto}</span>
          ) : null}
          <span className="text-xs text-slate-400">{fechaHoraLarga(ultimo.created_at)}</span>
        </div>
      </summary>

      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
        {pedido ? (
          <p className="rounded bg-slate-100 px-3 py-2 text-sm text-slate-600">
            <span className="font-medium">Pedido original: </span>
            {pedido}
          </p>
        ) : null}
        {hilo.mensajes.map((m) => (
          <div key={m.id} className="flex items-baseline justify-between gap-3 text-sm">
            <p className="min-w-0 flex-1 text-slate-700">{m.texto}</p>
            <span className="shrink-0 text-xs text-slate-400">{fechaHoraLarga(m.created_at)}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

export default function LineaDmInbox({ mensajes }: { mensajes: DmMensaje[] }) {
  const hilos = agruparPorRemitente(mensajes);

  if (hilos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        Todavía no llegó ningún mensaje directo a la línea vinculada.
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
      {hilos.map((h) => (
        <Hilo key={h.telefono || h.mensajes[0].id} hilo={h} />
      ))}
    </div>
  );
}
