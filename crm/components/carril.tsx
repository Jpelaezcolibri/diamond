import type { ReactNode } from "react";

// Contenedor de cada carril de trabajo de /grupos (rediseño 2026-09-02):
// Entrada (pedidos de colegas contra inventario propio) y Salida (ofertas de
// colegas contra mandatos de compra), lado a lado. El cuerpo tiene scroll
// propio para que las dos columnas queden alineadas aunque una tenga 40
// tarjetas y la otra 3.
//
// Las clases van completas en la tabla (no interpoladas): Tailwind 4 solo
// genera las que encuentra escritas tal cual en el fuente.
const TONO = {
  entrada: {
    flecha: "→",
    etiqueta: "Entrada",
    tag: "bg-indigo-600 text-white",
    head: "bg-indigo-50 border-indigo-100",
    contador: "text-indigo-700",
  },
  salida: {
    flecha: "←",
    etiqueta: "Salida",
    tag: "bg-emerald-600 text-white",
    head: "bg-emerald-50 border-emerald-100",
    contador: "text-emerald-700",
  },
} as const;

export default function Carril({
  tono,
  titulo,
  descripcion,
  contador,
  herramientas,
  children,
}: {
  tono: keyof typeof TONO;
  titulo: string;
  descripcion: string;
  contador: number;
  /** Fila de filtros o acciones justo debajo del encabezado. */
  herramientas?: ReactNode;
  children: ReactNode;
}) {
  const t = TONO[tono];
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <header className={`flex items-start justify-between gap-3 border-b px-4 py-3 ${t.head}`}>
        <div className="min-w-0">
          <h2 className="font-display flex items-center gap-2 text-base font-bold text-slate-900">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.12em] ${t.tag}`}>
              {t.flecha} {t.etiqueta}
            </span>
            {titulo}
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">{descripcion}</p>
        </div>
        <span className={`font-display shrink-0 text-2xl font-extrabold tabular-nums ${t.contador}`}>{contador}</span>
      </header>
      {herramientas && <div className="border-b border-slate-100 px-4 py-2">{herramientas}</div>}
      <div className="@container max-h-[44rem] overflow-y-auto p-4">{children}</div>
    </section>
  );
}
