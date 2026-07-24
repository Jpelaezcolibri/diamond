// Banner compartido para cuando una query de Supabase falla en una pagina
// server (ver crm/lib/fetch-safe.ts). Antes un error de BD se veia identico
// a "no hay datos" — este banner distingue explicitamente ambos casos.
export default function ErrorBanner({ message }: { message?: string | null }) {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <span className="text-lg leading-none">⚠️</span>
      <div>
        <p className="font-medium">No se pudo cargar la información completa.</p>
        <p className="text-xs text-red-700/80">
          Puede haber datos ocultos por un error temporal de la base de datos. Intenta recargar en unos minutos.
          {message ? ` (${message})` : ""}
        </p>
      </div>
    </div>
  );
}
