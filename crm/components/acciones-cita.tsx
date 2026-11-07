"use client";

// Confirmar / Otro horario de una visita por confirmar. Lo comparten la
// tarjeta del chat (chat-atencion.tsx) y "Para atender" (caso Claudia,
// 2026-11-06: la tarjeta de Para atender no tenia ningun boton y la asesora
// se fue a buscar al cliente en su WhatsApp). La logica vive en el bot
// (/api/citas/accion -> src/lib/confirmar-cita.js): la cita queda de quien
// confirma y Sofi le avisa al cliente/colega.
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AccionesCita({ leadId, oscuro = false }: { leadId: string; oscuro?: boolean }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);

  async function accion(tipo: "confirmar" | "otro") {
    setEnviando(tipo);
    setResultado(null);
    const r = await fetch("/api/citas/accion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId, accion: tipo }),
    });
    const body = await r.json().catch(() => ({}));
    setEnviando(null);
    setResultado(r.ok ? body.texto || "Listo." : body.error || "No se pudo, intenta de nuevo.");
    if (r.ok) router.refresh();
  }

  const secundario = oscuro
    ? "bg-white/10 text-white ring-1 ring-white/30 hover:bg-white/20"
    : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50";
  return (
    <div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          disabled={!!enviando}
          onClick={() => accion("confirmar")}
          className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-60"
        >
          {enviando === "confirmar" ? "Confirmando…" : "✅ Confirmar"}
        </button>
        <button disabled={!!enviando} onClick={() => accion("otro")} className={`rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-60 ${secundario}`}>
          {enviando === "otro" ? "Enviando…" : "🕐 Otro horario"}
        </button>
      </div>
      <div className={`mt-1 text-[11px] ${oscuro ? "text-slate-400" : "text-slate-500"}`}>
        Al confirmar, Sofi le avisa al cliente por su chat. “Otro horario” cancela y le ofrece reagendar.
      </div>
      {resultado && <div className={`mt-1 text-xs ${oscuro ? "text-slate-200" : "text-slate-700"}`}>{resultado}</div>}
    </div>
  );
}
