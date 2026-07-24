// Envuelve una query de Supabase para no perder el error en silencio.
// Antes las paginas server (inbox, leads, kanban, aliados, calendario)
// destructuraban solo `data`: si la query fallaba (RLS mal configurado,
// columna de una migracion pendiente, Supabase caido) `data` quedaba
// null/vacio y la pantalla se veia identica a "sin datos" — un asesor no
// podia distinguir "no hay leads" de "la base esta caida". Usar junto con
// <ErrorBanner /> (crm/components/error-banner.tsx).
export async function fetchSafe<T>(
  query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string
): Promise<{ data: T[]; hasError: boolean; message: string | null }> {
  const { data, error } = await query;
  if (error) {
    console.error(`[fetchSafe:${label}]`, error.message);
    return { data: [], hasError: true, message: error.message };
  }
  return { data: data ?? [], hasError: false, message: null };
}
