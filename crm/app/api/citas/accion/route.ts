// Confirmar u "Otro horario" de una visita desde el chat del CRM (plan 6,
// 2026-10-07). La logica vive en el bot (src/lib/confirmar-cita.js): avisa al
// cliente/colega por el numero de Sofi con el alias del asesor.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callBot } from "@/lib/bot";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { leadId, accion } = (await request.json().catch(() => ({}))) as { leadId?: string; accion?: string };
  if (!leadId || (accion !== "confirmar" && accion !== "otro")) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }
  const r = await callBot<{ ok: boolean; texto?: string; error?: string }>("/api/citas/accion", { leadId, accion, authUserId: user.id });
  if (!r.ok) return NextResponse.json({ error: r.error || "El bot no respondió" }, { status: 502 });
  return NextResponse.json({ ok: true, texto: r.data?.texto || null });
}
