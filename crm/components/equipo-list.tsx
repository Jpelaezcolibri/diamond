"use client";

// Lista de conversaciones entre Sofi y el EQUIPO (avisos del radar, reenvíos
// de Sofi-Comando, recordatorios) — no clientes. Deliberadamente más simple
// que InboxList: nada de score, estado de embudo, dueño de lead ni botón de
// borrar — esos conceptos son de un lead de venta, no de una compañera de
// trabajo.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { relativeTime, absoluteDateTime, type Conversation } from "@/lib/types";
import Avatar from "./avatar";

export default function EquipoList({
  conversations,
  nombrePorTelefono,
}: {
  conversations: Conversation[];
  nombrePorTelefono: Record<string, string>;
}) {
  const router = useRouter();

  // Mismo patron de Realtime que InboxList: si Sofi le manda algo nuevo a
  // alguien del equipo mientras la pantalla esta abierta, se refresca sola.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("equipo-live")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversations" }, () => {
        router.refresh();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [router]);

  if (conversations.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
        <p className="text-3xl">👥</p>
        <p className="mt-2 text-sm text-slate-500">
          Sin conversaciones todavía. Cuando Sofi le mande algo a alguien del equipo (radar, Comando, recordatorios), aparece acá.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {conversations.map((c) => {
        const nombre = nombrePorTelefono[c.leads?.phone || ""] || c.leads?.nombre;
        return (
          <li key={c.id}>
            <Link
              href={`/equipo/${c.id}`}
              className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#c9a24b]/50 hover:shadow-md"
            >
              <Avatar name={nombre} phone={c.leads?.phone || ""} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-900">{nombre || `+${c.leads?.phone}`}</p>
                <p className="truncate text-sm text-slate-500">+{c.leads?.phone}</p>
              </div>
              <span className="shrink-0 text-xs text-slate-400" title={absoluteDateTime(c.last_activity_at)}>
                {relativeTime(c.last_activity_at)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
