// "Sigue disponible" / "Ya no está" de una propiedad que publicó Sofi a pedido
// del asesor (Juan, 2026-10-20). La lógica vive en el bot
// (src/data/propiedades-asesor.js#aplicarVigencia): solo el captador puede.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callBot } from "@/lib/bot";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { ref, sigue } = (await request.json().catch(() => ({}))) as { ref?: string; sigue?: boolean };
  if (!ref) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });

  const r = await callBot<{ ok: boolean; estado?: string; ref?: string; error?: string }>("/api/propiedades/vigencia", {
    ref,
    sigue: Boolean(sigue),
    authUserId: user.id,
  });
  if (!r.ok) return NextResponse.json({ error: r.error || "El bot no respondió" }, { status: r.status >= 400 ? r.status : 502 });
  return NextResponse.json({ ok: true, estado: r.data?.estado ?? null, ref: r.data?.ref ?? ref });
}
