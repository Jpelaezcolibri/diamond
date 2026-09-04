import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callBot } from "@/lib/bot";

// Cancelar una cita (Juan, 2026-09-04). Cualquiera del equipo logueado puede
// hacerlo — a diferencia de vincular una línea, que es solo admin: cancelar
// una visita es trabajo diario del asesor que la tiene, no una decisión de
// riesgo.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { leadId, motivo } = await request.json().catch(() => ({}));
  if (!leadId) return NextResponse.json({ error: "Falta leadId" }, { status: 400 });

  const r = await callBot("/api/citas/cancelar", { leadId, motivo: motivo || null });
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}
