import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { callBot } from "@/lib/bot";

// Prender o apagar el carril de COMPRA (el cruce contra mandatos).
//
// Solo admin, mismo criterio que /api/grupos/radar: apagarlo cambia a qué le
// dedica el día TODO el equipo. Es una decisión de foco comercial, no una
// tarea de operación.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Solo un administrador puede apagar el carril de compra" }, { status: 403 });
  }

  const { activo } = await request.json().catch(() => ({}));
  if (typeof activo !== "boolean") {
    return NextResponse.json({ error: "Falta 'activo'" }, { status: 400 });
  }

  const r = await callBot("/api/grupos/mandatos", { activo });
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}
