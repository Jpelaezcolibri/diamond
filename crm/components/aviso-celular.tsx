"use client";

import { useState } from "react";

// La pantalla que abre la asesora desde el aviso de WhatsApp (Juan,
// 2026-09-02, opción D). Reproduce el mockup aprobado: una isla oscura arriba
// que dice qué es de un vistazo, el pedido, las fichas con lo no confirmado,
// el mensaje ya redactado (editable) y un solo botón verde fijo abajo.
//
// LA REGLA: el mensaje va SIEMPRE al privado del colega, nunca al grupo.
//   - Con número: wa.me abre ESE chat con el texto ya escrito.
//   - Sin número: se copia el texto y se abre WhatsApp; el grupo es donde lo
//     ENCUENTRA (toca su nombre), no a dónde escribe.
// En los dos casos, tocar el botón es lo que medimos como "gestionado". El
// envío real dentro de WhatsApp no lo vemos.

type Match = {
  ref: string;
  titulo?: string | null;
  zona?: string | null;
  precio?: string | null;
  area?: string | null;
  habitaciones?: number | null;
  banos?: number | null;
  garajes?: number | null;
  estrato?: number | null;
  link?: string | null;
};

export type DatosAviso = {
  senal: {
    id: string;
    autor_nombre: string | null;
    grupo_nombre: string | null;
    texto_original: string;
    created_at: string;
    operacion?: string | null;
    tipo?: string | null;
    zona?: string | null;
    zonas?: string[] | null;
    precio_max?: number | null;
    habitaciones?: number | null;
    garajes?: number | null;
    area_min?: number | null;
    sin_confirmar: string[];
    visto_at: string | null;
    gestionado_at: string | null;
    gestion: string | null;
    respondida_at: string | null;
  };
  utiles: Match[];
  dudosas: Match[];
  mensaje: string | null;
  telefonoColega: string | null;
  motivo: string | null;
  porque: string | null;
  aprobada: boolean;
  visto_ahora: boolean;
  org: { name: string };
};

const primerNombre = (n: string | null) => (n || "").trim().split(/\s+/)[0] || "el colega";
const dato = (v: number | null | undefined, unidad: string) =>
  v === null || v === undefined ? `${unidad}: sin dato` : `${v} ${unidad}`;
const millones = (n?: number | null) => (n ? `hasta $${Math.round(n / 1_000_000)}M` : null);
const haceCuanto = (iso: string) => {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
};

