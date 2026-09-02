"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Mismo mecanismo que InboxList (Supabase Realtime + router.refresh()) --
// Juan, 2026-09-02: "que muestre en vivo el dashboard lo que va pasando en
// el motor de busqueda". router.refresh() vuelve a correr todo el server
// component (la pagina ya es force-dynamic), asi que el dashboard, la
// tabla de mensajes por asesora, y las dos tablas de entrada/salida se
// actualizan solas -- no hace falta logica de "en vivo" separada en cada una.
export default function GruposLiveWatcher() {
  const router = useRouter();
  const [estado, setEstado] = useState<"conectando" | "en_vivo" | "reconectando">("conectando");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refrescarPendiente = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();

    // Un solo timer de toast: dos eventos seguidos (frecuente en una racha
    // de importación) antes no compartían timer, así que el primer setTimeout
    // apagaba el toast del SEGUNDO evento antes de sus 4s reales.
    function mostrarToast(msg: string) {
      if (toastTimeout.current) clearTimeout(toastTimeout.current);
      setToast(msg);
      toastTimeout.current = setTimeout(() => setToast(null), 4000);
    }

    // router.refresh() re-corre toda la página server (una docena de viajes
    // a la base, y para admin una llamada HTTP al bot en Railway). Un INSERT
    // por evento sin coalescer significa un refresh completo por fila, y
    // esta misma tabla ya tuvo ráfagas de ~300 señales en una hora y veinte
    // (ver comentario en page.tsx). Se agrupa cualquier ráfaga detrás de un
    // solo refresh cada 3s en vez de uno por evento.
    function refrescarConDebounce() {
      if (refrescarPendiente.current) return; // ya hay uno programado, no apilar mas
      refrescarPendiente.current = setTimeout(() => {
        refrescarPendiente.current = null;
        router.refresh();
      }, 3000);
    }

    const channel = supabase
      .channel("grupos-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "group_signals" }, () => {
        mostrarToast("🔔 Nuevo pedido de un colega");
        refrescarConDebounce();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mandato_match_alerts" }, () => {
        mostrarToast("🔔 Nueva propiedad con match");
        refrescarConDebounce();
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setEstado("en_vivo");
        else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setEstado("reconectando");
        }
      });
    return () => {
      supabase.removeChannel(channel);
      if (toastTimeout.current) clearTimeout(toastTimeout.current);
      if (refrescarPendiente.current) clearTimeout(refrescarPendiente.current);
    };
  }, [router]);

  return (
    <>
      <span
        className={`inline-flex items-center gap-1.5 text-xs font-medium ${
          estado === "en_vivo" ? "text-emerald-600" : "text-amber-600"
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${estado === "en_vivo" ? "bg-emerald-500" : "bg-amber-500"}`} />
        {estado === "en_vivo" ? "en vivo" : estado === "reconectando" ? "reconectando…" : "conectando…"}
      </span>
      {toast && (
        <div className="fixed right-6 top-20 z-50 rounded-xl bg-[#0b1526] px-4 py-3 text-sm font-medium text-white shadow-xl ring-1 ring-[#c9a24b]/40">
          {toast}
        </div>
      )}
    </>
  );
}
