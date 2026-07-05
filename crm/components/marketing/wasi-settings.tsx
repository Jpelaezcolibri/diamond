"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface SettingsResponse {
  sync_source: "wasi_api" | "wasi_public";
  sync_interval_minutes: number;
  hasWasiCredentials: boolean;
}

export default function WasiSettings({ orgId, settings }: { orgId: string; settings: SettingsResponse | null }) {
  const router = useRouter();
  const [syncSource, setSyncSource] = useState(settings?.sync_source ?? "wasi_public");
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState(settings?.sync_interval_minutes ?? 60);
  const [wasiIdCompany, setWasiIdCompany] = useState("");
  const [wasiToken, setWasiToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSave() {
    setLoading(true);
    setMessage(null);
    const res = await fetch("/api/marketing/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId,
        syncSource,
        syncIntervalMinutes,
        ...(wasiIdCompany ? { wasiIdCompany } : {}),
        ...(wasiToken ? { wasiToken } : {}),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (res.ok) {
      setMessage("Configuración guardada");
      setWasiIdCompany("");
      setWasiToken("");
      router.refresh();
    } else {
      setMessage(body.error || "No se pudo guardar");
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold text-slate-900">Sincronización con Wasi</h2>
      <p className="mt-1 text-sm text-slate-500">
        {settings?.hasWasiCredentials
          ? "Ya hay credenciales de la API oficial guardadas (cifradas)."
          : "Sin credenciales de la API oficial todavía — se usa el scraper de páginas públicas."}
      </p>

      {message && <p className="mt-2 text-sm text-emerald-700">{message}</p>}

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fuente de sincronización</label>
          <select
            value={syncSource}
            onChange={(e) => setSyncSource(e.target.value as "wasi_api" | "wasi_public")}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="wasi_public">Páginas públicas (scraper)</option>
            <option value="wasi_api">API oficial de Wasi</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cada cuántos minutos</label>
          <input
            type="number"
            value={syncIntervalMinutes}
            onChange={(e) => setSyncIntervalMinutes(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">id_company (Wasi)</label>
          <input
            value={wasiIdCompany}
            onChange={(e) => setWasiIdCompany(e.target.value)}
            placeholder={settings?.hasWasiCredentials ? "•••• (dejar vacío para no cambiar)" : "Ej: 12212160"}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">wasi_token</label>
          <input
            type="password"
            value={wasiToken}
            onChange={(e) => setWasiToken(e.target.value)}
            placeholder={settings?.hasWasiCredentials ? "•••• (dejar vacío para no cambiar)" : "Token de api.wasi.co"}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={loading}
        className="mt-4 rounded-lg bg-[#0b1526] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#0b1526]/90 disabled:opacity-50"
      >
        {loading ? "Guardando…" : "Guardar configuración"}
      </button>
    </section>
  );
}
