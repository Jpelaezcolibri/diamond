"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * El interruptor del carril de COMPRA.
 *
 * Juan, 2026-09-02: "quiero tener la posibilidad de desactivar los mandatos,
 * esto con el fin de poder enfocar todas las fuerzas en las propiedades que
 * tenemos para la venta".
 *
 * El radar tiene dos carriles y los dos le escriben a la misma asesora:
 *
 *   VENTA   un colega pide algo -> le ofrecemos nuestro inventario.
 *   COMPRA  un colega ofrece algo -> se lo pasamos a un mandato nuestro.
 *
 * Apagar compra no borra nada. Los mandatos siguen guardados y lo ya cruzado
 * se sigue viendo y gestionando: apagar un carril nunca puede hacerle perder
 * al asesor una oportunidad que ya venia trabajando. Lo unico que se detiene
 * es el cruce de ofertas NUEVAS, y con el los avisos que salen de ahi.
 */
export default function MandatosToggle({
  activo,
  cuantos = 0,
  puedeCambiar = true,
}: {
  activo: boolean;
  /** Cuantos mandatos hay activos hoy — para que apagar no sea a ciegas. */
  cuantos?: number;
  /** Solo un admin: es una decision de foco comercial, no de operacion. */
  puedeCambiar?: boolean;
}) {
  const router = useRouter();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function alternar() {
    const siguiente = !activo;
    if (
      !siguiente &&
      !confirm(
        `¿Apagar el carril de compra?\n\nLas ofertas que publiquen los colegas dejan de cruzarse contra ${
          cuantos === 1 ? "tu mandato" : `tus ${cuantos} mandatos`
        } y no salen esos avisos.\n\nNo se borra nada: los mandatos quedan guardados y lo ya cruzado se sigue viendo. Podés volver a prenderlo cuando quieras.`
      )
    ) {
      return;
    }
    setGuardando(true);
    setError(null);
    const res = await fetch("/api/grupos/mandatos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: siguiente }),
    });
    setGuardando(false);
    if (res.ok) router.refresh();
    else {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "No se pudo cambiar");
    }
  }

  const chip = (
    <span
      className={`inline-flex items-center gap-2 rounded-full border bg-white py-1 pl-3 pr-1 text-xs font-semibold ${
        activo ? "border-sky-200 text-sky-800" : "border-slate-300 text-slate-500"
      }`}
      title={
        activo
          ? "Las ofertas de los colegas se cruzan contra tus mandatos de compra."
          : "El carril de compra está apagado: toda la atención va a vender lo propio. Los mandatos quedan guardados."
      }
    >
      <span className={`inline-block h-2 w-2 rounded-full ${activo ? "bg-sky-500" : "bg-slate-400"}`} />
      Compra {activo ? "encendida" : "apagada"}
      {puedeCambiar && (
        <button
          onClick={alternar}
          disabled={guardando}
          className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-slate-600 underline underline-offset-2 hover:text-slate-900 disabled:opacity-50"
        >
          {guardando ? "..." : activo ? "apagar" : "prender"}
        </button>
      )}
    </span>
  );

  if (!error) return chip;
  return (
    <span className="inline-flex items-center gap-2">
      {chip}
      <span className="text-xs text-red-600">{error}</span>
    </span>
  );
}
