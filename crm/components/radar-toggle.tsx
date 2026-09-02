"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * El interruptor del motor.
 *
 * Radar cuesta plata cada vez que corre: clasificar un export son llamadas a
 * la IA, y cada digest es una plantilla de WhatsApp cobrada por envío. Este
 * botón es la forma de parar el gasto sin tocar el servidor ni esperar un
 * redespliegue.
 *
 * Lo que apaga es lo que se cobra. Lo ya detectado se sigue viendo y se sigue
 * pudiendo gestionar: apagar el motor no puede hacerle perder al asesor una
 * oportunidad que ya venía trabajando.
 */
export default function RadarToggle({
  activo,
  puedeCambiar = true,
  compacto = false,
}: {
  activo: boolean;
  /** Solo un admin lo prende o apaga: deja sin digest a todo el equipo. Un
   *  asesor igual ve el estado, porque explica por qué su carga no procesa. */
  puedeCambiar?: boolean;
  /** Versión chip para la cabecera de /grupos (rediseño 2026-09-02): mismo
   *  estado, misma acción y misma confirmación, en una sola línea. */
  compacto?: boolean;
}) {
  const router = useRouter();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function alternar() {
    const siguiente = !activo;
    // Apagarlo deja a todo el equipo sin digest — vale una confirmación.
    if (!siguiente && !confirm("¿Apagar el motor de Radar?\n\nNo se procesarán exports nuevos ni saldrá el digest de la mañana. Lo ya detectado se sigue viendo.")) {
      return;
    }
    setGuardando(true);
    setError(null);
    const res = await fetch("/api/grupos/radar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: siguiente }),
    });
    setGuardando(false);
    if (res.ok) {
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "No se pudo cambiar");
    }
  }

  if (compacto) {
    return (
      <span
        className={`inline-flex items-center gap-2 rounded-full border bg-white py-1 pl-3 pr-1 text-xs font-semibold ${
          activo ? "border-emerald-200 text-emerald-800" : "border-amber-300 text-amber-800"
        }`}
        title={
          activo
            ? "Los exports que subas se procesan y el digest sale a las 7am."
            : "No se procesa ningún export ni sale el digest — no se gasta nada. Lo ya detectado se sigue viendo."
        }
      >
        <span className={`inline-block h-2 w-2 rounded-full ${activo ? "bg-emerald-500" : "bg-amber-500"}`} />
        Radar {activo ? "encendido" : "apagado"}
        {puedeCambiar ? (
          <button
            onClick={alternar}
            disabled={guardando}
            aria-pressed={activo}
            className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
          >
            {guardando ? "…" : activo ? "Apagar" : "Encender"}
          </button>
        ) : (
          <span className="pr-2" />
        )}
        {error && <span className="pr-2 text-red-700">{error}</span>}
      </span>
    );
  }

  return (
    <div className={`mb-6 rounded-lg border p-4 ${activo ? "border-emerald-200 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${activo ? "bg-emerald-500" : "bg-amber-500"}`} />
            <h2 className="text-sm font-semibold text-slate-900">
              Motor de Radar {activo ? "encendido" : "apagado"}
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            {activo
              ? "Los exports que subas se procesan y el digest sale a las 7am."
              : "No se procesa ningún export ni sale el digest — no se gasta nada. Lo ya detectado se sigue viendo y gestionando."}
          </p>
        </div>

        {puedeCambiar && (
          <button
            onClick={alternar}
            disabled={guardando}
            aria-pressed={activo}
            className={`shrink-0 rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
              activo ? "bg-slate-700 hover:bg-slate-800" : "bg-emerald-600 hover:bg-emerald-700"
            }`}
          >
            {guardando ? "Guardando…" : activo ? "Apagar" : "Encender"}
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
