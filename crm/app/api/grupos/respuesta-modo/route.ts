import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { callBot } from "@/lib/bot";

const MODOS = ["sombra", "asistido", "auto"] as const;

// Cambia el modo de respuesta del radar en los grupos gremiales (org
// entera). Nombre distinto de /api/grupos/modo a proposito: esa ruta ya
// existe para el modo de una LINEA vinculada puntual, un concepto
// totalmente distinto (ver src/api/crm.js).
//
// Solo admin: pasar a 'auto' significa que el bot publica solo en un grupo
// con 80 competidores mirando, sin que nadie de Diamond lo revise antes — la
// misma clase de decision que ya exige admin en /api/grupos/radar.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Solo un administrador puede cambiar el modo de respuesta" }, { status: 403 });
  }

  const { modo } = await request.json().catch(() => ({}));
  if (!MODOS.includes(modo)) {
    return NextResponse.json({ error: `Modo invalido. Debe ser: ${MODOS.join(", ")}` }, { status: 400 });
  }

  const r = await callBot("/api/grupos/respuesta-modo", { modo });
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}
