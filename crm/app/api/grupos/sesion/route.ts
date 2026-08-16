import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { callBot } from "@/lib/bot";

// Vincular una línea a la escucha en vivo, ver su estado, volver a parearla e
// importar sus grupos.
//
// SOLO ADMIN, sin excepción. Vincular una línea la expone a que WhatsApp la
// banee: el 2026-07-30 pasó exactamente eso con la línea de una asesora, y ese
// montaje solo leía. No es trabajo diario de nadie, es una decisión que se toma
// una vez y con la cabeza fría.
//
// Las cuatro acciones viven en una sola ruta porque la pantalla las usa juntas
// y el estado se consulta en bucle mientras se espera el QR.
const RUTAS: Record<string, string> = {
  crear: "/api/grupos/sesion",
  estado: "/api/grupos/sesion/estado",
  // Reintento manual, una sola vez. No hay nada automático detrás: si no la
  // levanta, hay que mirar por qué en vez de volver a apretar.
  reintentar: "/api/grupos/sesion/reintentar",
  revincular: "/api/grupos/sesion/revincular",
  importar: "/api/grupos/importar",
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!isAdmin(user)) {
    return NextResponse.json(
      { error: "Solo un administrador puede vincular una línea de WhatsApp" },
      { status: 403 }
    );
  }

  const { accion, nombre, advisorId } = await request.json().catch(() => ({}));
  const ruta = RUTAS[accion as string];
  if (!ruta) return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  if (!nombre) return NextResponse.json({ error: "Falta el nombre de la sesión" }, { status: 400 });

  // `importar` nombra el parámetro distinto en el bot; el resto usa `nombre`.
  const cuerpo =
    accion === "importar"
      ? { sesion: nombre }
      : { nombre, advisorId: advisorId || null, rol: "dedicada" };

  const r = await callBot(ruta, cuerpo);
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}
