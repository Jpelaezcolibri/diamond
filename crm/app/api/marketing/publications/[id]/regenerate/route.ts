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
  const { styleVariant } = await request.json();
  if (!styleVariant) return NextResponse.json({ error: "Falta styleVariant" }, { status: 400 });

  const { ok, status, data } = await dmapJson(`/api/v1/publications/${id}/regenerate`, {
    method: "POST",
    actorId: user.id,
    body: JSON.stringify({ styleVariant }),
  });

  if (!ok) return NextResponse.json(data, { status });
  return NextResponse.json(data);
}
