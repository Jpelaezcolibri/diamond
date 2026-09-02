export type MensajesPorAsesora = {
  id: string;
  nombre: string;
  entrada: number;
  reenvioManual: number;
  salida: number;
};

export function MensajesPorAsesoraPanel({
  filas,
  embebido = false,
}: {
  filas: MensajesPorAsesora[];
  /** Sin borde propio: vive dentro de una tarjeta que ya lo tiene. */
  embebido?: boolean;
}) {
  if (filas.length === 0) {
    return (
      <div className={`p-6 text-center text-sm text-slate-500 ${embebido ? "" : "rounded-lg border border-dashed border-slate-300"}`}>
        Todavía ninguna asesora recibió un aviso de entrada o salida.
      </div>
    );
  }
  // La barrita al lado del nombre es proporcional a la entrada de la que
  // más recibió: de un vistazo se ve quién carga con más avisos.
  const maxEntrada = Math.max(1, ...filas.map((f) => f.entrada));
  return (
    <div className={`overflow-x-auto bg-white ${embebido ? "" : "rounded-lg border border-slate-200"}`}>
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-4 py-2">Asesora</th>
            <th className="px-4 py-2 text-right">Entrada</th>
            <th className="px-4 py-2 text-right">a mano</th>
            <th className="px-4 py-2 text-right">Salida</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2 font-medium text-slate-900">
                {f.nombre}
                <span
                  className="ml-2 inline-block h-1.5 rounded-full bg-indigo-500 align-middle"
                  style={{ width: `${Math.round((f.entrada / maxEntrada) * 48)}px` }}
                />
              </td>
              <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-800">{f.entrada}</td>
              <td className="px-4 py-2 text-right tabular-nums text-amber-700">{f.reenvioManual}</td>
              <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-800">{f.salida}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
