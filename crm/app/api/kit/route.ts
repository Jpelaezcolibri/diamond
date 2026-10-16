import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callBot } from "@/lib/bot";

// Proxy autenticado al kit de publicacion del bot (spec 2026-10-16 §3.2).
// Cualquier usuario logueado del CRM puede usarlo: no hace falta ser admin.
// El userId que se registra sale de la sesion, nunca del browser.
export const maxDuration = 30;

// Por debajo de maxDuration: callBot espera 60 s por defecto y Vercel cortaria
// la funcion antes de devolver un error legible.
const BOT_OPTS = { timeoutMs: 25_000 };

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  // Un body que no sea objeto (null, numero, texto) se trata como vacio.
  const raw = (await request.json().catch(() => null)) ?? {};
  const body = (typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const action = body.action as "propiedades" | "post" | "registrar";

  const llamada =
    action === "propiedades"
      ? callBot("/api/kit/propiedades", { operacion: body.operacion, zona: body.zona }, BOT_OPTS)
      : action === "post"
        ? callBot("/api/kit/post", { ref: body.ref, comision: body.comision !== false }, BOT_OPTS)
        : action === "registrar"
          ? callBot("/api/kit/registrar", { ref: body.ref, accion: body.accion, userId: user.id }, BOT_OPTS)
          : null;
  if (!llamada) return NextResponse.json({ error: "Acción inválida" }, { status: 400 });

  const r = await llamada;
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}
