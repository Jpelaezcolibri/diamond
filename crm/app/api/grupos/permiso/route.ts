import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { callBot } from "@/lib/bot";

// Los dos permisos de un grupo, que NO son el mismo:
//
//   escuchar   sus mensajes entran al radar y alimentan el digest
//   responder  además, el bot publica dentro del grupo
//
// Se piden por separado a propósito. Importar una línea trae de golpe todos sus
// grupos —la asesora de julio tenía 80— y si escuchar implicara responder, un
// clic pondría al bot a hablar en ochenta grupos gremiales a la vez.
//
// Solo admin: un mensaje publicado ante 80 inmobiliarias competidoras se ve una
// vez y no se borra.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!isAdmin(user)) {
    return NextResponse.json(
      { error: "Solo un administrador puede cambiar los permisos de un grupo" },
      { status: 403 }
    );
  }

  const { groupId, escuchar, responder } = await request.json().catch(() => ({}));
  if (!groupId) return NextResponse.json({ error: "Falta el grupo" }, { status: 400 });

  // Apagar la escucha apaga también la respuesta: dejar `responde` en true sobre
  // un grupo que ya no se escucha guarda un permiso listo para reactivarse solo
  // el día que alguien vuelva a prenderlo.
  if (typeof escuchar === "boolean") {
    if (!escuchar) {
      const apagar = await callBot("/api/grupos/responde", { groupId, responde: false });
      if (!apagar.ok) return NextResponse.json({ error: apagar.error }, { status: apagar.status });
    }
    const r = await callBot("/api/grupos/modo", { groupId, modo: escuchar ? "sombra" : "ignorar" });
    return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
  }

  if (typeof responder === "boolean") {
    const r = await callBot("/api/grupos/responde", { groupId, responde: responder });
    return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
  }

  return NextResponse.json({ error: "Falta 'escuchar' o 'responder'" }, { status: 400 });
}
