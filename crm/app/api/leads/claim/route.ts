import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/auth";

// Un asesor "atiende" un lead sin dueño: queda bajo su owner para poder
// editarlo. Si ya tiene owner, solo un admin puede tomarlo. El update es
// condicional y atómico (una sola sentencia) para que dos clics simultáneos
// no puedan robarse el ownership entre sí.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { leadId } = await request.json();
  if (!leadId) return NextResponse.json({ error: "Falta leadId" }, { status: 400 });

  const admin = createAdminClient();
  let query = admin
    .from("leads")
    .update({ owner_id: user.id, owner_assigned_at: new Date().toISOString() })
    .eq("id", leadId);
  if (!isAdmin(user)) {
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
