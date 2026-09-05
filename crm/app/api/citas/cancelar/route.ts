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

  // El `timeout` viaja al cliente a propósito (Juan, 2026-09-04): cancelar
  // cambia el registro en el PRIMER instante y después sigue con la cascada de
  // avisos, que en el peor caso —los dos canales caídos, justo el que esta
  // rama existe para manejar— pasa de los 60 s del callBot. Si el navegador no
  // puede distinguir ese corte de un fallo real, termina afirmando que la cita
  // sigue en pie cuando en realidad quedó cancelada.
  const r = await callBot("/api/citas/cancelar", { leadId, motivo: motivo || null });
  return r.ok
    ? NextResponse.json(r.data)
    : NextResponse.json({ error: r.error, timeout: r.timeout }, { status: r.status });
}
