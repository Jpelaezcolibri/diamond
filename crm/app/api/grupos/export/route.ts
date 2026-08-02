import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";

// Sube exports .txt de grupos al bot para que los procese.
//
// Cualquier asesor autenticado sube LOS SUYOS: el export sale de su propio
// teléfono, de grupos en los que él está. Era solo de admin cuando una línea
// vinculada servía a toda la organización; con exports esa premisa no existe.
//
// Las señales que salgan quedan marcadas con su advisor_id, que es lo que
// después le muestra a cada uno lo que él observó y a nadie más.
//
// callBot() no sirve: solo manda JSON. Un multipart hay que reenviarlo a mano,
// igual que en /api/media.

const MAX_BYTES = 16 * 1024 * 1024; // el límite de multer del lado del bot

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
}

/** La ficha de asesor detrás de un login. Sin ella no se puede atribuir la
 *  observación, así que tampoco se deja subir. */
async function advisorDe(userId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("advisors").select("id").eq("auth_user_id", userId).limit(1).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const advisorId = await advisorDe(user.id);
  if (!advisorId && !isAdmin(user)) {
    return NextResponse.json(
      { error: "Tu usuario no está vinculado a una ficha de asesor. Pedile a un administrador que te vincule." },
      { status: 403 }
    );
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
  // Quien sube es quien observa. Nunca se toma del cliente: sale de la sesión.
  if (advisorId) forward.append("advisorId", advisorId);

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
  if (!(await requireUser())) {
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
