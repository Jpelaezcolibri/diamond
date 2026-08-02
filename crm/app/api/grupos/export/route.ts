import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";

// Sube exports .txt de grupos al bot para que los procese.
//
// Mismo guard que /grupos: acá se sube el contenido completo de un grupo
// gremial, con mensajes de terceros. No es una pantalla de asesor.
//
// callBot() no sirve: solo manda JSON. Un multipart hay que reenviarlo a mano,
// igual que en /api/media.

const MAX_BYTES = 16 * 1024 * 1024; // el límite de multer del lado del bot

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdmin(user)) return null;
  return user;
}

export async function POST(request: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const form = await request.formData();
  const archivos = form.getAll("files").filter((f): f is File => f instanceof File);
  if (archivos.length === 0) {
    return NextResponse.json({ error: "No adjuntaste ningún archivo" }, { status: 400 });
  }

  const noTxt = archivos.find((f) => !f.name.toLowerCase().endsWith(".txt"));
  if (noTxt) {
    return NextResponse.json(
      { error: `"${noTxt.name}" no es un .txt. Exportá el chat con "Sin archivos".` },
      { status: 400 }
    );
  }

  const total = archivos.reduce((s, f) => s + f.size, 0);
  if (total > MAX_BYTES) {
    return NextResponse.json(
      { error: "Los archivos suman más de 16 MB. Subí menos grupos a la vez." },
      { status: 413 }
    );
  }

  const forward = new FormData();
  for (const f of archivos) forward.append("files", f, f.name);
  const dias = form.get("dias");
  if (dias !== null) forward.append("dias", String(dias));

  const res = await fetch(`${process.env.BOT_API_URL}/api/grupos/importar-export`, {
    method: "POST",
    headers: { "x-api-key": process.env.BOT_API_KEY! },
    body: forward,
  }).catch(() => null);

  if (!res) return NextResponse.json({ error: "El bot no respondió" }, { status: 502 });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}

// Estado de una importación en curso — el CRM lo consulta cada pocos segundos.
export async function GET(request: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "Falta jobId" }, { status: 400 });

  const res = await fetch(
    `${process.env.BOT_API_URL}/api/grupos/importar-export/${encodeURIComponent(jobId)}`,
    { headers: { "x-api-key": process.env.BOT_API_KEY! } }
  ).catch(() => null);

  if (!res) return NextResponse.json({ error: "El bot no respondió" }, { status: 502 });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
