import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { dmapJson } from "@/lib/dmap";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();

  const { ok, status, data } = await dmapJson(`/api/v1/publications/${id}`, {
    method: "PATCH",
    actorId: user.id,
    body: JSON.stringify(body),
  });

  if (!ok) return NextResponse.json(data, { status });
  return NextResponse.json(data);
}
