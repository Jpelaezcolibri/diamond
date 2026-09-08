"use client";

import { fechaHoraLarga } from "@/lib/fecha";
import { anclaHilo, claveHilo, type IdentidadHilo } from "@/lib/linea-dm-hilo";

export type DmMensaje = {
  id: string;
  remitente_telefono: string | null;
  /** Lid crudo (`<digitos>@lid`) cuando el chat llegó por direccionamiento
   *  oculto — que es por donde salen los DM del radar y por donde vuelven las
   *  respuestas (Juan, 2026-09-08). Excluyente con remitente_telefono. */
  remitente_lid: string | null;
  remitente_nombre: string | null;
  texto: string | null;
  created_at: string;
  tiene_cita: boolean | null;
  avance_tipo: "cita_confirmada" | "agendando" | "interes_avanzado" | "ninguno" | null;
  cita_fecha_hora_iso: string | null;
  senal_id: string | null;
  /** Texto del pedido de grupo que este remitente publicó, si se resolvió
   *  (group_signals.texto_original). Opcional: la consulta cruda de linea_dm
   *  no lo trae, se agrega después en page.tsx. */
  pedido_original?: string | null;
  /** Cuándo le salió el DM del radar a este colega (group_signals.respondida_at).
   *  Es el "desde cuándo esperamos respuesta" — base del tiempo de respuesta
   *  de la fase 3. */
  pedido_respondida_at?: string | null;
  /** La propiedad que se le ofreció en ese DM (group_signals.respuesta_refs[0]
   *  → properties). Es lo que convierte esto en seguimiento de propiedades y
   *  no en un inbox más. */
  propiedad?: { ref: string; titulo: string | null; link: string | null } | null;
  /** Hay `senal_id`, pero la señal no vino en el enriquecimiento porque
   *  `mias()` la filtró: el pedido existe y este usuario no puede verlo. Es un
   *  estado DISTINTO de "nunca hubo pedido ligado", y confundirlos hacía que
   *  el panel culpara al dato en vez del permiso (revisión final,
   *  2026-09-08). Lo calcula page.tsx, que es quien sabe qué se filtró. */
  pedido_restringido?: boolean;
};

const AVANCE_LABEL: Record<string, { texto: string; clase: string }> = {
  cita_confirmada: { texto: "📅 Cita confirmada", clase: "bg-emerald-50 text-emerald-700" },
  agendando: { texto: "🗓️ Coordinando visita", clase: "bg-amber-50 text-amber-700" },
  interes_avanzado: { texto: "🔥 Posible venta", clase: "bg-rose-50 text-rose-700" },
};

type Hilo = {
  identidad: IdentidadHilo;
  nombre: string | null;
  mensajes: DmMensaje[];
  avanceMasReciente: DmMensaje | null;
};

function agruparPorRemitente(mensajes: DmMensaje[]): Hilo[] {
  const porClave = new Map<string, DmMensaje[]>();
  for (const m of mensajes) {
    const key = claveHilo(m) || `sin-identidad:${m.id}`;
    if (!porClave.has(key)) porClave.set(key, []);
    porClave.get(key)!.push(m);
  }
  const hilos: Hilo[] = [];
  for (const lista of porClave.values()) {
    lista.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const avance = [...lista].reverse().find((m) => m.tiene_cita && m.avance_tipo && m.avance_tipo !== "ninguno") || null;
    hilos.push({
      identidad: { lid: lista[0].remitente_lid, telefono: lista[0].remitente_telefono },
      nombre: lista[lista.length - 1].remitente_nombre,
      mensajes: lista,
      avanceMasReciente: avance,
    });
  }
  // Más reciente actividad primero.
  hilos.sort(
    (a, b) =>
      new Date(b.mensajes[b.mensajes.length - 1].created_at).getTime() -
      new Date(a.mensajes[a.mensajes.length - 1].created_at).getTime()
  );
  return hilos;
}

/** Una celda de "todavía no": la columna existe desde la fase 1 para que el
 *  panel no cambie de forma cuando la fase que la llena se prenda. */
function Pendiente({ etiqueta, fase }: { etiqueta: string; fase: string }) {
  return (
    <span className="text-xs text-slate-400" title={`Se llena en la ${fase}`}>
      {etiqueta}: —
    </span>
  );
}

