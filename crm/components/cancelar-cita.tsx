"use client";

import { createContext, useContext, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Cancelar una cita desde el calendario (Juan, 2026-09-04). Sofi NUNCA cancela
// sola: la cancelación siempre la dispara una persona, y este es el botón.
//
// Está partido en dos piezas a propósito:
//  - <CancelarCitaAvisos> envuelve la grilla y es quien guarda el resultado.
//  - <BotonCancelarCita> vive dentro de la celda del día y solo dispara.
//
// El motivo es que al cancelar se refresca la página y la cita cancelada
// DESAPARECE del calendario (lib/calendar-events.ts filtra las canceladas).
// Si el mensaje viviera en el botón, se desmontaría junto con el chip y el
// aviso más importante del flujo — "no le pudimos avisar al colega" — se
// perdería justo en el momento en que hay que actuar. Arriba de la grilla,
// el estado sobrevive al router.refresh().

// Los tres avisos que devuelve el bot, más "ya_cancelada": ese caso no manda
// nada porque no hay nada que cancelar, y viene con aviso null. Sin
// distinguirlo caería en el aviso rojo de "no le pudimos avisar", que es una
// falsa alarma — y una alarma que grita cuando no pasa nada deja de leerse.
type Aviso = "oficial" | "linea_natalia" | "no_se_pudo" | "ya_cancelada";

type Resultado = {
  aviso: Aviso;
  cliente: string | null;
} | null;

type Ctx = {
  ocupado: string | null;
  cancelar: (leadId: string, cliente: string | null) => void;
};

const CancelarCtx = createContext<Ctx | null>(null);

// Cuánto queda en pantalla un aviso que SÍ salió. Los que salieron bien se van
// solos; el que no salió no se va nunca hasta que alguien lo cierre a mano.
const AUTO_CIERRE_MS = 10_000;

export function CancelarCitaAvisos({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado>(null);
  const [error, setError] = useState<string | null>(null);

  // Solo los avisos que llegaron a destino se cierran solos. "no_se_pudo"
  // se queda hasta que la persona lo cierre: es lo único que le recuerda que
  // el colega todavía cree que la visita sigue en pie.
  useEffect(() => {
    if (!resultado || resultado.aviso === "no_se_pudo") return;
    const t = setTimeout(() => setResultado(null), AUTO_CIERRE_MS);
    return () => clearTimeout(t);
  }, [resultado]);

  async function cancelar(leadId: string, cliente: string | null) {
    const quien = cliente ? ` de ${cliente}` : "";
    const motivo = window.prompt(
      `Cancelar la cita${quien}.\n\n` +
        "¿Por qué se cancela? Se le manda tal cual al colega, así que escribilo como se lo dirías.\n" +
        "(Podés dejarlo vacío.)"
    );
    // prompt() devuelve null si le dieron «Cancelar»: eso es arrepentirse, no
    // un motivo vacío. Una cadena vacía sí es "cancelar sin explicación".
    if (motivo === null) return;

    setOcupado(leadId);
    setError(null);
    setResultado(null);
    try {
      const res = await fetch("/api/citas/cancelar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, motivo: motivo.trim() || null }),
      }).catch(() => null);
      const body = res ? await res.json().catch(() => ({})) : {};
      if (!res || !res.ok) throw new Error(body.error || "El bot no respondió");

      // Si el bot no dice de dónde salió el aviso, se asume lo peor. Un aviso
      // que no sabemos si llegó tiene exactamente las mismas consecuencias que
      // uno que no llegó: un colega parado en la puerta con su cliente. La
      // única excepción es "ya_cancelada", donde no se mandó nada porque no
      // había nada que cancelar.
      const aviso: Aviso =
        body.resultado === "ya_cancelada"
          ? "ya_cancelada"
          : body.aviso === "oficial" || body.aviso === "linea_natalia"
            ? body.aviso
            : "no_se_pudo";
      setResultado({ aviso, cliente });
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cancelar");
    } finally {
      setOcupado(null);
    }
  }

  return (
    <CancelarCtx.Provider value={{ ocupado, cancelar }}>
      {children}
      {(resultado || error) && (
        // Fijo al pie de la ventana y no arriba de la grilla: se cancela una
        // cita desde la celda del día que se esté mirando, que puede estar
        // muy abajo. Un banner en el encabezado quedaría fuera de pantalla.
        <div
          role="alert"
          aria-live="assertive"
          className="fixed inset-x-0 bottom-4 z-50 mx-auto w-[min(36rem,calc(100%-2rem))]"
        >
          {error && (
            <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 shadow-lg">
              <span className="text-lg leading-none">⚠️</span>
              <div className="flex-1">
                <p className="font-medium">No se pudo cancelar la cita.</p>
                <p className="text-xs text-red-700/80">{error} — la cita sigue en pie.</p>
              </div>
              <button type="button" onClick={() => setError(null)} className="text-xs font-medium underline">
                Cerrar
              </button>
            </div>
          )}
          {resultado?.aviso === "ya_cancelada" && (
            <div className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 shadow-lg">
              <span className="text-lg leading-none">ℹ️</span>
              <p className="flex-1">
                <strong>Esa cita ya estaba cancelada.</strong> No se le mandó nada nuevo al colega.
              </p>
            </div>
          )}
          {resultado?.aviso === "oficial" && (
            <div className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 shadow-lg">
              <span className="text-lg leading-none">✅</span>
              <p className="flex-1">
                <strong>Cancelada, le avisamos.</strong> El colega ya recibió el mensaje por la
                línea oficial.
              </p>
            </div>
          )}
          {resultado?.aviso === "linea_natalia" && (
            <div className="flex items-start gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 shadow-lg">
              <span className="text-lg leading-none">✅</span>
              <p className="flex-1">
                <strong>Cancelada, le avisamos por la línea del radar.</strong> No salió por la
                línea oficial, pero el mensaje se entregó.
              </p>
            </div>
          )}
          {resultado?.aviso === "no_se_pudo" && (
            // El caso que no puede pasar desapercibido: la cita quedó
            // cancelada pero el colega NO se enteró, ni por la línea oficial ni
            // por la de Natalia. Si esto se lee como un éxito, el colega llega
            // con su cliente a una visita que ya no existe. Por eso: rojo,
            // borde grueso, texto grande, y no se cierra solo.
            <div className="flex items-start gap-3 rounded-2xl border-2 border-red-500 bg-red-50 p-4 text-red-900 shadow-xl">
              <span className="text-2xl leading-none">⚠️</span>
              <div className="flex-1">
                <p className="text-base font-bold">
                  Cancelada, pero NO le pudimos avisar — escribile vos.
                </p>
                <p className="mt-1 text-sm text-red-800">
                  El mensaje no salió ni por la línea oficial ni por la del radar. Para el colega
                  {resultado.cliente ? ` (${resultado.cliente})` : ""} la visita <strong>sigue en
                  pie</strong>: escribile por WhatsApp antes de cerrar esto.
                </p>
                <button
                  type="button"
                  onClick={() => setResultado(null)}
                  className="mt-2 rounded-md border border-red-400 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100"
                >
                  Ya le escribí
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </CancelarCtx.Provider>
  );
}

export function BotonCancelarCita({
  leadId,
  cliente,
}: {
  leadId: string;
  cliente: string | null;
}) {
  const ctx = useContext(CancelarCtx);
  if (!ctx) return null;
  const esta = ctx.ocupado === leadId;
  return (
    <button
      type="button"
      onClick={() => ctx.cancelar(leadId, cliente)}
      disabled={ctx.ocupado !== null}
      title="Cancelar esta cita y avisarle al colega"
      className="block w-full truncate rounded-md border border-slate-200 px-1.5 py-0.5 text-left text-[11px] font-medium text-slate-500 hover:bg-slate-50 hover:text-red-700 disabled:opacity-40"
    >
      {esta ? "Cancelando…" : "Cancelar"}
    </button>
  );
}
