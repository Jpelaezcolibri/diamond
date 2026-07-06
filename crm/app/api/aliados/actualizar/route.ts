import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const EDITABLE_FIELDS = ["ref", "titulo", "tipo", "operacion", "precio", "zona", "ciudad", "descripcion", "notas"] as const;

// Edita los campos de una propiedad de aliado — usado cuando la extraccion de
// Claude vino incompleta o con algun dato errado (ver ARCHITECTURE.md).
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json();
  const { id } = body;
  if (!id) return NextResponse.json({ error: "Falta el id" }, { status: 400 });

  const patch: Record<string, string | null> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) patch[field] = body[field] || null;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });
  }
  if (patch.operacion && !["Venta", "Arriendo"].includes(patch.operacion)) {
    return NextResponse.json({ error: "Operación inválida" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("ally_properties")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
