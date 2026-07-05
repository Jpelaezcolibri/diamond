import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dmapJson } from "@/lib/dmap";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { propertyId, orgId, styleVariant } = await request.json();
  if (!propertyId || !orgId || !styleVariant) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  const { ok, status, data } = await dmapJson(`/api/v1/generation/property/${propertyId}`, {
    method: "POST",
    actorId: user.id,
    body: JSON.stringify({ orgId, styleVariant }),
  });

  if (!ok) return NextResponse.json(data, { status });
  return NextResponse.json(data);
}
