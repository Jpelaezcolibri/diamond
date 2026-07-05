import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { dmapJson } from "@/lib/dmap";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const orgId = new URL(request.url).searchParams.get("orgId");
  if (!orgId) return NextResponse.json({ error: "Falta orgId" }, { status: 400 });

  const { ok, status, data } = await dmapJson(`/api/v1/settings?orgId=${encodeURIComponent(orgId)}`, { actorId: user.id });
  if (!ok) return NextResponse.json(data, { status });
  return NextResponse.json(data);
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json();
  const { orgId, ...settings } = body;
  if (!orgId) return NextResponse.json({ error: "Falta orgId" }, { status: 400 });

  const { ok, status, data } = await dmapJson(`/api/v1/settings?orgId=${encodeURIComponent(orgId)}`, {
    method: "PUT",
    actorId: user.id,
    body: JSON.stringify(settings),
  });
  if (!ok) return NextResponse.json(data, { status });
  return NextResponse.json(data);
}
