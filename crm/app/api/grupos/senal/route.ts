import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callBot } from "@/lib/bot";

const ESTADOS = ["nuevo", "gestionado", "descartado"];

// Marcar un pedido de un colega como revisado, descartado, o de vuelta a
// pendiente.
//
// A diferencia de /api/grupos/modo, esto NO es solo de admin: marcar lo que ya
// se miró es trabajo diario del asesor, no una decisión sobre la privacidad de
// la línea de nadie. No borra nada — solo cambia el estado.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id, estado } = await request.json().catch(() => ({}));
  if (!id || !ESTADOS.includes(estado)) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const r = await callBot("/api/grupos/senal/estado", { id, estado });
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}
