"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ESTADO_COLORS, ESTADO_LABELS, ESTADO_DOT, relativeTime, absoluteDateTime, type Conversation } from "@/lib/types";
import type { TeamMember } from "@/lib/team";
import Avatar from "./avatar";
import ScoreBadge from "./score-badge";
import OwnerBadge from "./owner-badge";
import LeadDeleteButton from "./lead-delete-button";

export default function InboxList({
  conversations,
  admin,
  roster,
  currentUserId,
}: {
  conversations: Conversation[];
  admin: boolean;
  roster: Record<string, TeamMember>;
  currentUserId: string;
}) {
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("inbox-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "conversations" }, () => {
        setToast("🔔 Nuevo lead recibido");
        router.refresh();
        setTimeout(() => setToast(null), 4000);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversations" }, () => {
        router.refresh();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [router]);

  return (
    <>
      {toast && (
        <div className="fixed right-6 top-20 z-50 animate-[slideIn_0.3s_ease-out] rounded-xl bg-[#0b1526] px-4 py-3 text-sm font-medium text-white shadow-xl ring-1 ring-[#c9a24b]/40">
          {toast}
        </div>
      )}
      {conversations.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-3xl">📭</p>
          <p className="mt-2 text-sm text-slate-500">
            Sin conversaciones todavía. Cuando un cliente le escriba a Sofi, aparecerá aquí.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {conversations.map((c) => (
            <li key={c.id} className="group flex flex-wrap items-center gap-2">
              <Link
                href={`/inbox/${c.id}`}
                className="flex min-w-[16rem] flex-1 items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#c9a24b]/50 hover:shadow-md"
              >
                <Avatar name={c.leads?.nombre} phone={c.leads?.phone || ""} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${ESTADO_DOT[c.leads?.estado] || "bg-slate-300"}`} />
                    <p className="truncate font-semibold text-slate-900">
                      {c.leads?.nombre || `+${c.leads?.phone}`}
                    </p>
                    {c.leads?.ad_referral && (
                      <span
                        title={c.leads.ad_referral.headline ? `Anuncio: ${c.leads.ad_referral.headline}` : "Llegó de un anuncio de Meta Ads"}
                        className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700"
                      >
                        📢 Ads
                      </span>
                    )}
                    {c.modo === "humano" && (
                      <span className="shrink-0 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700">
                        asesor al mando
                      </span>
                    )}
                  </div>
                  <p className="truncate text-sm text-slate-500">
                    {c.leads?.property_ref_origen ? `Propiedad ${c.leads.property_ref_origen} · ` : ""}
                    {c.leads?.forma_pago || c.leads?.tipo_interes || "sin datos aún"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span className="text-xs text-slate-400" title={absoluteDateTime(c.last_activity_at)}>
                    {relativeTime(c.last_activity_at)}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ESTADO_COLORS[c.leads?.estado] || "bg-slate-100"}`}>
                      {ESTADO_LABELS[c.leads?.estado] || c.leads?.estado}
                    </span>
                    <ScoreBadge score={c.leads?.score ?? 0} />
                  </div>
                </div>
              </Link>
              {c.leads?.id && (
                <OwnerBadge
                  leadId={c.leads.id}
                  ownerId={c.leads.owner_id}
                  ownerAssignedAt={c.leads.owner_assigned_at}
                  roster={roster}
                  currentUserId={currentUserId}
                  admin={admin}
                />
              )}
              {admin && c.leads?.id && (
                <div className="transition lg:opacity-0 lg:group-hover:opacity-100">
                  <LeadDeleteButton leadId={c.leads.id} nombre={c.leads.nombre || `+${c.leads.phone}`} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
