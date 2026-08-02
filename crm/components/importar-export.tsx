"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Subir exports .txt de grupos de WhatsApp.
//
// Es la vía segura para leer los grupos: exportar el chat es una función
// nativa de WhatsApp, así que nada se conecta a la línea de nadie. Después del
// baneo del 30-jul esa es toda la diferencia que importa.

type Fase = "leyendo" | "filtrando" | "clasificando" | "cruzando" | "guardando" | "listo" | "error";

type Stats = {
  archivos: number;
  crudos: number;
  fueraDeCorte: number;
  repetidos: number;
  prefiltrados: number;
  aClasificar: number;
  demandas: number;
  ofertas: number;
  señales: number;
  duplicadas: number;
  ofertasArchivadas: number;
  demandasConMatch: number;
  lotesFallidos: number;
  costoUsd: number;
  grupos: { nombre: string; mensajes: number }[];
};

type Job = {
  estado: "en_curso" | "listo" | "error";
  fase: Fase;
  procesados: number;
  total: number;
  resultado: Stats | null;
  error: string | null;
};

const RANGOS = [
  { dias: 7, etiqueta: "Última semana" },
  { dias: 30, etiqueta: "Último mes" },
  { dias: 90, etiqueta: "Últimos 3 meses" },
  { dias: 0, etiqueta: "Todo el historial" },
];

const FASES: Record<Fase, string> = {
  leyendo: "Leyendo los archivos",
  filtrando: "Descartando el ruido",
  clasificando: "Clasificando con IA",
  cruzando: "Cruzando contra el inventario",
  guardando: "Guardando las señales",
  listo: "Listo",
  error: "Error",
};

export default function ImportarExport() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [archivos, setArchivos] = useState<File[]>([]);
  const [dias, setDias] = useState(30);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const jobId = useRef<string | null>(null);

  // Sondeo del progreso. El import corre en el bot y puede tardar minutos.
  useEffect(() => {
    if (!jobId.current || job?.estado !== "en_curso") return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/grupos/export?jobId=${jobId.current}`).catch(() => null);
      if (!res?.ok) return;
      const body: Job = await res.json();
      setJob(body);
      if (body.estado !== "en_curso") {
        clearInterval(t);
        jobId.current = null;
        // Las señales nuevas viven en la página, que es un server component.
        if (body.estado === "listo") startTransition(() => router.refresh());
      }
    }, 2000);
    return () => clearInterval(t);
  }, [job?.estado, router]);

  async function subir() {
    if (archivos.length === 0) return;
    setError(null);
    setSubiendo(true);

    const form = new FormData();
    for (const f of archivos) form.append("files", f, f.name);
    form.append("dias", String(dias));

    const res = await fetch("/api/grupos/export", { method: "POST", body: form }).catch(() => null);
    setSubiendo(false);

    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => ({})) : {};
      setError(body.error || "No se pudo subir el archivo");
      return;
    }
    const { jobId: id } = await res.json();
    jobId.current = id;
    setJob({ estado: "en_curso", fase: "leyendo", procesados: 0, total: archivos.length, resultado: null, error: null });
    setArchivos([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  const enCurso = job?.estado === "en_curso";
  const pct = job && job.total > 0 ? Math.round((job.procesados / job.total) * 100) : 0;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">Cargar grupos</h2>
        <span className="text-xs text-slate-500">Sin riesgo para ninguna línea</span>
      </div>
      <p className="mb-4 text-sm text-slate-600">
        En WhatsApp, abrí el grupo y andá a{" "}
        <span className="font-medium text-slate-800">⋮ → Más → Exportar chat → Sin archivos</span>.
        Subí acá el <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">.txt</code> que
        se genera. Podés subir varios grupos de una.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-700">Archivos</label>
          <input
            ref={inputRef}
            type="file"
            accept=".txt,text/plain"
            multiple
            disabled={enCurso}
            onChange={(e) => setArchivos(Array.from(e.target.files || []))}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-sm file:text-slate-700 disabled:opacity-50"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Qué tanto leer</label>
          <select
            value={dias}
            disabled={enCurso}
            onChange={(e) => setDias(Number(e.target.value))}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
          >
            {RANGOS.map((r) => (
              <option key={r.dias} value={r.dias}>{r.etiqueta}</option>
            ))}
          </select>
        </div>
        <button
          onClick={subir}
          disabled={archivos.length === 0 || subiendo || enCurso}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {subiendo ? "Subiendo…" : `Analizar${archivos.length > 0 ? ` ${archivos.length}` : ""}`}
        </button>
      </div>

      {dias === 0 && (
        <p className="mt-2 text-xs text-amber-700">
          Todo el historial puede ser caro y casi nunca sirve: una demanda de hace seis meses ya
          se resolvió y una oferta de hace seis meses ya se vendió.
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {enCurso && (
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-slate-600">
            <span>{FASES[job.fase] || job.fase}…</span>
            <span>{job.total > 0 ? `${job.procesados}/${job.total}` : ""}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-slate-800 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {job?.estado === "error" && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{job.error}</p>
      )}

      {job?.estado === "listo" && job.resultado && <Resumen s={job.resultado} />}
    </section>
  );
}

function Resumen({ s }: { s: Stats }) {
  const analizados = s.crudos - s.fueraDeCorte - s.repetidos;
  return (
    <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Dato valor={s.señales} etiqueta="señales nuevas" destacado />
        <Dato valor={s.demandasConMatch} etiqueta="pedidos que calzan" destacado />
        <Dato valor={s.ofertasArchivadas} etiqueta="propiedades a la red" />
        <Dato valor={`US$${s.costoUsd.toFixed(3)}`} etiqueta="costo de IA" />
      </div>

      <p className="text-xs leading-relaxed text-slate-600">
        De <strong>{s.crudos.toLocaleString("es-CO")}</strong> mensajes:{" "}
        {s.fueraDeCorte > 0 && <>{s.fueraDeCorte.toLocaleString("es-CO")} fuera del rango, </>}
        {s.repetidos > 0 && <>{s.repetidos.toLocaleString("es-CO")} repetidos en varios grupos, </>}
        {s.prefiltrados.toLocaleString("es-CO")} descartados por ruido.
        Se analizaron <strong>{Math.max(analizados, 0).toLocaleString("es-CO")}</strong> y quedaron{" "}
        {s.demandas} {s.demandas === 1 ? "pedido" : "pedidos"} y {s.ofertas}{" "}
        {s.ofertas === 1 ? "propiedad" : "propiedades"} de colegas.
        {s.duplicadas > 0 && <> {s.duplicadas} ya las tenías registradas.</>}
      </p>

      {s.lotesFallidos > 0 && (
        <p className="mt-2 text-xs text-amber-700">
          {s.lotesFallidos} {s.lotesFallidos === 1 ? "lote falló" : "lotes fallaron"} y no se
          analizaron. Volvé a subir el mismo archivo: lo ya procesado no se repite.
        </p>
      )}

      {s.grupos?.length > 1 && (
        <p className="mt-2 text-xs text-slate-500">
          {s.grupos.map((g) => `${g.nombre} (${g.mensajes})`).join(" · ")}
        </p>
      )}
    </div>
  );
}

function Dato({ valor, etiqueta, destacado }: { valor: number | string; etiqueta: string; destacado?: boolean }) {
  return (
    <div>
      <div className={`text-xl font-semibold ${destacado ? "text-slate-900" : "text-slate-600"}`}>{valor}</div>
      <div className="text-xs text-slate-500">{etiqueta}</div>
    </div>
  );
}
