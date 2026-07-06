import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dmapJson } from "@/lib/dmap";

// Rollout inicial del DCE: encola el Property Context de todas las
// propiedades disponibles que aun no lo tienen (procesa el worker, en serie).
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { orgId } = await request.json();
  if (!orgId) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });

  const { ok, status, data } = await dmapJson(`/api/v1/cognitive/backfill`, {
    method: "POST",
    actorId: user.id,
    body: JSON.stringify({ orgId }),
  });

  if (!ok) return NextResponse.json(data, { status });
  return NextResponse.json(data);
}
