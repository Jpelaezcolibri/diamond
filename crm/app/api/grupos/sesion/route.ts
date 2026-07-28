import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { userRole } from "@/lib/auth";
import { callBot } from "@/lib/bot";

// Vincular la línea del asesor e importar sus grupos. Solo admin: vincular un
// dispositivo a la línea de otra persona no es una preferencia de trabajo.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (userRole(user) !== "admin") {
    return NextResponse.json({ error: "Solo un administrador puede vincular una línea" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const accion = body.accion as "crear" | "estado" | "importar";

  if (accion === "crear") {
    const r = await callBot("/api/grupos/sesion", { nombre: body.nombre, advisorId: body.advisorId || null });
    return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
  }

  if (accion === "estado") {
    const r = await callBot("/api/grupos/sesion/estado", { nombre: body.nombre });
    return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
  }

  if (accion === "importar") {
    const r = await callBot("/api/grupos/importar", { sesion: body.nombre });
    return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
  }

  return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
}
