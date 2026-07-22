import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dmapJson } from "@/lib/dmap";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;
  const { scheduledAt, connectionIds, timezone } = await request.json();
  if (!scheduledAt || !Array.isArray(connectionIds) || connectionIds.length === 0) {
    return NextResponse.json({ error: "Faltan datos (scheduledAt, connectionIds)" }, { status: 400 });
  }

  const { ok, status, data } = await dmapJson(`/api/v1/publications/${id}/schedule`, {
    method: "POST",
    actorId: user.id,
    body: JSON.stringify({ scheduledAt, connectionIds, timezone }),
  });

  if (!ok) return NextResponse.json(data, { status });
  return NextResponse.json(data);
}
