"use client";

// Campana de notificaciones del asesor (App de asesores F1, 2026-10-07).
// Lee `notificaciones` (RLS: solo las suyas), escucha los INSERT en vivo y,
// al abrirla, marca todo como leido. Las escribe el bot
// (src/notifications/notificar.js): cita por confirmar, cita que le llego o
// se le fue por la rotacion, cita confirmada o cancelada, pedido de asesor.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Notificacion = {
  id: string;
  tipo: string;
  titulo: string;
  cuerpo: string | null;
  link: string | null;
  leida_at: string | null;
  created_at: string;
};

const ICONO: Record<string, string> = {
  cita_por_confirmar: "📅",
  cita_reasignada: "↪️",
  cita_confirmada: "✅",
  cita_cancelada: "❌",
  asesor_solicitado: "🙋",
};

function hace(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
}

export default function Campana({ advisorId }: { advisorId: string }) {
  const [items, setItems] = useState<Notificacion[]>([]);
  const [abierta, setAbierta] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("notificaciones")
      .select("id, tipo, titulo, cuerpo, link, leida_at, created_at")
      .eq("advisor_id", advisorId)
      .order("created_at", { ascending: false })
      .limit(20);
    setItems((data as Notificacion[]) || []);
  }, [advisorId]);

  useEffect(() => {
    cargar();
    const supabase = createClient();
    const channel = supabase
      .channel(`campana-${advisorId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notificaciones", filter: `advisor_id=eq.${advisorId}` },
        (payload) => setItems((prev) => [payload.new as Notificacion, ...prev].slice(0, 20))
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [advisorId, cargar]);

  useEffect(() => {
    if (!abierta) return;
    const cerrar = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierta(false);
    };
    document.addEventListener("mousedown", cerrar);
    return () => document.removeEventListener("mousedown", cerrar);
  }, [abierta]);

  const noLeidas = items.filter((n) => !n.leida_at).length;

  async function abrir() {
    const siguiente = !abierta;
    setAbierta(siguiente);
    if (siguiente && noLeidas > 0) {
      const ahora = new Date().toISOString();
      setItems((prev) => prev.map((n) => (n.leida_at ? n : { ...n, leida_at: ahora })));
      const supabase = createClient();
      await supabase.from("notificaciones").update({ leida_at: ahora }).eq("advisor_id", advisorId).is("leida_at", null);
    }
  }

  return (
    <div className="relative" ref={caja}>
      <button
        type="button"
        onClick={abrir}
        className="relative rounded-full p-2 text-slate-300 transition hover:bg-white/5 hover:text-[#c9a24b]"
        title="Tus notificaciones"
        aria-label={`Notificaciones${noLeidas ? `: ${noLeidas} sin leer` : ""}`}
      >
        <span className="text-lg">🔔</span>
        {noLeidas > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {noLeidas}
          </span>
        )}
      </button>
      {abierta && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-800 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <span className="text-sm font-semibold">Notificaciones</span>
            <Link href="/pendientes" className="text-xs text-[#a8862f] hover:underline" onClick={() => setAbierta(false)}>
              Ver pendientes
            </Link>
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">No tenés notificaciones.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <Link
                    href={n.link || "/pendientes"}
                    onClick={() => setAbierta(false)}
                    className={`flex gap-3 px-4 py-3 text-sm hover:bg-slate-50 ${n.leida_at ? "" : "bg-amber-50/60"}`}
                  >
                    <span className="text-base">{ICONO[n.tipo] || "🔔"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{n.titulo}</span>
                      {n.cuerpo && <span className="block truncate text-slate-500">{n.cuerpo}</span>}
                      <span className="block text-xs text-slate-400">{hace(n.created_at)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
