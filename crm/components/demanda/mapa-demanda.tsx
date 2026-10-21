"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { fmtDecimal, tipoLabel, type Celda, type MapaDemanda, type Operacion } from "@/lib/demanda";

// Parte interactiva del Mapa de demanda (mockup aprobado 2026-10-21): filtros
// en cliente, seleccion de fila, "Copiar" y "Abrir WhatsApp" (sin numero).
const VISIBLES = 20;

async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

export default function MapaDemandaVista({ mapa, dias, operacion }: { mapa: MapaDemanda; dias: number; operacion: Operacion }) {
  const [zona, setZona] = useState("");
  const [tipo, setTipo] = useState("");
  const [banda, setBanda] = useState("");
  const [todas, setTodas] = useState(false);
  const [selId, setSelId] = useState<string | null>(mapa.celdas[0]?.id ?? null);
  const [verLista, setVerLista] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const opciones = useMemo(() => {
    const zonas = new Set<string>();
    const tipos = new Set<string>();
    const bandas = new Map<string, string>();
    for (const c of mapa.celdas) {
      zonas.add(c.macrozona);
      tipos.add(c.tipo);
      bandas.set(c.banda, c.bandaLabel);
    }
    return { zonas: [...zonas], tipos: [...tipos], bandas: [...bandas.entries()] };
  }, [mapa.celdas]);

  const filtradas = mapa.celdas.filter(
    (c) => (!zona || c.macrozona === zona) && (!tipo || c.tipo === tipo) && (!banda || c.banda === banda)
  );
  const filas = todas ? filtradas : filtradas.slice(0, VISIBLES);
  const maxPpp = Math.max(1, ...filtradas.map((c) => c.porPropiedad));
  const sel: Celda | null = mapa.celdas.find((c) => c.id === selId) ?? filtradas[0] ?? null;

  function avisar(t: string) {
    setToast(t);
    setTimeout(() => setToast(null), 1600);
  }
  async function copiarArgumento(c: Celda) {
    setSelId(c.id);
    avisar((await copiar(c.argumento)) ? "Argumento copiado" : "No se pudo copiar: selecciona el texto");
  }

  const selectCls =
    "max-w-full rounded-[10px] border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-700";

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="min-w-0 overflow-hidden rounded-[18px] border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3.5">
          <h2 className="text-[15px] font-bold">Dónde captar</h2>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500">
            {filtradas.length} {filtradas.length === 1 ? "celda" : "celdas"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2.5">
          <div className="inline-flex rounded-[10px] bg-slate-100 p-[3px]" role="group" aria-label="Operación">
            {(["venta", "arriendo"] as const).map((o) => (
              <Link
                key={o}
                href={`/demanda?dias=${dias}&op=${o}`}
                className={`rounded-lg px-3 py-1 text-[13px] ${o === operacion ? "bg-[#0b1526] font-semibold text-white" : "text-slate-700"}`}
              >
                {o === "venta" ? "Venta" : "Arriendo"}
              </Link>
            ))}
          </div>
          <select aria-label="Zona" className={selectCls} value={zona} onChange={(e) => setZona(e.target.value)}>
            <option value="">Todas las zonas</option>
            {opciones.zonas.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          <select aria-label="Tipo" className={selectCls} value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos los tipos</option>
            {opciones.tipos.map((t) => (
              <option key={t} value={t}>
                {tipoLabel(t).replace(/^./, (x) => x.toUpperCase())}
              </option>
            ))}
          </select>
          <select aria-label="Precio" className={selectCls} value={banda} onChange={(e) => setBanda(e.target.value)}>
            <option value="">Todos los precios</option>
            {opciones.bandas.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="hidden grid-cols-[minmax(0,2.3fr)_70px_70px_70px_80px_minmax(110px,1.2fr)_130px] items-center gap-2.5 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] uppercase tracking-wider text-slate-500 lg:grid">
          <span>Zona · tipo · precio</span>
          <span className="text-right">Pedidos {dias} d</span>
          <span className="text-right">Por mes</span>
          <span className="text-right">Tenemos</span>
          <span className="text-right">Por propiedad</span>
          <span>Brecha</span>
          <span />
        </div>

        {filas.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-slate-500">No hay pedidos con estos filtros en el período.</p>
        )}
        {filas.map((c) => {
          const activa = sel?.id === c.id;
          return (
            <div
              key={c.id}
              onClick={() => setSelId(c.id)}
              className={`grid cursor-pointer grid-cols-3 items-center gap-2 border-b border-l-4 border-b-slate-200 px-4 py-3.5 text-[13.5px] lg:grid-cols-[minmax(0,2.3fr)_70px_70px_70px_80px_minmax(110px,1.2fr)_130px] lg:gap-2.5 lg:py-3 ${
                c.caliente ? "border-l-amber-600 bg-orange-50" : "border-l-transparent"
              } ${activa ? "shadow-[inset_0_0_0_2px_#0b1526]" : ""}`}
            >
              <div className="col-span-3 min-w-0 lg:col-span-1">
                <b className="block text-sm">
                  {c.macrozona} · {tipoLabel(c.tipo)}
                </b>
                <small className="text-xs text-slate-500">{c.bandaLabel}</small>
              </div>
              <Num etiqueta={`Pedidos ${dias} d`} valor={c.pedidos} />
              <Num etiqueta="Por mes" valor={c.pedidosMes} />
              <Num etiqueta="Tenemos" valor={c.tenemos} />
              <div className={`font-bold lg:text-right ${c.caliente ? "text-amber-600" : ""}`}>
                <span className="block text-[10.5px] font-medium uppercase tracking-wide text-slate-500 lg:hidden">Por propiedad</span>
                {fmtDecimal(c.porPropiedad)}
              </div>
              <div className="col-span-3 lg:col-span-1">
                <div className="h-2.5 overflow-hidden rounded-[5px] bg-slate-100">
                  <span
                    className={`block h-full rounded-[5px] ${c.caliente ? "bg-amber-600" : "bg-indigo-600"}`}
                    style={{ width: `${Math.round((c.porPropiedad / maxPpp) * 100)}%` }}
                  />
                </div>
              </div>
              <div className="col-span-3 lg:col-span-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    copiarArgumento(c);
                  }}
                  className="w-full rounded-[9px] border border-[#0b1526] bg-white px-2.5 py-2 text-[12.5px] text-[#0b1526] hover:bg-[#0b1526] hover:text-white lg:py-1.5"
                >
                  Copiar argumento
                </button>
              </div>
            </div>
          );
        })}
        {filtradas.length > VISIBLES && (
          <button
            type="button"
            onClick={() => setTodas(!todas)}
            className="w-full border-b border-slate-200 px-4 py-2.5 text-[13px] font-semibold text-indigo-600 hover:bg-slate-50"
          >
            {todas ? "Ver menos" : `Ver todas (${filtradas.length})`}
          </button>
        )}
        <p className="px-4 py-2.5 text-xs text-slate-500">
          <i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[3px] bg-amber-600 align-middle" />
          Resaltadas: {fmtDecimal(mapa.umbralCaliente)} pedidos o más por cada propiedad que tenemos
          {dias === 90 ? "" : ` (30 en 90 días, escalado a ${dias} días)`}.
        </p>
      </section>

      <aside className="min-w-0 overflow-hidden rounded-[18px] border border-slate-200 bg-white">
        <Bloque titulo="Celda seleccionada">
          {sel ? (
            <>
              <p className="text-base font-bold">
                {sel.macrozona} · {tipoLabel(sel.tipo)} · {sel.bandaLabel}
              </p>
              <p className="mt-0.5 text-[12.5px] text-slate-500">
                {sel.pedidos} pedidos en {dias} días · {sel.pedidosMes} al mes · tenemos {sel.tenemos}
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-500">Elige una fila de la tabla.</p>
          )}
        </Bloque>
        {sel && (
          <Bloque titulo="Qué piden">
            {sel.quePiden.barras.map((b) => (
              <div key={b.texto} className="mb-2 grid grid-cols-[1fr_70px_36px] items-center gap-2 text-[12.5px] sm:grid-cols-[1fr_110px_40px]">
                <span>{b.texto}</span>
                <span className="h-2 overflow-hidden rounded bg-slate-100">
                  <span className="block h-full rounded bg-indigo-600" style={{ width: `${b.pct}%` }} />
                </span>
                <span className="text-right font-semibold tabular-nums">{b.pct} %</span>
              </div>
            ))}
            {sel.quePiden.barrios.length > 0 && (
              <>
                <p className="mb-1.5 mt-2.5 text-xs text-slate-500">Barrios más nombrados</p>
                <div className="flex flex-wrap gap-1.5">
                  {sel.quePiden.barrios.map((b) => (
                    <span key={b} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                      {b}
                    </span>
                  ))}
                </div>
              </>
            )}
          </Bloque>
        )}
        {sel && (
          <Bloque titulo="Argumento para el propietario">
            <div className="rounded-[14px] border border-[#c9a24b]/40 bg-[#0b1526] p-3.5 text-[13.5px] leading-relaxed text-slate-200">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[#c9a24b]">WhatsApp listo para copiar</p>
              <p>{sel.argumento}</p>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => copiarArgumento(sel)}
                className="rounded-[9px] border border-[#0b1526] bg-[#0b1526] px-2.5 py-1.5 text-[12.5px] text-[#c9a24b]"
              >
                Copiar
              </button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(sel.argumento)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-[9px] border border-green-600 bg-green-600 px-2.5 py-1.5 text-[12.5px] text-white"
              >
                Abrir WhatsApp
              </a>
            </div>
          </Bloque>
        )}
        <Bloque titulo="Inventario que no calza">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <b className="text-[22px]">
                {mapa.noCalza.n} de {mapa.noCalza.total}
              </b>
              <p className="text-xs text-slate-500">
                propiedades en {operacion} sin pedidos en {dias} días (rurales, sin zona en Wasi)
              </p>
            </div>
            {mapa.noCalza.n > 0 && (
              <button type="button" onClick={() => setVerLista(!verLista)} className="text-[13px] font-semibold text-indigo-600">
                {verLista ? "Ocultar lista" : "Ver lista →"}
              </button>
            )}
          </div>
          {verLista && (
            <ul className="mt-3 max-h-80 divide-y divide-slate-100 overflow-y-auto text-[12.5px]">
              {mapa.noCalza.lista.map((p) => (
                <li key={p.ref} className="py-1.5">
                  <b>{p.ref}</b>
                  {p.titulo ? ` · ${p.titulo}` : ""}
                  <span className="block text-slate-500">
                    {p.zona || "sin zona"} · {p.motivo}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Bloque>
      </aside>

      {toast && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[#0b1526] px-4 py-2 text-[13px] text-white">
          {toast}
        </div>
      )}
    </div>
  );
}

function Num({ etiqueta, valor }: { etiqueta: string; valor: number }) {
  return (
    <div className="font-semibold tabular-nums lg:text-right">
      <span className="block text-[10.5px] font-medium uppercase tracking-wide text-slate-500 lg:hidden">{etiqueta}</span>
      {valor}
    </div>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-slate-200 px-4 py-3.5 last:border-b-0">
      <h3 className="mb-2.5 text-[13px] font-semibold uppercase tracking-wider text-slate-500">{titulo}</h3>
      {children}
    </div>
  );
}
