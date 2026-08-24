import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { userRole, userNombre } from "@/lib/auth";
import { callBot } from "@/lib/bot";

// Proxy autenticado al Centro de Comando del bot. Valida la sesion del CRM y
// pasa la identidad (viewerUid, role) al bot; el bot resuelve el alcance. El
// modelo nunca recibe el alcance del browser.

// SIN ESTO EL CHAT DE SOFI PARECIA ROTO (2026-08-24). Una funcion de Vercel sin
// maxDuration se corta a los 10 segundos, y una pregunta que le hace usar
// herramientas ("por que se estan rechazando los pedidos") tarda ~45 s medidos
// en produccion: Vercel mataba la funcion, el chat mostraba "El bot no
// respondio" y Sofi contestaba bien medio minuto despues, sin nadie del otro
// lado. Los routes de marketing de este mismo CRM ya lo declaran (300 s en
// generate, 120 en regenerate) — este se habia quedado sin el.
export const maxDuration = 300;
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const action = body.action as "session" | "message" | "close" | "history";
  const identity = { viewerUid: user.id, role: userRole(user), userName: userNombre(user) };

  if (action === "session") {
    const r = await callBot("/api/assistant/session", identity);
    return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
  }

  if (action === "message") {
    if (!body.sessionId || !body.text?.trim()) {
      return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
    }
    // Un turno de chat puede encadenar varias herramientas; 45 s medidos en
    // produccion para una sola pregunta. El default de 60 s dejaba afuera
    // cualquier consulta un poco mas pesada que esa.
    const r = await callBot(
      "/api/assistant/message",
      { ...identity, sessionId: body.sessionId, text: body.text },
      { timeoutMs: 240_000 }
    );
    return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
  }

  if (action === "history") {
    if (!body.before) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
    const r = await callBot("/api/assistant/history", { ...identity, before: body.before });
    return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
  }

  if (action === "close") {
    if (!body.sessionId) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
    const r = await callBot("/api/assistant/close", { ...identity, sessionId: body.sessionId });
    return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
  }

  return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
}
