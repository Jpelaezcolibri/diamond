"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ETIQUETA: Record<string, string> = { sombra: "Sombra (prueba)", asistido: "Manual", auto: "Automático" };

/**
 * El interruptor entre respuesta MANUAL (Sofi avisa por privado a la
 * asesora, nadie ve nada en el grupo) y AUTOMÁTICA (el bot publica solo en
 * el grupo gremial, sin que nadie de Diamond lo revise antes).
 *
 * Pedido de Juan (2026-08-18), con los ojos abiertos sobre el riesgo: pasar
 * a "Automático" es exactamente el patrón que costó 656 falsos positivos y
 * contribuyó al baneo de julio — por eso el cambio a automático pide
 * confirmación explícita y el modo NO SE INFIERE, se guarda en base
 * (organizations.grupos_respuesta_modo) para que quede auditable quién lo
 * prendió y cuándo.
 */
export default function ModoRespuestaToggle({
  modo,
  puedeCambiar = true,
}: {
  modo: string;
  puedeCambiar?: boolean;
}) {
  const router = useRouter();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cambiarA(siguiente: "asistido" | "auto") {
    if (siguiente === modo || guardando) return;
    if (
      siguiente === "auto" &&
      !confirm(
        "¿Encender respuestas AUTOMÁTICAS en los grupos?\n\n" +
          "El bot va a publicar directo en el grupo gremial (hasta 80 competidores viéndolo), sin que nadie de Diamond lo revise antes. " +
          "Esto es exactamente lo que causó falsos positivos y contribuyó al baneo de julio.\n\n" +
          "¿Confirmás que querés encenderlo?"
      )
    ) {
      return;
    }
    setGuardando(true);
    setError(null);
    const res = await fetch("/api/grupos/respuesta-modo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modo: siguiente }),
    });
    setGuardando(false);
    if (res.ok) {
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "No se pudo cambiar");
    }
  }

  const esAuto = modo === "auto";

  return (
    <div className={`mb-6 rounded-lg border p-4 ${esAuto ? "border-red-300 bg-red-50" : "border-slate-200 bg-slate-50"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${esAuto ? "bg-red-500" : "bg-slate-400"}`} />
            <h2 className="text-sm font-semibold text-slate-900">
              Respuestas en el grupo: {ETIQUETA[modo] || modo}
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            {esAuto
              ? "El bot publica solo en el grupo gremial — nadie de Diamond lo revisa antes."
              : "Sofi revalida cada pedido y avisa por privado a la asesora. Nada se publica en el grupo."}
          </p>
        </div>

        {puedeCambiar && (
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => cambiarA("asistido")}
              disabled={guardando || modo === "asistido"}
              aria-pressed={modo === "asistido"}
              className={`rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50 ${
                modo === "asistido" ? "bg-slate-700 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              Manual
            </button>
            <button
              onClick={() => cambiarA("auto")}
              disabled={guardando || modo === "auto"}
              aria-pressed={modo === "auto"}
              className={`rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50 ${
                modo === "auto" ? "bg-red-600 text-white" : "border border-red-300 bg-white text-red-700 hover:bg-red-50"
              }`}
            >
              {guardando ? "Guardando…" : "Automático"}
            </button>
          </div>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
