"use client";

// Detalle de una visita desde el calendario (Juan, 2026-11-09, mockup
// aprobado: "me gusta"). Panel a la derecha en escritorio y hoja desde abajo
// en el celular. Trae todo para atender sin salir: quién va y cómo
// contactarlo, responderle desde aquí, la propiedad, qué pidió, lo pendiente
// y el historial. Caso Norha Vélez: la visita estaba en el calendario y nadie
// sabía quién era ni cómo escribirle.
//
// Responder pasa el chat a modo humano (Sofi deja de contestar en ese chat)
// y envía por /api/send, con las mismas reglas de acceso que el chat del CRM.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DetalleCita } from "@/lib/cita-detalle";
import AccionesCita from "@/components/acciones-cita";
import { BotonCancelarCita } from "@/components/cancelar-cita";

const TZ = "America/Bogota";
const fechaLarga = (iso: string) =>
  new Intl.DateTimeFormat("es-CO", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
// Solo la primera letra en mayúscula ("Martes, 10 de noviembre de 2026").
const conMayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// Sin el punto final de "p. m." cuando la frase sigue con otro punto.
const sinPuntoFinal = (s: string) => s.replace(/\.$/, "");
const hora = (iso: string) => new Intl.DateTimeFormat("es-CO", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const corta = (iso: string) =>
  new Intl.DateTimeFormat("es-CO", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const iniciales = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
const primerNombre = (n: string) => {
  const p = n.split(/\s+/)[0] || n;
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
};

const ESTADO: Record<DetalleCita["estado"], { texto: string; clase: string }> = {
  confirmada: { texto: "✓ CONFIRMADA", clase: "bg-emerald-500 text-white" },
  propuesta: { texto: "⏳ POR CONFIRMAR", clase: "bg-amber-400 text-slate-900" },
  reprogramada: { texto: "⏳ POR CONFIRMAR", clase: "bg-amber-400 text-slate-900" },
  vencida: { texto: "VENCIDA", clase: "bg-slate-500 text-white" },
  cancelada: { texto: "CANCELADA", clase: "bg-slate-500 text-white" },
};

function Tarjeta({ titulo, extra, children, id, destacada = false }: { titulo: string; extra?: React.ReactNode; children: React.ReactNode; id?: string; destacada?: boolean }) {
  return (
    <section id={id} className={`rounded-2xl bg-white p-4 ${destacada ? "border-2 border-[#0b1526]" : "border border-slate-200"}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-bold text-slate-900">{titulo}</h3>
        {extra}
      </div>
      {children}
    </section>
  );
}

export default function PanelDetalleCita({ detalle: d, cerrarHref }: { detalle: DetalleCita; cerrarHref: string }) {
  const router = useRouter();
  const cajaRef = useRef<HTMLTextAreaElement>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modo, setModo] = useState(d.modo);

  const cerrar = () => router.replace(cerrarHref, { scroll: false });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && router.replace(cerrarHref, { scroll: false });
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [router, cerrarHref]);

  const nombre = d.persona.nombre;
  const corto = primerNombre(nombre);
  const refTxt = d.propiedad?.ref || d.refSinFicha;
  const porConfirmar = d.estado === "propuesta" || d.estado === "reprogramada";
  const puedeEscribir = Boolean(d.conversationId && d.ventanaHasta);
  const est = ESTADO[d.estado];

  const chips = [
    d.fechaHora && refTxt ? `Hola ${corto}, te confirmo la visita del ${fechaLarga(d.fechaHora).replace(/ de \d{4}$/, "")} a las ${hora(d.fechaHora)} a la Ref ${refTxt}.` : null,
    d.persona.sinCelularVisible ? `Hola ${corto}, ¿me compartes un número de celular para llamarte y coordinar la visita?` : null,
    `Hola ${corto}, ¿cómo vas? Te escribo por la visita${refTxt ? ` a la Ref ${refTxt}` : ""}.`,
  ].filter(Boolean) as string[];

  function irAResponder() {
    document.getElementById("responder")?.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => cajaRef.current?.focus(), 350);
  }

  async function copiarDatos() {
    const lineas = [
      `${nombre} (${d.persona.esColega ? "colega" : "cliente"})`,
      d.persona.celular ? `Celular: ${d.persona.celular}` : "Sin celular visible: escribirle desde el chat del CRM",
      d.fechaHora ? `Visita: ${fechaLarga(d.fechaHora)}, ${hora(d.fechaHora)}` : null,
      refTxt ? `Ref ${refTxt}${d.propiedad?.zona ? ` · ${d.propiedad.zona}` : ""}${d.propiedad?.precio ? ` · ${d.propiedad.precio}` : ""}` : null,
      d.propiedad?.linkWasi || null,
    ].filter(Boolean);
    await navigator.clipboard.writeText(lineas.join("\n")).catch(() => null);
    setAviso("Datos copiados");
  }

  async function enviar() {
    if (!d.conversationId || !texto.trim()) return;
    setEnviando(true);
    setError(null);
    // Sofi deja de contestar en este chat mientras una persona atiende.
    if (modo === "bot") {
      const m = await fetch("/api/modo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: d.conversationId, modo: "humano" }) });
      if (!m.ok) {
        const b = await m.json().catch(() => ({}));
        setEnviando(false);
        setError(b.error || "No se pudo tomar el chat. Intenta de nuevo.");
        return;
      }
      setModo("humano");
    }
    const r = await fetch("/api/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: d.conversationId, text: texto.trim() }) });
    const b = await r.json().catch(() => ({}));
    setEnviando(false);
    if (!r.ok) {
      setError(b.error || "No se pudo enviar. Intenta de nuevo.");
      return;
    }
    setTexto("");
    setAviso(b.delivery === "failed" ? "WhatsApp no lo entregó: revisa el chat" : "Enviado por la línea de Sofi");
    router.refresh();
  }

  async function devolverASofi() {
    if (!d.conversationId) return;
    const r = await fetch("/api/modo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: d.conversationId, modo: "bot" }) });
    if (r.ok) {
      setModo("bot");
      setAviso("Sofi vuelve a atender este chat");
    } else setError("No se pudo devolver a Sofi.");
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Detalle de la visita de ${nombre}`}>
      <button type="button" aria-label="Cerrar" onClick={cerrar} className="absolute inset-0 h-full w-full cursor-default bg-slate-900/40" />
      <div className="absolute inset-x-0 bottom-0 flex h-[92vh] flex-col overflow-hidden rounded-t-3xl bg-slate-100 shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:w-[500px] sm:rounded-none">
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {/* Isla oscura: lo esencial de un vistazo */}
          <header className="relative bg-[#0b1526] px-5 pb-5 pt-5 text-white">
            <button type="button" onClick={cerrar} aria-label="Cerrar" className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-lg ring-1 ring-white/30 hover:bg-white/20">
              ✕
            </button>
            <div className="flex flex-wrap items-center gap-2 pr-12">
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${est.clase}`}>{est.texto}</span>
              <span className="rounded-full px-2.5 py-1 text-xs font-medium capitalize text-[#c9a24b] ring-1 ring-[#c9a24b]/60">{d.tipo}</span>
            </div>
            {d.fechaHora ? (
              <>
                <p className="mt-3 text-[15px] font-medium text-slate-200">{conMayuscula(fechaLarga(d.fechaHora))}</p>
                <p className="text-4xl font-bold text-[#c9a24b]">{hora(d.fechaHora)}</p>
              </>
            ) : (
              <p className="mt-3 text-xl font-semibold">Sin fecha</p>
            )}
            {refTxt && (
              <div className="mt-4">
                <p className="text-lg font-bold">
                  Ref {refTxt}
                  {d.propiedad?.tipoOperacion ? ` · ${d.propiedad.tipoOperacion}` : ""}
                </p>
                {d.propiedad?.zona && <p className="text-[15px] text-slate-300">{d.propiedad.zona}</p>}
                {d.propiedad?.precio && <p className="text-lg font-bold">{d.propiedad.precio}</p>}
              </div>
            )}
            <div className="mt-3 space-y-0.5 text-[14px] text-slate-300">
              {d.asesora && (
                <p>
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-indigo-300" />
                  {d.asesora.alias ? `${d.asesora.alias} · ` : ""}
                  {d.asesora.nombre}
                </p>
              )}
              {d.estado === "confirmada" && d.confirmadaAt && (
                <p>
                  Confirmó {d.confirmadaPor || "el equipo"} el {corta(d.confirmadaAt)}
                </p>
              )}
              {porConfirmar && d.corteAt && <p className="text-amber-300">Confírmala antes del {corta(d.corteAt)} o se cancela</p>}
            </div>
            {d.pendientes.length > 0 && (
              <a href="#pendientes" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-red-700">
                ⚠ {d.pendientes.length} {d.pendientes.length === 1 ? "pendiente" : "pendientes"} sin atender ↓
              </a>
            )}
          </header>

          <div className="space-y-3 p-3 sm:p-4">
            <Tarjeta titulo="Quién va y cómo contactarlo" destacada>
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[15px] font-bold text-amber-900">{iniciales(nombre)}</div>
                <div className="min-w-0">
                  <p className="text-lg font-bold leading-tight text-slate-900">
                    {nombre}{" "}
                    <span className={`ml-1 rounded-full px-2 py-0.5 align-middle text-xs font-semibold ${d.persona.esColega ? "bg-violet-600 text-white" : "bg-sky-600 text-white"}`}>
                      {d.persona.esColega ? "Colega" : "Cliente"}
                    </span>
                  </p>
                  <p className="text-[15px] text-slate-500">{d.persona.esColega ? "De otra inmobiliaria · viene con un cliente propio" : "Cliente directo"}</p>
                </div>
              </div>
              {d.persona.grupos.length > 0 && (
                <p className="mt-3 text-[15px] text-slate-600">
                  <span className="text-slate-500">Grupo donde publicó: </span>
                  <span className="font-semibold text-slate-800">{d.persona.grupos.join(", ")}</span>
                </p>
              )}
              {d.persona.sinCelularVisible ? (
                <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-[15px]">
                  <p className="font-bold text-amber-900">Sin celular visible</p>
                  <p className="text-amber-800">WhatsApp oculta su número.</p>
                  <p className="font-semibold text-amber-900">Pídele un celular para poder llamar.</p>
                </div>
              ) : d.persona.celular ? (
                <div className="mt-3">
                  <p className="text-2xl font-bold tracking-wide text-slate-900">{d.persona.celular}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <a href={`tel:+${d.persona.whatsapp}`} className="rounded-lg bg-[#0b1526] px-3 py-2.5 text-center text-[15px] font-semibold text-white">
                      Llamar
                    </a>
                    <a href={`https://wa.me/${d.persona.whatsapp}`} target="_blank" rel="noreferrer" className="rounded-lg bg-emerald-600 px-3 py-2.5 text-center text-[15px] font-semibold text-white">
                      WhatsApp
                    </a>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-[15px] text-slate-600">Sin teléfono registrado: escríbele desde el chat.</p>
              )}
              <div className="mt-3 grid gap-2">
                {d.conversationId && (
                  <button type="button" onClick={irAResponder} className="rounded-lg bg-[#c9a24b] px-3 py-2.5 text-[15px] font-semibold text-[#0b1526] hover:brightness-95">
                    Responderle desde aquí
                  </button>
                )}
                <button type="button" onClick={copiarDatos} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-[15px] font-medium text-slate-700 hover:bg-slate-50">
                  Copiar datos
                </button>
              </div>
            </Tarjeta>

            {d.conversationId && (
              <Tarjeta
                id="responder"
                titulo={`Responderle a ${corto}`}
                extra={
                  <Link href={`/inbox/${d.conversationId}`} className="text-sm font-medium text-indigo-600 hover:underline">
                    Ver chat completo
                  </Link>
                }
              >
                <div className="space-y-2">
                  {d.mensajes.length === 0 && <p className="text-[15px] text-slate-500">Todavía no hay mensajes en este chat.</p>}
                  {d.mensajes.map((m, i) => (
                    <div key={i} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
                      <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[15px] ${m.role === "user" ? "bg-slate-100 text-slate-800" : "bg-[#0b1526] text-white"}`}>
                        <p className="line-clamp-6">{m.content}</p>
                        <p className={`mt-0.5 text-[12px] ${m.role === "user" ? "text-slate-500" : "text-slate-400"}`}>
                          {m.role === "user" ? corto : "Diamond"} · {corta(m.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {puedeEscribir ? (
                  <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-[14px] text-emerald-800">
                    Puedes escribirle: ventana abierta hasta el {sinPuntoFinal(corta(d.ventanaHasta as string))}. Sale por la línea de Sofi y queda en el chat del CRM.
                  </p>
                ) : (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[14px] text-amber-900">
                    Ventana cerrada: hace más de 24 horas que no escribe, y WhatsApp solo deja mandarle una plantilla. Ábrelo en el chat del CRM.
                  </p>
                )}

                {puedeEscribir && (
                  <>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {chips.map((c) => (
                        <button key={c} type="button" onClick={() => { setTexto(c); cajaRef.current?.focus(); }} className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-50">
                          {c.length > 60 ? `${c.slice(0, 58)}…` : c}
                        </button>
                      ))}
                    </div>
                    <div className="mt-3 rounded-xl bg-white pb-1">
                      <textarea
                        ref={cajaRef}
                        value={texto}
                        onChange={(e) => setTexto(e.target.value)}
                        rows={3}
                        placeholder={`Escríbele a ${corto}…`}
                        className="w-full resize-y rounded-xl border border-slate-300 px-3 py-2 text-[15px] text-slate-900 outline-none focus:border-[#c9a24b] focus:ring-2 focus:ring-[#c9a24b]/30"
                      />
                      <button type="button" onClick={enviar} disabled={enviando || !texto.trim()} className="mt-2 w-full rounded-lg bg-[#c9a24b] px-3 py-2.5 text-[15px] font-bold text-[#0b1526] hover:brightness-95 disabled:opacity-50">
                        {enviando ? "Enviando…" : "Enviar"}
                      </button>
                    </div>
                  </>
                )}
                {modo === "humano" ? (
                  <p className="mt-2 text-[13px] text-slate-500">
                    Sofi está en pausa en este chat mientras tú atiendes.{" "}
                    <button type="button" onClick={devolverASofi} className="font-semibold text-indigo-600 hover:underline">
                      Devolver a Sofi
                    </button>
                  </p>
                ) : (
                  <p className="mt-2 text-[13px] text-slate-500">Al responder tú, Sofi deja de contestar en este chat hasta que la devuelvas.</p>
                )}
                {aviso && <p className="mt-2 rounded-lg bg-slate-900 px-3 py-2 text-[14px] text-white">{aviso}</p>}
                {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[14px] text-red-700">{error}</p>}
              </Tarjeta>
            )}

            {(d.propiedad || d.refSinFicha) && (
              <Tarjeta titulo="Propiedad" extra={<span className="text-sm font-semibold text-slate-500">Ref {refTxt}</span>}>
                {d.propiedad ? (
                  <>
                    {d.propiedad.foto && (
                      // Foto directa de Wasi, sin el optimizador de Vercel (un 402 del optimizador tumbó todas las imágenes).
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={d.propiedad.foto} alt={`Foto de la Ref ${d.propiedad.ref}`} className="mb-3 h-44 w-full rounded-xl object-cover" loading="lazy" />
                    )}
                    {d.propiedad.titulo && <p className="text-[15px] font-semibold text-slate-900">{d.propiedad.titulo}</p>}
                    <p className="text-[15px] text-slate-600">{[d.propiedad.zona, d.propiedad.precio].filter(Boolean).join(" · ")}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {d.propiedad.datos.map((x) => (
                        <span key={x} className="rounded-full bg-slate-100 px-2.5 py-1 text-[13px] text-slate-700">{x}</span>
                      ))}
                    </div>
                    {d.propiedad.linkWasi && (
                      <a href={d.propiedad.linkWasi} target="_blank" rel="noreferrer" className="mt-3 block rounded-lg border border-slate-300 px-3 py-2.5 text-center text-[15px] font-medium text-slate-700 hover:bg-slate-50">
                        Ver ficha en Wasi
                      </a>
                    )}
                  </>
                ) : (
                  <p className="text-[15px] text-slate-600">No encontré la ficha de la Ref {d.refSinFicha} en la base. Revísala en Wasi.</p>
                )}
              </Tarjeta>
            )}

            {d.pedido && (
              <Tarjeta titulo={d.persona.esColega ? "Qué pidió su cliente" : "Qué busca"}>
                <blockquote className="rounded-xl border-l-4 border-[#c9a24b] bg-slate-50 px-3 py-2 text-[15px] italic text-slate-800">“{d.pedido.texto}”</blockquote>
                <p className="mt-2 text-[13px] text-slate-500">
                  {d.pedido.grupo ? `En ${d.pedido.grupo} · ` : ""}
                  {corta(d.pedido.fecha)}
                </p>
              </Tarjeta>
            )}

            {d.pendientes.length > 0 && (
              <Tarjeta id="pendientes" titulo="Pendientes">
                <ul className="space-y-2">
                  {d.pendientes.map((p) => (
                    <li key={p} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[15px] text-red-800">
                      {p}
                    </li>
                  ))}
                </ul>
              </Tarjeta>
            )}

            {d.historial.length > 0 && (
              <Tarjeta titulo="Historial">
                <ol className="relative space-y-3 border-l-2 border-slate-200 pl-4">
                  {d.historial.map((h, i) => (
                    <li key={i} className="text-[15px]">
                      <span className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full bg-[#c9a24b]" />
                      <p className="text-slate-800">{h.texto}</p>
                      <p className="text-[13px] text-slate-500">{corta(h.fecha)}</p>
                    </li>
                  ))}
                </ol>
              </Tarjeta>
            )}

            {d.estado !== "vencida" && d.estado !== "cancelada" && (
              <div className="px-1 pb-2">
                <BotonCancelarCita leadId={d.leadId} cliente={nombre} />
              </div>
            )}
          </div>
        </div>

        {/* Pie fijo: lo que más se usa, a un toque */}
        <footer className="border-t border-slate-200 bg-white p-3">
          {porConfirmar ? (
            <AccionesCita leadId={d.leadId} />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {d.conversationId ? (
                <>
                  <button type="button" onClick={irAResponder} className="rounded-lg bg-[#c9a24b] px-3 py-2.5 text-[15px] font-bold text-[#0b1526]">
                    Responder
                  </button>
                  <Link href={`/inbox/${d.conversationId}`} className="rounded-lg border border-slate-300 px-3 py-2.5 text-center text-[15px] font-medium text-slate-700">
                    Abrir chat
                  </Link>
                </>
              ) : (
                <button type="button" onClick={cerrar} className="col-span-2 rounded-lg border border-slate-300 px-3 py-2.5 text-[15px] font-medium text-slate-700">
                  Cerrar
                </button>
              )}
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}
