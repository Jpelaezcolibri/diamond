"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { PublicationEventRow } from "@/lib/marketing";

type EventWithPublication = PublicationEventRow & {
  publications: { titulo_comercial: string | null; properties: { ref: string } | null } | null;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Generado",
  approved: "Aprobado",
  scheduled: "Programado",
  publishing: "Publicando",
  published: "Publicado",
  partially_published: "Publicado parcial",
  failed: "Error",
  archived: "Archivado",
};

export default function ColaList({ orgId, initialEvents }: { orgId: string; initialEvents: EventWithPublication[] }) {
  const [events, setEvents] = useState(initialEvents);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("marketing-cola")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "publication_events", filter: `org_id=eq.${orgId}` },
        (payload) => {
          setEvents((prev) => [{ ...(payload.new as PublicationEventRow), publications: null }, ...prev].slice(0, 50));
          setLive(true);
          setTimeout(() => setLive(false), 2000);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
        <span className={`h-2 w-2 rounded-full ${live ? "animate-pulse bg-emerald-500" : "bg-slate-300"}`} />
        {live ? "Actualizando en vivo…" : "En vivo"}
      </div>
      {events.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          Todavía no hay actividad en la cola.
        </p>
      ) : (
        <ul className="space-y-2">
          {events.map((e) => (
            <li key={e.id} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
              <div>
                <Link href={`/marketing/publicaciones/${e.publication_id}`} className="font-medium text-slate-900 hover:text-[#c9a24b]">
                  {e.publications?.titulo_comercial || e.publications?.properties?.ref || e.publication_id.slice(0, 8)}
                </Link>
                <p className="text-xs text-slate-500">{e.actor}</p>
              </div>
              <div className="text-right text-xs text-slate-500">
                <p>
                  {STATUS_LABELS[e.from_status || ""] || e.from_status || "—"} → <span className="font-medium text-slate-800">{STATUS_LABELS[e.to_status || ""] || e.to_status}</span>
                </p>
                <p>{new Date(e.created_at).toLocaleString("es-CO")}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
