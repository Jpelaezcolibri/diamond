import { NextResponse } from "next/server";
import { callBot } from "@/lib/bot";

// Registra lo que la asesora hizo en la página del aviso (Juan, 2026-09-02,
// opción D). Sin sesión a propósito: la página se abre desde WhatsApp con un
// token irrepetible, y ese token es la autorización. Solo acepta las dos
// gestiones que existen; el bot vuelve a validar.
export async function POST(request: Request) {
  const { token, gestion } = await request.json().catch(() => ({}));
  if (typeof token !== "string" || !token || !["envio", "no_sirve"].includes(gestion)) {
    return NextResponse.json({ error: "Falta token o gestion" }, { status: 400 });
  }
  const r = await callBot("/api/grupos/aviso/gestion", { token, gestion });
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}
