"use client";

// Tarjeta de una pregunta de colega en "Para atender" (spec 2026-10-25 §5.4;
// mockup aprobado 2026-10-25-pregunta-pendiente.html). Lo que se escribe se le
// pasa LITERAL al colega por Sofi.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export type Pregunta = {
  id: string;
  ref: string | null;
  pregunta: string;
  estado: string;
  asignada_at: string;
  created_at: string;
  respuesta: string | null;
  respondida_por: string | null;
  entrega_error: string | null;
  lead: { id: string; nombre: string | null; phone: string; source: string | null } | null;
  asesor: string | null;
  fichaUrl?: string | null;
  chatId?: string | null;
};

function haceCuanto(iso: string) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h${min % 60 ? ` ${min % 60} min` : ""}`;
}

function Cabecera({ p, quien }: { p: Pregunta; quien: string }) {
  return (
    <div className="font-semibold text-slate-900">
      {quien} {p.lead?.source === "colega" && <span className="text-xs font-normal text-slate-500">(colega)</span>}
      {p.ref && (
        <span className="text-sm font-normal text-slate-600">
          {" "}
          · Ref {p.ref}
          {p.fichaUrl && (
            <a href={p.fichaUrl} target="_blank" rel="noopener noreferrer" className="ml-1 text-[13px] text-sky-600 hover:underline">
              ver ficha ↗
            </a>
          )}
        </span>
      )}
    </div>
  );
}

export default function PreguntaPendiente({ p }: { p: Pregunta }) {
  const router = useRouter();
  const [respuesta, setRespuesta] = useState("");
  const [enviando, setEnviando] = useState<"responder" | "descartar" | "entregada" | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const quien = p.lead ? p.lead.nombre || `+${p.lead.phone}` : "Alguien";

  async function enviar(accion: "responder" | "descartar" | "entregada") {
    setEnviando(accion);
    setError(null);
    try {
      const r = await fetch("/api/preguntas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion, preguntaId: p.id, respuesta }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok) {
        setMensaje(accion === "responder" ? body.texto || "Listo." : accion === "entregada" ? "Cerrada." : "Descartada.");
        router.refresh();
      } else setError(body.error || "No se pudo, intenta de nuevo.");
    } catch {
      setError("No se pudo, intenta de nuevo.");
    }
    setEnviando(null);
  }

  if (p.estado === "respondida") {
    return (
      <li className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <Cabecera p={p} quien={quien} />
        <div className="mt-1.5 break-words text-sm text-slate-800">
          Respondida por {p.respondida_por || "el equipo"}: <span className="italic">«{p.respuesta}»</span>
        </div>
        <div className="mt-1.5 text-[12.5px] font-semibold text-amber-800">
          {p.entrega_error === "solo_llamada" ? "Pidió solo llamada: llámalo y dale la respuesta." : "No le pude pasar la respuesta: escríbele desde el chat."}
        </div>
        {mensaje ? (
          <div className="mt-2 text-[13.5px] font-semibold text-emerald-700">✓ {mensaje}</div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {p.chatId && (
              <Link href={`/inbox/${p.chatId}`} className="inline-block rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-[13px] font-bold text-slate-700 hover:bg-slate-50">
                Abrir chat
              </Link>
            )}
            <button
              disabled={enviando !== null}
              onClick={() => enviar("entregada")}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-[13px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {enviando === "entregada" ? "Cerrando…" : "Ya le respondí"}
            </button>
          </div>
        )}
        {error && <div className="mt-1.5 text-xs text-red-600">{error}</div>}
      </li>
    );
  }

  return (
    <li className="rounded-xl border border-sky-200 bg-sky-50 p-4">
      <Cabecera p={p} quien={quien} />
      {mensaje ? (
        <div className="mt-2 text-[13.5px] font-semibold text-emerald-700">✓ {mensaje}</div>
      ) : (
        <>
          <div className="mt-1.5 break-words text-[15px] leading-snug text-slate-900">{p.pregunta}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-800">Espera hace {haceCuanto(p.created_at)}</span>
            <span>{p.asesor ? `la tiene ${p.asesor}` : "sin asesor asignado"}</span>
          </div>
          <textarea
            value={respuesta}
            onChange={(e) => setRespuesta(e.target.value)}
            rows={3}
            placeholder="Escribe el dato tal cual: se lo pasamos literal al colega"
            className="mt-2.5 min-h-16 w-full resize-y rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              disabled={enviando !== null || !respuesta.trim()}
              onClick={() => enviar("responder")}
              className="rounded-lg bg-[#0b1526] px-3.5 py-2 text-[13px] font-bold text-white hover:bg-[#13213a] disabled:opacity-60"
            >
              {enviando === "responder" ? (
                "Enviando…"
              ) : (
                <>
                  Enviar respuesta <span className="text-[#c9a24b]">→</span>
                </>
              )}
            </button>
            <button
              disabled={enviando !== null}
              onClick={() => enviar("descartar")}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-[13px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {enviando === "descartar" ? "Descartando…" : "Descartar"}
            </button>
            <span className="hidden text-xs text-slate-500 sm:inline">También puedes responder el WhatsApp de Sofi citando el aviso.</span>
          </div>
          {error && <div className="mt-1.5 text-xs text-red-600">{error}</div>}
        </>
      )}
    </li>
  );
}
