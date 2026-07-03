"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LeadDeleteButton({ leadId, nombre }: { leadId: string; nombre: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!confirm(`¿Borrar el lead "${nombre}" con toda su conversación? Esta acción no se puede deshacer.`)) return;
    setBusy(true);
    const res = await fetch("/api/leads/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId }),
    });
    if (res.ok) {
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      alert(body.error || "No se pudo borrar");
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={busy}
      title="Borrar lead (super admin)"
      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
    >
      🗑
    </button>
  );
}
