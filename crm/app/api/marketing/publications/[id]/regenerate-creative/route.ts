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
  const { role, notes, criticInstructions, sourceImageUrl } = await request.json();
  if (role !== "cover" && role !== "story") {
    return NextResponse.json({ error: "role invalido (cover | story)" }, { status: 400 });
  }
  const hasNotes = typeof notes === "string" && notes.trim().length > 0;
  const instructions = Array.isArray(criticInstructions)
    ? criticInstructions.filter((i: unknown): i is string => typeof i === "string" && i.trim().length > 0).slice(0, 12)
    : [];
  const hasSourceImageUrl = typeof sourceImageUrl === "string" && sourceImageUrl.trim().length > 0;
  if (!hasNotes && instructions.length === 0 && !hasSourceImageUrl) {
    return NextResponse.json({ error: "Escribe los cambios que quieres, usa las recomendaciones del crítico, o elige otra foto" }, { status: 400 });
  }

  const { ok, status, data } = await dmapJson(`/api/v1/publications/${id}/regenerate-creative`, {
    method: "POST",
    actorId: user.id,
    body: JSON.stringify({
      role,
      ...(hasNotes ? { notes: notes.trim().slice(0, 2000) } : {}),
      // El prompt de GPT tolera bien instrucciones largas, pero el schema de
      // DMAP corta en 600 c/u — truncar aquí evita un invalid_request opaco.
      ...(instructions.length > 0 ? { criticInstructions: instructions.map((i: string) => i.trim().slice(0, 600)) } : {}),
      ...(hasSourceImageUrl ? { sourceImageUrl: sourceImageUrl.trim() } : {}),
    }),
  });

  if (!ok) return NextResponse.json(data, { status });
  return NextResponse.json(data);
}
