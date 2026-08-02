export type Grupo = {
  id: string;
  jid: string;
  nombre: string | null;
  modo: "ignorar" | "sombra" | "sugerir";
  activo: boolean;
  created_at: string;
};

// De dónde salió cada grupo. El prefijo del jid lo dice: los que se crean al
// subir un export llevan "export:", el buzón de reenvíos lleva "reenvio:", y
// los que quedaron de la escucha en vivo (retirada tras el baneo del 30-jul)
// tienen un jid real de WhatsApp.
function origen(jid: string) {
  if (jid.startsWith("export:")) return { etiqueta: "export", clase: "bg-sky-50 text-sky-700" };
  if (jid.startsWith("reenvio:")) return { etiqueta: "reenvío", clase: "bg-violet-50 text-violet-700" };
  return { etiqueta: "histórico", clase: "bg-slate-100 text-slate-500" };
}

export default function GruposPanel({ grupos }: { grupos: Grupo[] }) {
  if (grupos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        Todavía no cargaste ningún grupo. Subí arriba el <code>.txt</code> que exporta WhatsApp
        y aparece acá.
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
      {grupos.map((g) => {
        const o = origen(g.jid);
        return (
          <div key={g.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <p className="min-w-0 truncate font-medium text-slate-900">
              {g.nombre || "Grupo sin nombre"}
            </p>
            <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${o.clase}`}>
              {o.etiqueta}
            </span>
          </div>
        );
      })}
    </div>
  );
}
