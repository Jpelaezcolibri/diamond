import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { userRole } from "@/lib/auth";
import { callBot } from "@/lib/bot";

const MODOS = ["ignorar", "sombra", "sugerir"];

// Prender o apagar la escucha de un grupo.
//
// Va por el bot (callBot) y no por Supabase directo a proposito: el modo de un
// grupo es la llave de la privacidad del asesor cuya linea esta vinculada, y
// conviene que pase por un solo camino autenticado y auditable. Solo admin: no
// es una preferencia de trabajo, es una decision sobre datos de terceros.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (userRole(user) !== "admin") {
    return NextResponse.json({ error: "Solo un administrador puede cambiar la escucha de un grupo" }, { status: 403 });
  }

  const { id, modo } = await request.json().catch(() => ({}));
  if (!id || !MODOS.includes(modo)) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const r = await callBot(`/api/grupos/${id}/modo`, { modo });
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}
