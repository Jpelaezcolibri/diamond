import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { dmapJson } from "@/lib/dmap";

// listCoverCandidates ahora suma una llamada a Claude vision cuando la
// propiedad tiene brief cognitivo (scoreImagesForBrief) — con el default de
// Vercel esto se podia cortar a mitad; mismo patron que regenerate-creative.
export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;
  const role = new URL(request.url).searchParams.get("role") === "story" ? "story" : "cover";

  const { ok, status, data } = await dmapJson(`/api/v1/publications/${id}/cover-candidates?role=${role}`, {
    actorId: user.id,
  });

  if (!ok) return NextResponse.json(data, { status });
  return NextResponse.json(data);
}
