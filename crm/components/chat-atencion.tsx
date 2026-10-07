"use client";

// Lo que el asesor necesita ver ARRIBA del chat (plan 6, 2026-10-07: "que
// desde ahi se pueda tomar control de la conversacion... lo mas intuitivo
// posible"):
//   - por que este chat lo espera (pide asesor / transferido), con el boton
//     de tomar la conversacion al alcance;
//   - la visita por confirmar, con Confirmar / Otro horario ahi mismo;
//   - cuanto queda de la ventana de 24 h de WhatsApp para escribir libre.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Lead, Message } from "@/lib/types";

const fmt = (iso?: string) =>
  iso
    ? new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso))
    : "sin fecha";

const MOTIVO: Record<string, string> = {
  pide_asesor: "🙋 Pidió hablar con un asesor",
  transferido: "🔁 Sofi te lo transfirió",
  visita: "📅 Tiene una visita por confirmar",
};

export default function ChatAtencion({
  lead,
  messages,
  modo,
  onTomar,
}: {
  lead: Lead | undefined;
  messages: Message[];
  modo: "bot" | "humano";
  onTomar: () => void;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  if (!lead) return null;

  // Ventana de 24 h: desde el ultimo mensaje del cliente/colega.
  const ultimoDelCliente = [...messages].reverse().find((m) => m.role === "user");
  const horasQuedan = ultimoDelCliente ? 24 - (Date.now() - new Date(ultimoDelCliente.created_at).getTime()) / 3600000 : -1;

  const cita = lead.cita && lead.cita.estado === "propuesta" ? lead.cita : null;
  const pendiente = lead.atencion_pendiente && lead.atencion_pendiente !== "visita" ? lead.atencion_pendiente : null;

  async function accion(tipo: "confirmar" | "otro") {
    setEnviando(tipo);
    setResultado(null);
    const r = await fetch("/api/citas/accion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: lead!.id, accion: tipo }),
    });
    const body = await r.json().catch(() => ({}));
    setEnviando(null);
    setResultado(r.ok ? body.texto || "Listo." : body.error || "No se pudo, intentá de nuevo.");
    if (r.ok) router.refresh();
  }

  return (
    <div className="space-y-2 border-b border-slate-200 bg-white px-3 py-2 sm:px-4">
      {pendiente && modo === "bot" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          <span>
            {MOTIVO[pendiente] || "Este chat espera a un asesor"}
            {lead.atencion_desde ? <span className="text-amber-700"> · {fmt(lead.atencion_desde)}</span> : null}
          </span>
          <button onClick={onTomar} className="rounded-md bg-purple-600 px-3 py-1 text-xs font-semibold text-white hover:bg-purple-700">
            🙋 Tomar conversación
          </button>
        </div>
      )}

      {cita && (
        <div className="rounded-lg bg-[#0b1526] px-3 py-2.5 text-sm text-white">
          <div className="font-semibold text-[#e8c46a]">📅 Visita por confirmar</div>
          <div>
            {fmt(cita.fecha_hora)}
            {cita.ref ? ` · ref ${cita.ref}` : ""}
          </div>
          {cita.corte_at && <div className="text-xs text-slate-300">Confirmá antes de {fmt(cita.corte_at)} o se cancela sola.</div>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              disabled={!!enviando}
              onClick={() => accion("confirmar")}
              className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-60"
            >
              {enviando === "confirmar" ? "Confirmando…" : "✅ Confirmar"}
            </button>
            <button
              disabled={!!enviando}
              onClick={() => accion("otro")}
              className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/30 hover:bg-white/20 disabled:opacity-60"
            >
              {enviando === "otro" ? "Enviando…" : "🕐 Otro horario"}
            </button>
          </div>
          <div className="mt-1 text-[11px] text-slate-400">Al confirmar, Sofi le avisa al cliente por este chat. “Otro horario” cancela y le ofrece reagendar.</div>
        </div>
      )}

      {resultado && <div className="text-xs text-slate-600">{resultado}</div>}

      {modo === "humano" && (
        <div className={`text-xs ${horasQuedan > 2 ? "text-slate-500" : horasQuedan > 0 ? "text-amber-700" : "text-red-600"}`}>
          {horasQuedan > 0
            ? `⏱️ Quedan ${horasQuedan >= 1 ? `${Math.floor(horasQuedan)} h` : `${Math.max(1, Math.round(horasQuedan * 60))} min`} para responderle libre por WhatsApp.`
            : "⏱️ Pasaron más de 24 h desde su último mensaje: WhatsApp no deja escribirle libre hasta que vuelva a escribir."}
        </div>
      )}
    </div>
  );
}
