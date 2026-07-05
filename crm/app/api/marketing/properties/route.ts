import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDefaultOrgId } from "@/lib/marketing";

/**
 * Lista propiedades disponibles para el picker de "Nueva publicacion" — la
 * unica via de generar contenido era una novedad pendiente del Dashboard;
 * si esa lista esta vacia (ej. backlog ya marcado procesado) no habia forma
 * de elegir una propiedad ya sincronizada para generarle una publicacion.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const orgId = await getDefaultOrgId(supabase);
  if (!orgId) return NextResponse.json({ properties: [] });

  const [{ data: properties }, { data: activePublications }] = await Promise.all([
    supabase
      .from("properties")
      .select("id,ref,titulo,zona,ciudad,operacion,precio")
      .eq("org_id", orgId)
      .eq("disponible", true)
      .order("titulo"),
    supabase.from("publications").select("id,property_id,status").eq("org_id", orgId).neq("status", "archived"),
  ]);

  const publicationByPropertyId = new Map((activePublications || []).map((p) => [p.property_id, { id: p.id, status: p.status }]));

  const result = (properties || []).map((p) => ({
    ...p,
    existingPublication: publicationByPropertyId.get(p.id) ?? null,
  }));

  return NextResponse.json({ properties: result });
}
