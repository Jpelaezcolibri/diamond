"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("grupos-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "group_signals" }, () => {
        setToast("🔔 Nuevo pedido de un colega");
        router.refresh();
        setTimeout(() => setToast(null), 4000);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mandato_match_alerts" }, () => {
        setToast("🔔 Nueva propiedad con match");
        router.refresh();
        setTimeout(() => setToast(null), 4000);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setEstado("en_vivo");
        else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setEstado("reconectando");
        }
      });
    return () => {
      supabase.removeChannel(channel);
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
