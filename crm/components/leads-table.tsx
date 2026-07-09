"use client";

import { useMemo, useState } from "react";
import { CATEGORIAS, ESTADO_COLORS, ESTADO_LABELS, type Lead } from "@/lib/types";
import type { TeamMember } from "@/lib/team";
import Avatar from "./avatar";
import ScoreBadge from "./score-badge";
import OwnerBadge from "./owner-badge";
import LeadDeleteButton from "./lead-delete-button";

export default function LeadsTable({
  leads,
  admin,
  roster,
  currentUserId,
}: {
  leads: Lead[];
  admin: boolean;
  roster: Record<string, TeamMember>;
  currentUserId: string;
}) {
  const [q, setQ] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);
  const [onlyAds, setOnlyAds] = useState(false);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return leads
      .filter((l) => !onlyMine || l.owner_id === currentUserId)
      .filter((l) => !onlyAds || l.ad_referral)
      .filter((l) => {
        if (!term) return true;
        return [l.nombre, l.phone, l.property_ref_origen, l.forma_pago, l.urgencia]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(term));
      });
  }, [leads, q, onlyMine, onlyAds, currentUserId]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre, teléfono, propiedad..."
          className="w-full max-w-sm rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none focus:border-[#c9a24b]"
        />
        <button
          onClick={() => setOnlyMine((v) => !v)}
          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
            onlyMine ? "border-[#c9a24b] bg-[#c9a24b]/10 text-[#8a6a1f]" : "border-slate-200 text-slate-500 hover:bg-slate-50"
          }`}
        >
          Mis leads
        </button>
        <button
          onClick={() => setOnlyAds((v) => !v)}
          title="Leads que llegaron de un anuncio de clic-a-WhatsApp (Meta Ads)"
          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
            onlyAds ? "border-blue-400 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"
          }`}
        >
          📢 Solo Meta Ads
        </button>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Tablero</th>
              <th className="px-4 py-3">Propiedad</th>
              <th className="px-4 py-3">Asesor</th>
              {admin && <th className="px-4 py-3"></th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((l) => (
              <tr key={l.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={l.nombre} phone={l.phone} size={30} />
                    <div>
                      <p className="font-semibold text-slate-900">
                        {l.nombre || "Sin nombre"}
                        {l.ad_referral && (
                          <span
                            title={l.ad_referral.headline ? `Anuncio: ${l.ad_referral.headline}` : "Llegó de un anuncio de Meta Ads"}
                            className="ml-1.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700"
                          >
                            📢 Ads
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-400">+{l.phone}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <ScoreBadge score={l.score} />
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_COLORS[l.estado] || "bg-slate-100"}`}>
                    {ESTADO_LABELS[l.estado] || l.estado}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {CATEGORIAS.find((c) => c.key === (l.categoria || "otros"))?.label || l.categoria}
                </td>
                <td className="px-4 py-3 text-slate-600">{l.property_ref_origen || "—"}</td>
                <td className="px-4 py-3">
                  <OwnerBadge
                    leadId={l.id}
                    ownerId={l.owner_id}
                    ownerAssignedAt={l.owner_assigned_at}
                    roster={roster}
                    currentUserId={currentUserId}
                    admin={admin}
                  />
                </td>
                {admin && (
                  <td className="px-4 py-3 text-right">
                    <LeadDeleteButton leadId={l.id} nombre={l.nombre || `+${l.phone}`} />
                  </td>
                )}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={admin ? 7 : 6} className="px-4 py-10 text-center text-slate-400">
                  {leads.length === 0 ? "Sin leads todavía." : "Sin resultados para esa búsqueda."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
