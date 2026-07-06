import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { dmapJson } from "@/lib/dmap";

// El motor IA (GPT Image + critico, hasta 2 rondas) puede tomar ~1-2 min;
// el default de Vercel cortaria el proxy a mitad.
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;
  const { role, notes } = await request.json();
  if (role !== "cover" && role !== "story") {
    return NextResponse.json({ error: "role invalido (cover | story)" }, { status: 400 });
  }
  if (typeof notes !== "string" || notes.trim().length === 0) {
    return NextResponse.json({ error: "Escribe los cambios que quieres" }, { status: 400 });
  }

  const { ok, status, data } = await dmapJson(`/api/v1/publications/${id}/regenerate-creative`, {
    method: "POST",
    actorId: user.id,
    body: JSON.stringify({ role, notes }),
  });

  if (!ok) return NextResponse.json(data, { status });
  return NextResponse.json(data);
}
