import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { dmapJson } from "@/lib/dmap";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { orgId, selections } = await request.json();
  if (!orgId || !Array.isArray(selections) || selections.length === 0) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  const { ok, status, data } = await dmapJson("/api/v1/meta/connections", {
    method: "POST",
    actorId: user.id,
    body: JSON.stringify({ orgId, selections }),
  });

  if (!ok) return NextResponse.json(data, { status });
  return NextResponse.json(data);
}