export default function AvisoCelular({ datos, token }: { datos: DatosAviso; token: string }) {
  const { senal, utiles, dudosas, mensaje, telefonoColega, porque, aprobada } = datos;
  const [texto, setTexto] = useState(mensaje || "");
  const [gestion, setGestion] = useState<string | null>(senal.gestion);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  async function registrar(g: "envio" | "no_sirve") {
    setOcupado(true);
    await fetch("/api/aviso/gestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, gestion: g }),
    }).catch(() => null);
    setGestion(g);
    setOcupado(false);
  }

  async function enviar() {
    await registrar("envio");
    if (telefonoColega) {
      window.location.href = `https://wa.me/${telefonoColega}?text=${encodeURIComponent(texto)}`;
      return;
    }
    let copiado = false;
    try {
      await navigator.clipboard.writeText(texto);
      copiado = true;
    } catch {
      copiado = false;
    }
    setAviso(copiado ? "Mensaje copiado. Ahora tocá el nombre del colega en el grupo y pegalo." : "No se pudo copiar solo: seleccioná el mensaje de arriba y copialo a mano.");
    window.location.href = `whatsapp://send?text=${encodeURIComponent(texto)}`;
  }

  const nombre = primerNombre(senal.autor_nombre);
  const chips = [
    senal.operacion,
    senal.tipo,
    senal.zonas?.length ? senal.zonas.join(", ") : senal.zona,
    millones(senal.precio_max),
    senal.habitaciones ? `${senal.habitaciones} alcobas` : null,
    senal.garajes ? `${senal.garajes} garaje${senal.garajes === 1 ? "" : "s"}` : null,
    senal.area_min ? `${senal.area_min} m² mín.` : null,
  ].filter(Boolean) as string[];

  return (
    <main className="mx-auto min-h-dvh max-w-md bg-white pb-40 text-slate-900">
      <header className="bg-gradient-to-br from-[#0b1526] to-[#15213a] px-5 pb-4 pt-5 text-slate-100">
        <div className="text-[11px] font-bold uppercase tracking-wider text-[#f2d58a]">
          {aprobada ? "🚨 Aprobada por Sofi · sin salir" : "🎯 Oportunidad · para revisar"}
        </div>
        <h1 className="font-display mt-1 text-lg font-extrabold leading-tight">
          {senal.autor_nombre || "Un colega"} busca {senal.tipo || "propiedad"}
          {senal.zona ? ` en ${senal.zona}` : ""}
        </h1>
        <div className="mt-1 text-xs text-slate-300">
          Grupo <b className="font-semibold text-white">{senal.grupo_nombre || "sin nombre"}</b> · {haceCuanto(senal.created_at)}
        </div>
        {gestion ? (
          <div className="mt-2 inline-block rounded-full border border-emerald-300/50 bg-emerald-400/10 px-2 py-0.5 text-[11px] text-emerald-200">
            ✅ {gestion === "envio" ? "Ya le escribiste" : "Marcado: no sirve"}
          </div>
        ) : (
          <div className="mt-2 inline-block rounded-full border border-[#d4a53a]/40 bg-[#d4a53a]/15 px-2 py-0.5 text-[11px] text-[#f2d58a]">
            👁 Visto
          </div>
        )}
      </header>

      {porque && (
        <section className="border-b border-slate-200 px-5 py-3">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Por qué no salió solo</p>
          <p className="rounded-r-lg border-l-4 border-amber-400 bg-slate-50 px-3 py-2 text-sm">{porque}</p>
        </section>
      )}

      <section className="border-b border-slate-200 px-5 py-3">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Lo que pide</p>
        <p className="whitespace-pre-line rounded-r-lg border-l-4 border-indigo-500 bg-slate-50 px-3 py-2 text-sm">{senal.texto_original}</p>
        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <span key={c} className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600">{c}</span>
            ))}
          </div>
        )}
      </section>

      {utiles.length > 0 && (
        <section className="border-b border-slate-200 px-5 py-3">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Le sirve · {utiles.length}</p>
          {utiles.map((m) => (
            <div key={m.ref} className="border-t border-slate-100 py-2 first:border-t-0 first:pt-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">{m.titulo || "Sin título"}</div>
                  <div className="font-mono text-[11px] text-slate-400">
                    ref {m.ref}
                    {m.link ? (
                      <>
                        {" · "}
                        <a className="text-indigo-600" href={m.link} target="_blank" rel="noopener noreferrer">Wasi ↗</a>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="font-display whitespace-nowrap text-base font-bold tabular-nums">{m.precio}</div>
              </div>
              <div className="mt-1 text-xs text-slate-600">
                {[
                  m.zona,
                  m.area,
                  m.habitaciones ? `${m.habitaciones} alcobas` : null,
                  dato(m.banos, "baños"),
                  dato(m.garajes, "garajes"),
                  m.estrato ? `estrato ${m.estrato}` : "estrato: sin dato",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
          ))}
          {senal.sin_confirmar.length > 0 && (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
              <b>Sin confirmar:</b> {senal.sin_confirmar.join(", ")}.
            </p>
          )}
        </section>
      )}

      {dudosas.length > 0 && (
        <section className="border-b border-slate-200 px-5 py-3">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">🔎 Para revisar · {dudosas.length}</p>
          <p className="mb-1 text-xs text-slate-500">Sofi no las confirmó del todo. Decidí vos si vale la pena llamar al colega.</p>
          {dudosas.map((m) => (
            <div key={m.ref} className="py-1 text-sm">
              {m.titulo || m.ref} <span className="text-slate-500">· {m.precio}</span>
            </div>
          ))}
        </section>
      )}

      {mensaje && (
        <section className="border-b border-slate-200 px-5 py-3">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">El mensaje para {nombre}</p>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={10}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed"
            aria-label="Mensaje para el colega, editable"
          />
        </section>
      )}

      <section className="px-5 py-3">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Cómo se la mandás</p>
        {telefonoColega ? (
          <p className="text-sm text-slate-600">
            <b className="text-slate-900">{senal.autor_nombre}</b> · {telefonoColega.replace(/^57/, "")}. Se abre el chat con el mensaje ya escrito; solo tocás enviar.
          </p>
        ) : (
          <ol className="grid gap-1 text-sm text-slate-600">
            <li>1. El botón copia el mensaje y abre WhatsApp</li>
            <li>
              2. Entrá a <b className="text-slate-900">{senal.grupo_nombre || "el grupo"}</b> y tocá “{senal.autor_nombre || "el colega"}”
            </li>
            <li>3. Pegá en su chat privado y enviá</li>
          </ol>
        )}
        {aviso && <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{aviso}</p>}
      </section>

      <div className="fixed inset-x-0 bottom-0 mx-auto grid max-w-md gap-2 border-t border-slate-200 bg-white px-4 pb-5 pt-3">
        {mensaje && (
          <button
            onClick={enviar}
            disabled={ocupado}
            className="rounded-2xl bg-[#25d366] px-4 py-3 text-[15px] font-bold text-[#0b3d22] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a53a] disabled:opacity-60"
          >
            {telefonoColega ? "💬 Enviar por WhatsApp" : "📋 Copiar y abrir WhatsApp"}
          </button>
        )}
        <button
          onClick={() => registrar("no_sirve")}
          disabled={ocupado || gestion === "no_sirve"}
          className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 disabled:opacity-50"
        >
          {gestion === "no_sirve" ? "Marcado como no sirve" : "No sirve para este colega"}
        </button>
        <p className="text-center text-[11px] text-slate-400">Al tocar el botón verde queda registrado como gestionado.</p>
      </div>
    </main>
  );
}
