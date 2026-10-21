// "Marcar atendida" de la pestaña Publicaciones (spec
// 2026-10-20-publicaciones-y-respuestas §6). Igual que /api/citas/accion: la
// escritura la hace el bot (src/api/crm.js), que verifica que sea del equipo.
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

  const { id } = (await request.json().catch(() => ({}))) as { id?: string };
  if (!id) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  const r = await callBot<{ ok: boolean; ya?: boolean; error?: string }>("/api/respuestas/atendida", {
    id,
    authUserId: user.id,
    esAdmin: isAdmin(user),
  });
  if (!r.ok) {
    const status = r.status === 403 || r.status === 404 ? r.status : 502;
    return NextResponse.json({ error: r.error || "El bot no respondió" }, { status });
  }
  return NextResponse.json({ ok: true, ya: Boolean(r.data?.ya) });
}
