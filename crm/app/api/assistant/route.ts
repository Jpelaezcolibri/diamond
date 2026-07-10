import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { userRole, userNombre } from "@/lib/auth";
import { callBot } from "@/lib/bot";

// Proxy autenticado al Centro de Comando del bot. Valida la sesion del CRM y
// pasa la identidad (viewerUid, role) al bot; el bot resuelve el alcance. El
// modelo nunca recibe el alcance del browser.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const action = body.action as "session" | "message" | "close";
  const identity = { viewerUid: user.id, role: userRole(user), userName: userNombre(user) };

  if (action === "session") {
    const r = await callBot("/api/assistant/session", identity);
    return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
  }

  if (action === "message") {
    if (!body.sessionId || !body.text?.trim()) {
      return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
    }
    const r = await callBot("/api/assistant/message", { ...identity, sessionId: body.sessionId, text: body.text });
    return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
  }

  if (action === "close") {
    if (!body.sessionId) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
    const r = await callBot("/api/assistant/close", { ...identity, sessionId: body.sessionId });
    return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
  }

  return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
}