function Hilo({ hilo }: { hilo: Hilo }) {
  const ultimo = hilo.mensajes[hilo.mensajes.length - 1];
  const badge = hilo.avanceMasReciente?.avance_tipo ? AVANCE_LABEL[hilo.avanceMasReciente.avance_tipo] : null;
  // EN REVERSA: `hilo.mensajes` está ordenado ascendente (más viejo primero),
  // así que un `find` directo tomaba el pedido MÁS VIEJO. Un colega que
  // recibió dos DM por dos pedidos distintos y contestó a los dos veía en el
  // encabezado la ref del primero (revisión final, 2026-09-08) —
  // contradiciendo la regla de la spec ("dos DM seguidos al mismo colega
  // atribuyen la respuesta al segundo") y el propio orden del panel, que
  // lista por actividad más reciente. Mismo criterio que `avance`, arriba.
  const conPedido = [...hilo.mensajes].reverse().find((m) => m.pedido_original || m.propiedad || m.pedido_respondida_at);
  const pedido = conPedido?.pedido_original ?? null;
  const propiedad = conPedido?.propiedad ?? null;
  const dmSalio = conPedido?.pedido_respondida_at ?? null;
  // El hilo lo ve todo el equipo, pero el pedido y la propiedad siguen
  // pasando por mias(): si la señal es de otra asesora, el hilo se ve y su
  // pedido no. Decir "sin pedido ligado" ahí es falso.
  const pedidoRestringido = !pedido && !propiedad && hilo.mensajes.some((m) => m.pedido_restringido);
  const quien = hilo.nombre || (hilo.identidad.telefono ? `+${hilo.identidad.telefono}` : null) || "Colega sin nombre";

  return (
    <details id={anclaHilo(hilo.identidad, hilo.mensajes[0].id)} className="group scroll-mt-24 px-4 py-3 open:bg-slate-50">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">
            {quien}
            {propiedad ? (
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-600">
                Ref {propiedad.ref}
              </span>
            ) : (
              <span className="ml-2 text-xs font-normal text-slate-400">
                {pedidoRestringido ? "propiedad no visible" : "sin propiedad ligada"}
              </span>
            )}
          </p>
          <p className="truncate text-sm text-slate-500">{ultimo.texto || "(imagen o adjunto)"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {badge ? (
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge.clase}`}>{badge.texto}</span>
          ) : (
            <Pendiente etiqueta="Cita" fase="fase 2 (clasificador)" />
          )}
          <span className="text-xs text-slate-400">{fechaHoraLarga(ultimo.created_at)}</span>
        </div>
      </summary>

      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
        {propiedad ? (
          <p className="rounded bg-slate-100 px-3 py-2 text-sm text-slate-600">
            <span className="font-medium">Propiedad ofrecida: </span>
            {propiedad.link ? (
              <a href={propiedad.link} target="_blank" rel="noreferrer" className="underline">
                {propiedad.titulo || `Ref ${propiedad.ref}`}
              </a>
            ) : (
              propiedad.titulo || `Ref ${propiedad.ref}`
            )}
          </p>
        ) : null}
        {pedido ? (
          <p className="rounded bg-slate-100 px-3 py-2 text-sm text-slate-600">
            <span className="font-medium">Pedido original: </span>
            {pedido}
          </p>
        ) : pedidoRestringido ? (
          <p className="text-xs text-slate-400">
            El pedido de esta señal no es visible con tu usuario — lo publicó una señal de otra asesora.
          </p>
        ) : (
          <p className="text-xs text-slate-400">Sin pedido ligado — puede ser alguien que nunca publicó, o un pedido anterior al 4-sep.</p>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          {dmSalio ? <span>DM enviado: {fechaHoraLarga(dmSalio)}</span> : <span className="text-slate-400">DM enviado: —</span>}
          <Pendiente etiqueta="Tiempo hasta responder" fase="fase 3 (tiempos)" />
        </div>
        {hilo.mensajes.map((m) => (
          <div key={m.id} className="flex items-baseline justify-between gap-3 text-sm">
            <p className="min-w-0 flex-1 text-slate-700">{m.texto || "(imagen o adjunto)"}</p>
            <span className="shrink-0 text-xs text-slate-400">{fechaHoraLarga(m.created_at)}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

export default function LineaDmInbox({
  mensajes,
  embebido = false,
}: {
  mensajes: DmMensaje[];
  /** Sin borde propio: vive dentro de una tarjeta que ya lo tiene. */
  embebido?: boolean;
}) {
  const hilos = agruparPorRemitente(mensajes);

  if (hilos.length === 0) {
    return (
      <div className={`p-6 text-center text-sm text-slate-500 ${embebido ? "" : "rounded-lg border border-dashed border-slate-300"}`}>
        <p>Todavía no llegó ningún mensaje directo a la línea vinculada.</p>
        <p className="mt-1 text-xs text-slate-400">
          Los mensajes se guardan desde el despliegue del 2026-09-08; antes de esa fecha no quedó registro.
        </p>
      </div>
    );
  }

  return (
    <div className={`divide-y divide-slate-100 bg-white ${embebido ? "" : "rounded-lg border border-slate-200"}`}>
      {hilos.map((h) => (
        <Hilo key={claveHilo(h.mensajes[0]) || h.mensajes[0].id} hilo={h} />
      ))}
    </div>
  );
}
