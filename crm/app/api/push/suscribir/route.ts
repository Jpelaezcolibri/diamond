// Guarda la suscripcion push del asesor que esta usando el CRM (App de
// asesores F1). RLS: solo puede insertar con su propio advisor_id.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { miAsesor } from "@/lib/mi-asesor";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  const asesor = await miAsesor(supabase, user);
  if (!asesor) return NextResponse.json({ error: "tu usuario no está ligado a un asesor" }, { status: 400 });

  const body = (await request.json().catch(() => null)) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | null;
  if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json({ error: "suscripción inválida" }, { status: 400 });
  }
  // Mismo endpoint de antes (reinstalo, cambio de usuario): se reemplaza.
  await supabase.from("push_suscripciones").delete().eq("endpoint", body.endpoint);
  const { error } = await supabase.from("push_suscripciones").insert({
    advisor_id: asesor.id,
    endpoint: body.endpoint,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
