"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { SocialConnectionRow } from "@/lib/marketing";

interface AccountSummary {
  platform: "facebook" | "instagram";
  externalAccountId: string;
  externalAccountName: string;
  linkedPageId?: string;
}

const STATUS_LABELS: Record<string, string> = {
  connected: "Conectada",
  expired: "Token vencido",
  error: "Error",
  revoked: "Revocada",
};

const STATUS_COLORS: Record<string, string> = {
  connected: "bg-emerald-100 text-emerald-700",
  expired: "bg-amber-100 text-amber-700",
  error: "bg-red-100 text-red-700",
  revoked: "bg-slate-100 text-slate-500",
};

export default function MetaConnect({ orgId, connections }: { orgId: string; connections: SocialConnectionRow[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const connectResult = searchParams.get("connect");
  const connectReason = searchParams.get("reason");

  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(
    connectResult === "ok"
      ? "Conexión con Meta exitosa. Elegí qué cuentas usar."
      : connectResult === "error"
        ? `No se pudo completar la conexión con Meta.${connectReason ? ` Detalle: ${connectReason}` : ""}`
        : null
  );

  useEffect(() => {
    if (connectResult === "ok") {
      void loadAccounts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectResult]);

  async function loadAccounts() {
    setLoading(true);
    try {
      const res = await fetch(`/api/marketing/meta/accounts?orgId=${orgId}`);
      const body = await res.json().catch(() => ({}));
      if (res.ok) setAccounts(body.accounts || []);
      else setMessage(body.error || "No se pudieron cargar las cuentas");
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect() {
    setLoading(true);
    setMessage(null);
    const returnUrl = `${window.location.origin}/marketing/configuracion`;
    const res = await fetch("/api/marketing/meta/oauth-start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, returnUrl }),
    });
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (res.ok && body.url) {
      window.location.href = body.url;
    } else {
      setMessage(body.error || "No se pudo iniciar la conexión");
    }
  }

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleSaveSelection() {
    if (!accounts || selected.length === 0) return;
    setLoading(true);
    const selections = accounts
      .filter((a) => selected.includes(a.externalAccountId))
      .map((a) => ({ platform: a.platform, externalAccountId: a.externalAccountId }));
    const res = await fetch("/api/marketing/meta/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, selections }),
    });
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (res.ok) {
      setMessage("Cuentas conectadas correctamente");
      setAccounts(null);
      router.refresh();
    } else {
      setMessage(body.error || "No se pudo guardar la selección");
    }
  }

  async function handleValidate(id: string) {
    setLoading(true);
    await fetch(`/api/marketing/connections/${id}/validate`, { method: "POST" }).catch(() => null);
    setLoading(false);
    router.refresh();
  }

  async function handleDisconnect(id: string) {
    setLoading(true);
    await fetch(`/api/marketing/connections/${id}`, { method: "DELETE" });
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">Conexión con Meta</h2>
            <p className="text-sm text-slate-500">
              Reutiliza la misma Meta App que ya usa WhatsApp/Sofi — no se crea ninguna app nueva.
            </p>
          </div>
          <button
            onClick={handleConnect}
            disabled={loading}
            className="rounded-lg bg-[#0b1526] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#0b1526]/90 disabled:opacity-50"
          >
            Conectar Meta
          </button>
        </div>
        {message && <p className="mt-3 text-sm text-slate-600">{message}</p>}
      </section>

      {accounts && accounts.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="mb-2 font-semibold text-slate-900">Elegí qué cuentas usar</h3>
          <div className="space-y-2">
            {accounts.map((a) => (
              <label key={a.externalAccountId} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <input type="checkbox" checked={selected.includes(a.externalAccountId)} onChange={() => toggle(a.externalAccountId)} />
                {a.platform === "facebook" ? "📘" : "📸"} {a.externalAccountName}
              </label>
            ))}
          </div>
          <button
            onClick={handleSaveSelection}
            disabled={loading || selected.length === 0}
            className="mt-3 rounded-lg bg-[#c9a24b] px-4 py-2 text-sm font-medium text-[#0b1526] transition hover:bg-[#c9a24b]/90 disabled:opacity-50"
          >
            Guardar selección
          </button>
        </section>
      )}

      <section>
        <h3 className="mb-2 font-semibold text-slate-900">Cuentas conectadas</h3>
        {connections.length === 0 ? (
          <p className="text-sm text-slate-500">Ninguna cuenta conectada todavía.</p>
        ) : (
          <ul className="space-y-2">
            {connections.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
                <div>
                  <p className="font-medium text-slate-900">
                    {c.platform === "facebook" ? "📘" : "📸"} {c.external_account_name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {c.last_validated_at ? `Validada ${new Date(c.last_validated_at).toLocaleString("es-CO")}` : "Sin validar"}
                    {c.last_error ? ` · ${c.last_error}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[c.status]}`}>{STATUS_LABELS[c.status]}</span>
                  <button onClick={() => handleValidate(c.id)} disabled={loading} className="text-xs text-slate-500 hover:text-[#c9a24b]">
                    Validar
                  </button>
                  <button onClick={() => handleDisconnect(c.id)} disabled={loading} className="text-xs text-red-500 hover:text-red-700">
                    Desconectar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
