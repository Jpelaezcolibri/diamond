export type MensajesPorAsesora = {
  id: string;
  nombre: string;
  entrada: number;
  reenvioManual: number;
  salida: number;
};

export function MensajesPorAsesoraPanel({ filas }: { filas: MensajesPorAsesora[] }) {
  if (filas.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        Todavía ninguna asesora recibió un aviso de entrada o salida.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2">Asesora</th>
            <th className="px-4 py-2">Entrada</th>
            <th className="px-4 py-2">↳ reenvió a mano</th>
            <th className="px-4 py-2">Salida</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2 font-medium text-slate-900">{f.nombre}</td>
              <td className="px-4 py-2 text-slate-600">{f.entrada}</td>
              <td className="px-4 py-2 text-slate-600">{f.reenvioManual}</td>
              <td className="px-4 py-2 text-slate-600">{f.salida}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
