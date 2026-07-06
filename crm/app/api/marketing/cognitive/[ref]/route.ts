import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dmapJson } from "@/lib/dmap";

// Estado/contenido del Property Context (DCE) de una propiedad, por ref.
export async function GET(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { ref } = await params;
  const orgId = new URL(request.url).searchParams.get("orgId");
  if (!orgId) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });

  const { ok, status, data } = await dmapJson(
    `/api/v1/cognitive/context/${encodeURIComponent(ref)}?orgId=${encodeURIComponent(orgId)}`
  );

  if (!ok) return NextResponse.json(data, { status });
  return NextResponse.json(data);
}
