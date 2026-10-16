import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Foto i de una propiedad, servida desde el CRM para que el navegador pueda
// armar los archivos de navigator.share (Wasi no deja bajarlas por CORS).
// NO es un proxy abierto: la URL sale de properties.images de esa ref, nunca
// de un parametro (spec 2026-10-16 §3.4).
const FOTOS_MAX = 4;

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const url = new URL(request.url);
  const ref = (url.searchParams.get("ref") || "").trim();
  const i = Number(url.searchParams.get("i"));
  if (!ref || !/^[A-Za-z0-9-]+$/.test(ref) || !Number.isInteger(i) || i < 0 || i >= FOTOS_MAX) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data } = await admin.from("properties").select("images").eq("ref", ref).eq("disponible", true).maybeSingle();
  const fotos = Array.isArray(data?.images) ? (data.images as string[]).filter(Boolean) : [];
  const fuente = fotos[i];
  if (!fuente) return NextResponse.json({ error: "No existe esa foto" }, { status: 404 });

  const res = await fetch(fuente, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res || !res.ok) return NextResponse.json({ error: "No se pudo traer la foto" }, { status: 502 });
  const tipo = res.headers.get("content-type") || "image/jpeg";
  if (!tipo.startsWith("image/")) return NextResponse.json({ error: "No es una imagen" }, { status: 502 });

  return new NextResponse(res.body, {
    headers: { "content-type": tipo, "cache-control": "private, max-age=3600" },
  });
}
