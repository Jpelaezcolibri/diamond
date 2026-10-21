"use client";

import { useMemo, useState } from "react";
import type { Categoria, Estado, Ficha, Respuesta, Via } from "@/lib/publicaciones";
import MarcarAtendida from "@/components/publicaciones/marcar-atendida";

// "Lo que enviamos" (mockup 2026-10-20-publicaciones-respuestas): una fila por
// ficha publicada, filtros en el cliente y las respuestas desplegables.

export type RespuestaVista = Respuesta & { estado: Estado; grupoNombre: string | null };
export type FichaVista = Omit<Ficha, "respuestas"> & { respuestas: RespuestaVista[] };

type Filtro = "todos" | "con_respuesta" | "sin_atender" | Categoria;

const VIA: Record<Via, { icono: string; corto: string; etiqueta: string; color: string }> = {
  sofi: { icono: "💬", corto: "Sofi", etiqueta: "SOFI", color: "text-emerald-600" },
  linea: { icono: "📱", corto: "Línea", etiqueta: "LÍNEA", color: "text-indigo-600" },
  grupo: { icono: "↩️", corto: "Grupo", etiqueta: "GRUPO", color: "text-amber-600" },
};

const ESTADO: Record<Estado, { texto: string; clase: string }> = {
  atendida: { texto: "Atendido", clase: "bg-emerald-100 text-emerald-800" },
  visita: { texto: "Visita propuesta", clase: "bg-amber-100 text-amber-800" },
  seguimiento: { texto: "Seguimiento enviado", clase: "bg-violet-100 text-violet-800" },
  link_sofi: { texto: "Link a Sofi enviado", clase: "bg-sky-100 text-sky-800" },
  recordatorio: { texto: "Recordatorio a la asesora", clase: "bg-orange-100 text-orange-800" },
  sin_atender: { texto: "Sin atender", clase: "bg-rose-100 text-rose-800" },
  nueva: { texto: "Nueva", clase: "bg-slate-100 text-slate-700" },
};

const CATEGORIA: Record<Categoria, { texto: string; clase: string; thumb: string } | null> = {
  amoblado: { texto: "Amoblado", clase: "bg-teal-100 text-teal-800", thumb: "from-slate-400 to-slate-200" },
  venta: { texto: "Venta", clase: "bg-sky-100 text-sky-800", thumb: "from-stone-400 to-stone-100" },
  finca: { texto: "Finca", clase: "bg-green-100 text-green-800", thumb: "from-green-300 to-green-100" },
  otro: null,
};

const POR_PAGINA = 15;

function cuando(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // "20-oct, 3:16 p. m." como el mockup.
  const partes = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short" }).formatToParts(d);
  const parte = (t: string) => partes.find((p) => p.type === t)?.value || "";
  const dia = `${parte("day")}-${parte("month").replace(/\.$/, "")}`;
  const h = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" }).format(d);
  return `${dia}, ${h}`;
}

function horas(f: FichaVista): string {
  if (!f.primera) return "publicada antes del período";
  if (f.primera === f.ultima) return cuando(f.primera);
  return `${cuando(f.primera)} → ${cuando(f.ultima)}`;
}

const pendiente = (r: RespuestaVista) => r.estado === "sin_atender";

