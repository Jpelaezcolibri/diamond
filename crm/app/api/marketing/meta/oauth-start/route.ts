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

  const { orgId, returnUrl } = await request.json();
  if (!orgId || !returnUrl) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });

  const { ok, status, data } = await dmapJson("/api/v1/meta/oauth/start", {
    method: "POST",
    actorId: user.id,
    body: JSON.stringify({ orgId, returnUrl }),
  });

  if (!ok) return NextResponse.json(data, { status });
  return NextResponse.json(data);
}
