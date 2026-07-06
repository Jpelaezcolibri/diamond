import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dmapJson } from "@/lib/dmap";

// El Property Context son 2 llamadas Claude encadenadas (~20-60s).
export const maxDuration = 120;

// Boton "Regenerar contexto" (DCE): re-infiere el Property Context ya, sin
// esperar el batch nocturno.
export async function POST(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { ref } = await params;
  const { orgId } = await request.json();
  if (!orgId) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });

  const { ok, status, data } = await dmapJson(`/api/v1/cognitive/context/${encodeURIComponent(ref)}/regenerate`, {
    method: "POST",
    actorId: user.id,
    body: JSON.stringify({ orgId }),
  });

  if (!ok) return NextResponse.json(data, { status });
  return NextResponse.json(data);
}
