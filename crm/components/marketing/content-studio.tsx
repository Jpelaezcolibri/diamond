"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  PUBLICATION_STATUS_COLORS,
  PUBLICATION_STATUS_LABELS,
  STYLE_VARIANT_LABELS,
  type PublicationAssetRow,
  type PublicationEventRow,
  type PublicationRow,
  type PublicationTargetRow,
  type SocialConnectionRow,
} from "@/lib/marketing";

const STYLE_VARIANTS = Object.keys(STYLE_VARIANT_LABELS);

type PublicationWithProperty = PublicationRow & {
  properties: { ref: string; titulo: string; zona: string | null; ciudad: string | null; operacion: string | null; precio: string | null; link: string | null } | null;
};

async function postJson(url: string, body?: unknown, method = "POST") {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export default function ContentStudio({
  publication,
  assets,
  events,
  connections,
  targets,
}: {
  publication: PublicationWithProperty;
  assets: PublicationAssetRow[];
  events: PublicationEventRow[];
  connections: SocialConnectionRow[];
  targets: PublicationTargetRow[];
}) {
  const router = useRouter();
  const isDraft = publication.status === "draft";
  const isApproved = publication.status === "approved";
  const canRetry = publication.status === "failed" || publication.status === "partially_published";

  const [copyFacebook, setCopyFacebook] = useState(publication.copy_facebook || "");
  const [copyInstagram, setCopyInstagram] = useState(publication.copy_instagram || "");
  const [tituloComercial, setTituloComercial] = useState(publication.titulo_comercial || "");
  const [hashtags, setHashtags] = useState((publication.hashtags || []).join(" "));
  const [cta, setCta] = useState(publication.cta || "");
  const [styleVariant, setStyleVariant] = useState(publication.style_variant || "lujo");
  const [selectedConnections, setSelectedConnections] = useState<string[]>(connections.map((c) => c.id));
  const [scheduledAt, setScheduledAt] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const cover = assets.find((a) => a.role === "cover");
  const story = assets.find((a) => a.role === "story");

  function toggleConnection(id: string) {
    setSelectedConnections((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  async function handleSave() {
    setBusy("save");
    setMessage(null);
    const { ok, data } = await postJson(
      `/api/marketing/publications/${publication.id}`,
      {
        copyFacebook,
        copyInstagram,
        tituloComercial,
        hashtags: hashtags.split(/\s+/).filter(Boolean),
        cta,
      },
      "PATCH"
    );
    setBusy(null);
    setMessage(ok ? { type: "ok", text: "Cambios guardados" } : { type: "error", text: data.error || "No se pudo guardar" });
    if (ok) router.refresh();
  }

  async function handleRegenerate() {
    setBusy("regenerate");
    setMessage(null);
    const { ok, data } = await postJson(`/api/marketing/publications/${publication.id}/regenerate`, { styleVariant });
    setBusy(null);
    setMessage(ok ? { type: "ok", text: "Copy regenerado" } : { type: "error", text: data.error || data.message || "No se pudo regenerar" });
    if (ok) router.refresh();
  }

  async function handleApprove() {
    setBusy("approve");
    setMessage(null);
    const { ok, data } = await postJson(`/api/marketing/publications/${publication.id}/approve`);
    setBusy(null);
    setMessage(ok ? { type: "ok", text: "Publicación aprobada" } : { type: "error", text: data.message || data.error || "No se pudo aprobar" });
    if (ok) router.refresh();
  }

  async function handlePublishNow() {
    if (selectedConnections.length === 0) {
      setMessage({ type: "error", text: "Elegí al menos una cuenta conectada" });
      return;
    }
    setBusy("publish-now");
    setMessage(null);
    const { ok, data } = await postJson(`/api/marketing/publications/${publication.id}/publish-now`, {
      connectionIds: selectedConnections,
    });
    setBusy(null);
    setMessage(ok ? { type: "ok", text: "Publicando…" } : { type: "error", text: data.message || data.error || "No se pudo publicar" });
    if (ok) router.refresh();
  }

  async function handleSchedule() {
    if (!scheduledAt) {
      setMessage({ type: "error", text: "Elegí una fecha y hora" });
      return;
    }
    if (selectedConnections.length === 0) {
      setMessage({ type: "error", text: "Elegí al menos una cuenta conectada" });
      return;
    }
    setBusy("schedule");
    setMessage(null);
    const { ok, data } = await postJson(`/api/marketing/publications/${publication.id}/schedule`, {
      scheduledAt: new Date(scheduledAt).toISOString(),
      connectionIds: selectedConnections,
    });
    setBusy(null);
    setMessage(ok ? { type: "ok", text: "Publicación programada" } : { type: "error", text: data.message || data.error || "No se pudo programar" });
    if (ok) router.refresh();
  }

  async function handleRetry() {
    setBusy("retry");
    setMessage(null);
    const { ok, data } = await postJson(`/api/marketing/publications/${publication.id}/retry`);
    setBusy(null);
    setMessage(ok ? { type: "ok", text: `Reintentando ${data.retried ?? 0} destino(s)` } : { type: "error", text: data.error || "No se pudo reintentar" });
    if (ok) router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/marketing/publicaciones" className="text-xs text-slate-500 hover:text-[#c9a24b]">
            ← Publicaciones
          </Link>
          <h2 className="mt-1 text-xl font-bold text-slate-900">{publication.properties?.titulo}</h2>
          <p className="text-sm text-slate-500">
            {publication.properties?.ref} · {publication.properties?.zona}, {publication.properties?.ciudad} ·{" "}
            {publication.properties?.operacion} {publication.properties?.precio}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${PUBLICATION_STATUS_COLORS[publication.status]}`}>
          {PUBLICATION_STATUS_LABELS[publication.status]}
        </span>
      </div>

      {message && (
        <div className={`rounded-xl p-3 text-sm ${message.type === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Preview de imagenes */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Creatives</h3>
          {cover?.public_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover.public_url} alt={cover.alt_text || "Portada"} className="w-full rounded-xl border border-slate-200" />
          )}
          {story?.public_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={story.public_url} alt="Historia" className="mx-auto w-1/2 rounded-xl border border-slate-200" />
          )}
          {!cover && !story && <p className="text-sm text-slate-500">Sin creatives renderizados todavía.</p>}
        </div>

        {/* Copy editable */}
        <div className="space-y-4 lg:col-span-2">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Título comercial</label>
            <input
              value={tituloComercial}
              onChange={(e) => setTituloComercial(e.target.value)}
              disabled={!isDraft}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
            />
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Copy Facebook</label>
            <textarea
              value={copyFacebook}
              onChange={(e) => setCopyFacebook(e.target.value)}
              disabled={!isDraft}
              rows={5}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
            />
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Copy Instagram</label>
            <textarea
              value={copyInstagram}
              onChange={(e) => setCopyInstagram(e.target.value)}
              disabled={!isDraft}
              rows={4}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Hashtags</label>
              <input
                value={hashtags}
                onChange={(e) => setHashtags(e.target.value)}
                disabled={!isDraft}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">CTA</label>
              <input
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                disabled={!isDraft}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>
          </div>

          {isDraft && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleSave}
                disabled={busy !== null}
                className="rounded-lg bg-[#0b1526] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#0b1526]/90 disabled:opacity-50"
              >
                {busy === "save" ? "Guardando…" : "Guardar cambios"}
              </button>

              <select value={styleVariant} onChange={(e) => setStyleVariant(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm">
                {STYLE_VARIANTS.map((v) => (
                  <option key={v} value={v}>
                    {STYLE_VARIANT_LABELS[v]}
                  </option>
                ))}
              </select>
              <button
                onClick={handleRegenerate}
                disabled={busy !== null}
                className="rounded-lg border border-[#c9a24b] px-4 py-2 text-sm font-medium text-[#0b1526] transition hover:bg-[#c9a24b]/10 disabled:opacity-50"
              >
                {busy === "regenerate" ? "Regenerando…" : "Regenerar en este estilo"}
              </button>

              <button
                onClick={handleApprove}
                disabled={busy !== null}
                className="ml-auto rounded-lg bg-[#c9a24b] px-4 py-2 text-sm font-medium text-[#0b1526] transition hover:bg-[#c9a24b]/90 disabled:opacity-50"
              >
                {busy === "approve" ? "Aprobando…" : "Aprobar"}
              </button>
            </div>
          )}

          {isApproved && (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-medium text-slate-700">Publicar en:</p>
              <div className="flex flex-wrap gap-2">
                {connections.length === 0 && (
                  <p className="text-xs text-slate-500">
                    No hay cuentas conectadas. Configurá Facebook/Instagram en{" "}
                    <Link href="/marketing/configuracion" className="text-[#c9a24b] underline">
                      Configuración
                    </Link>
                    .
                  </p>
                )}
                {connections.map((c) => (
                  <label key={c.id} className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs">
                    <input type="checkbox" checked={selectedConnections.includes(c.id)} onChange={() => toggleConnection(c.id)} />
                    {c.platform === "facebook" ? "📘" : "📸"} {c.external_account_name}
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handlePublishNow}
                  disabled={busy !== null || connections.length === 0}
                  className="rounded-lg bg-[#0b1526] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#0b1526]/90 disabled:opacity-50"
                >
                  {busy === "publish-now" ? "Publicando…" : "Publicar ahora"}
                </button>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
                />
                <button
                  onClick={handleSchedule}
                  disabled={busy !== null || connections.length === 0}
                  className="rounded-lg border border-[#0b1526] px-4 py-2 text-sm font-medium text-[#0b1526] transition hover:bg-slate-100 disabled:opacity-50"
                >
                  {busy === "schedule" ? "Programando…" : "Programar"}
                </button>
              </div>
            </div>
          )}

          {canRetry && (
            <button
              onClick={handleRetry}
              disabled={busy !== null}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
            >
              {busy === "retry" ? "Reintentando…" : "Reintentar destinos fallidos"}
            </button>
          )}

          {targets.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Destinos</h3>
              {targets.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <span>
                    {t.platform === "facebook" ? "📘 Facebook" : "📸 Instagram"} · {t.status}
                    {t.attempts > 0 ? ` · ${t.attempts} intento(s)` : ""}
                  </span>
                  {t.permalink && (
                    <a href={t.permalink} target="_blank" rel="noreferrer" className="text-[#c9a24b] hover:underline">
                      Ver publicación ↗
                    </a>
                  )}
                  {t.last_error && <span className="text-xs text-red-600">{t.last_error}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {events.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Historial</h3>
          <ul className="space-y-1 text-xs text-slate-500">
            {events
              .slice()
              .reverse()
              .map((e) => (
                <li key={e.id}>
                  {new Date(e.created_at).toLocaleString("es-CO")} · {e.from_status || "—"} → {e.to_status} · {e.actor}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
