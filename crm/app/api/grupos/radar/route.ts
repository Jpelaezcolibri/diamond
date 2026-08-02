import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { callBot } from "@/lib/bot";

// Prender o apagar el motor de Radar.
//
// Solo admin, a diferencia de /api/grupos/senal: marcar una señal es trabajo
// diario del asesor, pero apagar el motor deja sin digest a TODO el equipo y
// detiene el procesamiento de la organización entera. Es una decisión de
// negocio, no de operación.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Solo un administrador puede apagar el motor" }, { status: 403 });
  }

  const { activo } = await request.json().catch(() => ({}));
  if (typeof activo !== "boolean") {
    return NextResponse.json({ error: "Falta 'activo'" }, { status: 400 });
  }

  const r = await callBot("/api/grupos/radar", { activo });
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}