export default function ListaPublicaciones({ fichas, totalPosts }: { fichas: FichaVista[]; totalPosts: number }) {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [grupo, setGrupo] = useState<string>("");
  const [abiertas, setAbiertas] = useState<Set<string>>(
    () => new Set(fichas.filter((f) => f.respuestas.some(pendiente)).map((f) => f.ref))
  );
  const [mostrar, setMostrar] = useState(POR_PAGINA);

  const grupos = useMemo(() => [...new Set(fichas.flatMap((f) => f.grupos))].sort(), [fichas]);
  const conRespuesta = fichas.filter((f) => f.respuestas.length > 0).length;
  const conPendiente = fichas.filter((f) => f.respuestas.some(pendiente)).length;

  const visibles = fichas.filter((f) => {
    if (grupo && !f.grupos.includes(grupo)) return false;
    if (filtro === "todos") return true;
    if (filtro === "con_respuesta") return f.respuestas.length > 0;
    if (filtro === "sin_atender") return f.respuestas.some(pendiente);
    return f.categoria === filtro;
  });

  const chip = (valor: Filtro, texto: string) => (
    <button
      key={valor}
      type="button"
      onClick={() => {
        setFiltro(valor);
        setMostrar(POR_PAGINA);
      }}
      className={`rounded-full border px-2.5 py-1 text-xs ${
        filtro === valor ? "border-[#0b1526] bg-[#0b1526] text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
      }`}
    >
      {texto}
    </button>
  );

  const alternar = (ref: string) =>
    setAbiertas((s) => {
      const n = new Set(s);
      if (n.has(ref)) n.delete(ref);
      else n.add(ref);
      return n;
    });

  return (
    <section id="enviado" className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="font-display text-sm font-bold text-slate-900">Lo que enviamos</h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">
          {totalPosts} {totalPosts === 1 ? "post" : "posts"}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 border-b border-slate-200 px-4 py-2.5">
        {chip("todos", "Todos")}
        {chip("con_respuesta", `Con respuesta · ${conRespuesta}`)}
        {chip("sin_atender", `Sin atender · ${conPendiente}`)}
        {chip("amoblado", "Amoblados")}
        {chip("venta", "Venta")}
        {chip("finca", "Fincas")}
        <select
          value={grupo}
          onChange={(e) => {
            setGrupo(e.target.value);
            setMostrar(POR_PAGINA);
          }}
          className="max-w-full rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700"
          aria-label="Filtrar por grupo"
        >
          <option value="">Todos los grupos</option>
          {grupos.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>

      {visibles.length === 0 && (
        <p className="px-4 py-10 text-center text-sm text-slate-500">
          {fichas.length === 0 ? "En este período no salió ninguna publicación a los grupos." : "Ninguna publicación con este filtro."}
        </p>
      )}

      {visibles.slice(0, mostrar).map((f) => {
        const cat = CATEGORIA[f.categoria];
        const n = f.respuestas.length;
        const porVia = { sofi: 0, linea: 0, grupo: 0 } as Record<Via, number>;
        for (const r of f.respuestas) porVia[r.via]++;
        const abierta = abiertas.has(f.ref);
        return (
          <article key={f.ref} className="border-b border-slate-200 px-4 py-3.5 last:border-b-0">
            <div className="flex items-start gap-3">
              {f.foto ? (
                // eslint-disable-next-line @next/next/no-img-element -- sin optimizador (Vercel 402)
                <img src={f.foto} alt="" loading="lazy" className="h-14 w-14 flex-none rounded-lg bg-slate-200 object-cover" />
              ) : (
                <div className={`h-14 w-14 flex-none rounded-lg bg-gradient-to-br ${cat?.thumb || "from-slate-400 to-slate-200"}`} />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">{f.titulo || `Ref ${f.ref}`}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                  {cat && <span className={`mr-1 inline-block rounded-full px-1.5 py-0.5 text-[11px] ${cat.clase}`}>{cat.texto}</span>}
                  {f.origen && (
                    <span
                      className={`mr-1 inline-block rounded-full px-1.5 py-0.5 text-[11px] ${
                        f.origen === "auto" ? "bg-indigo-100 text-indigo-800" : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {f.origen === "auto" ? "Automático" : f.origen === "manual" ? "A mano" : "Automático y a mano"}
                    </span>
                  )}
                  Ref {f.ref}
                  {f.precio ? ` · ${f.precio}` : ""}
                  {" · "}
                  {f.grupos.length === 1 ? (
                    f.grupos[0]
                  ) : f.grupos.length > 1 ? (
                    <span title={f.grupos.join(", ")}>
                      salió en <b className="text-slate-700">{f.grupos.length} grupos</b>
                    </span>
                  ) : null}
                  {f.grupos.length > 0 ? " · " : ""}
                  {horas(f)}
                </p>
                {n > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(Object.keys(VIA) as Via[])
                      .filter((v) => porVia[v] > 0)
                      .map((v) => (
                        <span key={v} className="rounded-md bg-slate-100 px-2 py-0.5 text-[11.5px] text-slate-700">
                          {VIA[v].icono} {VIA[v].corto} {porVia[v]}
                        </span>
                      ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => n > 0 && alternar(f.ref)}
                disabled={n === 0}
                aria-expanded={n > 0 ? abierta : undefined}
                className="flex-none text-right disabled:cursor-default"
              >
                <b className={`block text-xl tabular-nums ${n === 0 ? "text-slate-300" : "text-slate-900"}`}>{n}</b>
                <small className="block text-[11px] text-slate-500">
                  {n === 1 ? "respuesta" : "respuestas"}
                  {n > 0 ? (abierta ? " ▴" : " ▾") : ""}
                </small>
              </button>
            </div>

            {abierta && n > 0 && (
              <ul className="mt-2.5 border-l-[3px] border-slate-200 pl-3 sm:ml-[68px]">
                {f.respuestas.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-start gap-x-2 gap-y-1 py-1.5 text-[13px]">
                    <span className={`w-20 flex-none text-[11px] font-semibold ${VIA[r.via].color}`}>
                      {VIA[r.via].icono} {VIA[r.via].etiqueta}
                    </span>
                    <span className="min-w-0 flex-1 basis-48 text-slate-700">
                      {r.primer_texto ? `“${r.primer_texto}”` : <span className="text-slate-400">(sin texto)</span>}
                      <span className="block text-[11.5px] text-slate-500">
                        {r.colega_nombre || "Colega"}
                        {r.grupoNombre ? ` · ${r.grupoNombre}` : ""} → {cuando(r.primer_at)}
                        {(r.mensajes || 1) > 1 ? ` · ${r.mensajes} mensajes` : ""}
                        {r.atendida_por === "sofi" ? " · Sofi respondió" : r.atendida_por === "manual" ? " · marcada a mano" : ""}
                      </span>
                    </span>
                    <span className="flex flex-none flex-col items-end gap-1">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ${ESTADO[r.estado].clase}`}>
                        {ESTADO[r.estado].texto}
                      </span>
                      {!r.atendida_at && <MarcarAtendida id={r.id} />}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        );
      })}

      {visibles.length > mostrar && (
        <button
          type="button"
          onClick={() => setMostrar((m) => m + POR_PAGINA)}
          className="block w-full px-4 py-3 text-center text-xs text-slate-500 hover:bg-slate-50"
        >
          Ver {Math.min(POR_PAGINA, visibles.length - mostrar)} más de {visibles.length - mostrar} restantes
        </button>
      )}
    </section>
  );
}
