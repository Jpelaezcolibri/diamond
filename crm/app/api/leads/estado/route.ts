import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
  const { error } = await admin
    .from("leads")
    .update({ estado, updated_at: new Date().toISOString() })
    .eq("id", leadId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
