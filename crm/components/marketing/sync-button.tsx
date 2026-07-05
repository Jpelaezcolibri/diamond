"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SyncButton({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/marketing/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "No se pudo sincronizar");
      } else {
        router.refresh();
      }
    } catch {
      setError("No se pudo conectar con DMAP");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <button
        onClick={handleClick}
        disabled={loading}
        className="rounded-lg bg-[#0b1526] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#0b1526]/90 disabled:opacity-50"
      >
        {loading ? "Sincronizando…" : "Sincronizar ahora"}
      </button>
    </div>
  );
}
