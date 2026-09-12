import type { Periodo } from "@/lib/amoblados";

export type PropiedadArriendo = {
  ref: string;
  titulo: string | null;
  zona: string | null;
  precio: string | null;
  amoblada: boolean | null;
  periodo: Periodo;
  pedidos: number;
};

// Qué le falta a cada propiedad en Wasi para que Sofi y el radar la ofrezcan
// bien. Las alertas se van solas cuando se corrige allá (sync de las 7 p. m.).
function alertas(p: PropiedadArriendo): { texto: string; tono: string }[] {
  const a: { texto: string; tono: string }[] = [];
  if (p.amoblada !== true) a.push({ texto: "⚠ falta marcar Amoblado en Wasi", tono: "text-amber-700" });
  if (p.periodo === "noche") a.push({ texto: "⚠ se renta por noche: el sistema la trata como mensual", tono: "text-rose-700" });
  if (p.periodo === "sin_periodo") a.push({ texto: "⚠ no dice si el precio es por mes o por noche", tono: "text-rose-700" });
  return a;
}

export default function InventarioAmoblado({ propiedades }: { propiedades: PropiedadArriendo[] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="font-display text-sm font-bold text-slate-900">Inventario en arriendo</h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{propiedades.length} en Wasi</span>
      </div>
      {propiedades.length === 0 ? (
        <p className="px-4 py-4 text-sm italic text-slate-400">No hay propiedades en arriendo disponibles.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {propiedades.map((p) => {
            const avisos = alertas(p);
            return (
              <li key={p.ref} className="flex items-start justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <p>
                    <b className="font-mono">{p.ref}</b> · {p.zona || "sin zona"}
                  </p>
                  <p className="truncate text-xs text-slate-500" title={p.titulo || ""}>{p.titulo}</p>
                  {avisos.length === 0 ? (
                    <p className="text-xs text-slate-500">✓ amoblado · mensual</p>
                  ) : (
                    avisos.map((x) => (
                      <p key={x.texto} className={`text-xs ${x.tono}`}>{x.texto}</p>
                    ))
                  )}
                </div>
                <div className="whitespace-nowrap text-right">
                  <span className="tabular-nums">{p.precio || "—"}</span>
                  <p className={`text-xs ${p.pedidos > 0 ? "text-slate-600" : "text-slate-400"}`}>
                    {p.pedidos} pedido{p.pedidos === 1 ? "" : "s"}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
        Las alertas salen de lo que dice Wasi y se van solas cuando se corrige allá (sync de las 7 p. m.).
      </p>
    </section>
  );
}
