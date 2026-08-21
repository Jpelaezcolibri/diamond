import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callBot } from "@/lib/bot";

const ESTADOS = ["pendiente", "confirmada", "descartada"];

// Confirmar o descartar un aviso del panel "Posibles ventas" (Juan,
// 2026-08-21) — mismo criterio que /api/grupos/senal: no es solo de admin,
// es trabajo diario de revisar avisos, no una decision sobre la privacidad
// de ninguna línea.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id, estado } = await request.json().catch(() => ({}));
  if (!id || !ESTADOS.includes(estado)) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const r = await callBot("/api/grupos/venta/estado", { id, estado, actualizadoPor: user.id });
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}
