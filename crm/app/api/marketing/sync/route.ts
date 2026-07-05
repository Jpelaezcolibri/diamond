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

  const { orgId } = await request.json();
  if (!orgId) return NextResponse.json({ error: "Falta orgId" }, { status: 400 });

  const { ok, status, data } = await dmapJson("/api/v1/sync/run", {
    method: "POST",
    actorId: user.id,
    body: JSON.stringify({ orgId }),
  });

  if (!ok) return NextResponse.json(data, { status });
  return NextResponse.json(data);
}
