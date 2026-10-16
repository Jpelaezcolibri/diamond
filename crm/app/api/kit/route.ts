import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callBot } from "@/lib/bot";

// Proxy autenticado al kit de publicacion del bot (spec 2026-10-16 §3.2).
// Cualquier usuario logueado del CRM puede usarlo: no hace falta ser admin.
// El userId que se registra sale de la sesion, nunca del browser.
export const maxDuration = 30;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const action = body.action as "propiedades" | "post" | "registrar";

  const llamada =
    action === "propiedades"
      ? callBot("/api/kit/propiedades", { operacion: body.operacion, zona: body.zona })
      : action === "post"
        ? callBot("/api/kit/post", { ref: body.ref, comision: body.comision !== false })
        : action === "registrar"
          ? callBot("/api/kit/registrar", { ref: body.ref, accion: body.accion, userId: user.id })
          : null;
  if (!llamada) return NextResponse.json({ error: "Acción inválida" }, { status: 400 });

  const r = await llamada;
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}
