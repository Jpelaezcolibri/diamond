"use client";

import { useState } from "react";
import { absoluteDateTime } from "@/lib/types";

export type MatchPendiente = {
  id: string;
  mandato_id: string;
  ally_property_id: string;
  puntaje: number | null;
  error: string | null;
  escalado_a: string | null;
  created_at: string;
  /** El aviso YA redactado que no se pudo entregar. Se guarda al registrar la
   *  alerta (src/data/mandatos.js#marcarEntrega), así que acá se puede copiar
   *  y mandar a mano tal cual, sin reconstruir nada. */
  texto?: string | null;
  mandatos_compra?: { cliente_nombre: string | null } | null;
  ally_properties?: { mensaje_original: string | null } | null;
};

// Por qué no salió, en palabras. `error` viene crudo de la API de Meta y dice
// cosas como "(#131047) Message failed to send because more than 24 hours...";
// la asesora necesita saber qué hacer, no el código.
function porQue(m: MatchPendiente): { titulo: string; queHacer: string } {
  const e = String(m.error || "");
  if (/24\s*hours?|24\s*horas?|re-?engagement|131047/i.test(e)) {
    return {
      titulo: "La ventana de WhatsApp estaba cerrada",
      queHacer: "Pedile que le escriba cualquier cosa a Sofi. Eso reabre el canal por 24 horas y los avisos vuelven a entrar.",
    };
  }
  if (/131056|rate limit/i.test(e)) {
    return {
      titulo: "WhatsApp frenó el envío por frecuencia",
      queHacer: "Se le mandaron demasiados mensajes seguidos. Copiá el aviso y mandáselo vos, o esperá unos minutos.",
    };
  }
  if (/4096|too long/i.test(e)) {
    return { titulo: "El mensaje era demasiado largo", queHacer: "Copiá el aviso de abajo y mandáselo vos." };
  }
  if (!e) return { titulo: "Todavía sin entregar", queHacer: "Está en la cola de salida. Si sigue acá en un rato, copiá el aviso y mandalo vos." };
  return { titulo: "No se pudo entregar", queHacer: "Copiá el aviso de abajo y mandáselo vos." };
}

function Fila({ m }: { m: MatchPendiente }) {
  const [abierto, setAbierto] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const razon = porQue(m);
  const cliente = m.mandatos_compra?.cliente_nombre || "un cliente";
  // La primera línea del aviso guardado ya trae la ficha corta de la oferta.
  const resumen = String(m.texto || "")
    .split("\n")
    .find((l) => /venta|arriendo|\$/i.test(l) && l.trim().length > 10)
    ?.trim();

  async function copiar() {
    if (!m.texto) return;
    try {
      await navigator.clipboard.writeText(m.texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* sin portapapeles: el texto igual está a la vista al desplegar */
    }
  }

  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-slate-900">Para {cliente}</p>
        <span className="text-xs text-slate-500">{absoluteDateTime(m.created_at)}</span>
      </div>
      {resumen && <p className="mt-0.5 text-slate-700">{resumen}</p>}

      <p className="mt-1.5 text-xs font-semibold text-rose-800">{razon.titulo}</p>
      <p className="text-xs text-slate-600">{razon.queHacer}</p>
      {m.escalado_a && <p className="mt-1 text-xs text-slate-500">Se escaló a +{m.escalado_a}.</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {m.texto && (
          <>
            <button
              type="button"
              onClick={copiar}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white"
            >
              {copiado ? "¡Copiado!" : "Copiar el aviso"}
            </button>
            <button
              type="button"
              onClick={() => setAbierto((v) => !v)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700"
            >
              {abierto ? "Ocultar" : "Ver el mensaje"}
            </button>
          </>
        )}
        <span className="text-xs text-slate-400">
          {m.puntaje !== null ? `puntaje ${m.puntaje}` : null}
        </span>
      </div>

      {abierto && m.texto && (
        <pre className="mt-2 whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-2.5 text-xs text-slate-700">
          {m.texto}
        </pre>
      )}
    </div>
  );
}

export function MatchesPendientesPanel({ matches }: { matches: MatchPendiente[] }) {
  if (matches.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        Ningún match sin entregar. Cuando un aviso no se pueda mandar a la asesora aparece acá, con el motivo y el
        mensaje listo para copiar.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {matches.map((m) => (
        <Fila key={m.id} m={m} />
      ))}
    </div>
  );
}
