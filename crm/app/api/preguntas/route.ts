// "Responder a Sofi" y "Descartar" de una pregunta de colega (spec
// 2026-10-25 §5.4). Igual que /api/citas/accion: la escritura la hace el bot
// (src/api/crm.js), que verifica que sea del equipo.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callBot } from "@/lib/bot";
import { isAdmin } from "@/lib/auth";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { accion, preguntaId, respuesta } = (await request.json().catch(() => ({}))) as {
    accion?: string;
    preguntaId?: string;
    respuesta?: string;
  };
  if (!preguntaId || (accion !== "responder" && accion !== "descartar")) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  if (accion === "responder" && !String(respuesta || "").trim()) return NextResponse.json({ error: "Escribe la respuesta" }, { status: 400 });

  const r =
    accion === "responder"
      ? await callBot<{ ok: boolean; texto?: string }>("/api/preguntas/responder", { preguntaId, respuesta, authUserId: user.id })
      : await callBot<{ ok: boolean }>("/api/preguntas/descartar", { preguntaId, authUserId: user.id, esAdmin: isAdmin(user) });
  if (!r.ok) {
    const status = [400, 403, 404, 409].includes(r.status) ? r.status : 502;
    return NextResponse.json({ error: r.timeout ? "El bot tardó en responder: revisa en un momento si quedó." : r.error || "El bot no respondió" }, { status });
  }
  return NextResponse.json({ ok: true, texto: (r.data as { texto?: string })?.texto || "Listo." });
}
