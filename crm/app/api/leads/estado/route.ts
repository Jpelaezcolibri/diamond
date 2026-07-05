import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/auth";
import { ESTADOS } from "@/lib/types";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { leadId, estado } = await request.json();
  if (!leadId || !ESTADOS.includes(estado)) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const admin = createAdminClient();
  const admin_ = isAdmin(user);
  const now = new Date().toISOString();

  // Mover un lead sin dueño equivale a empezar a atenderlo: queda bajo su
  // owner. Los admins triagean el tablero libremente y NO se auto-asignan
  // los leads que muevan. El update es condicional y atómico para evitar que
  // dos movimientos simultáneos se pisen el ownership entre sí.
  let query = admin
    .from("leads")
    .update(
      admin_
        ? { estado, updated_at: now }
        : { estado, updated_at: now, owner_id: user.id, owner_assigned_at: now }
    )
    .eq("id", leadId);
  if (!admin_) {
    query = query.or(`owner_id.is.null,owner_id.eq.${user.id}`);
  }

  const { data, error } = await query.select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) {
    const { data: lead } = await admin.from("leads").select("id").eq("id", leadId).maybeSingle();
    return lead
      ? NextResponse.json({ error: "Este lead ya está siendo atendido por otro asesor" }, { status: 403 })
      : NextResponse.json({ error: "Lead no encontrado" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
