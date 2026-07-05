import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/auth";

// Borra un lead con sus conversaciones y mensajes (cascade). Solo admin.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Solo un admin puede borrar leads" }, { status: 403 });
  }

  const { leadId } = await request.json();
  if (!leadId) return NextResponse.json({ error: "Falta leadId" }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin.from("leads").delete().eq("id", leadId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
