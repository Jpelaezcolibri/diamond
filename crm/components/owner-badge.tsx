"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { relativeTime } from "@/lib/types";
import type { TeamMember } from "@/lib/team";

const OWNER_IDLE_MS = 2 * 60 * 60 * 1000; // 2h con el mismo asesor sin resolver: se marca para el admin

export default function OwnerBadge({
  leadId,
  ownerId,
  ownerAssignedAt,
  roster,
  currentUserId,
  admin,
}: {
  leadId: string;
  ownerId: string | null;
  ownerAssignedAt: string | null;
  roster: Record<string, TeamMember>;
  currentUserId: string;
  admin: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [reassigning, setReassigning] = useState(false);

  async function claim() {
    setBusy(true);
    const res = await fetch("/api/leads/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId }),
    });
    if (res.ok) router.refresh();
    else {
      const body = await res.json().catch(() => ({}));
      alert(body.error || "No se pudo atender el lead");
    }
    setBusy(false);
  }

  async function reassign(newOwnerId: string) {
    setBusy(true);
    setReassigning(false);
    const res = await fetch("/api/leads/reassign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId, ownerId: newOwnerId === "__release__" ? null : newOwnerId }),
    });
    if (res.ok) router.refresh();
    else {
      const body = await res.json().catch(() => ({}));
      alert(body.error || "No se pudo reasignar");
    }
    setBusy(false);
  }

  const idle = ownerAssignedAt ? Date.now() - new Date(ownerAssignedAt).getTime() > OWNER_IDLE_MS : false;

  if (!ownerId) {
    return (
      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <span className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[11px] text-slate-400">
          Sin asignar
        </span>
        <button
          onClick={claim}
          disabled={busy}
          className="rounded-full bg-[#0b1526] px-2 py-0.5 text-[11px] font-medium text-[#c9a24b] hover:opacity-80 disabled:opacity-40"
        >
          Atender
        </button>
      </div>
    );
  }

  const owner = roster[ownerId];
  const mine = ownerId === currentUserId;

  return (
    <div className="relative flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <span
        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
          mine ? "bg-[#c9a24b]/20 text-[#8a6a1f]" : idle ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"
        }`}
        title={ownerAssignedAt ? `Asignado ${relativeTime(ownerAssignedAt)}` : undefined}
      >
        {mine ? "Tú" : owner?.nombre || "Asesor"}
        {ownerAssignedAt && ` · ${relativeTime(ownerAssignedAt)}`}
      </span>
      {admin && (
        <button
          onClick={() => setReassigning((v) => !v)}
          disabled={busy}
          title="Reasignar (admin)"
          className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          🔓
        </button>
      )}
      {reassigning && (
        <select
          autoFocus
          defaultValue=""
          onChange={(e) => reassign(e.target.value)}
          onBlur={() => setReassigning(false)}
          className="absolute left-0 top-6 z-10 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs shadow-lg outline-none"
        >
          <option value="" disabled>
            Reasignar a...
          </option>
          {Object.values(roster).map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre} ({m.roleLabel})
            </option>
          ))}
          <option value="__release__">Liberar (sin asignar)</option>
        </select>
      )}
    </div>
  );
}
