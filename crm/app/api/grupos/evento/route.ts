import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callBot } from "@/lib/bot";

// Registrar en qué terminó una oportunidad.
//
// No es de admin: cerrar el ciclo de un pedido es el trabajo diario del asesor,
// y es además el único dato de toda la cadena que nadie puede reconstruir
// después. Una decisión real, en el momento en que ocurrió, es irrepetible.
//
// Cada llamada AGREGA un evento — nunca corrige el anterior. Si una oportunidad
// va de CONVERSACION a VISITA a PERDIDO, quedan los tres, en orden.
const TIPOS = [
  "SIN_RESPUESTA", "CONVERSACION", "VISITA",
  "NEGOCIACION", "CIERRE", "PERDIDO", "DESCARTADO",
];

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { signalId, tipo, motivo } = await request.json().catch(() => ({}));
  if (!signalId || !TIPOS.includes(tipo)) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  // Quién registra sale SIEMPRE de la sesión. Aceptarlo del cliente permitiría
  // atribuirle a otro asesor una decisión que no tomó — y todo el valor del
  // historial depende de que diga la verdad sobre quién hizo qué.
  const { data: advisor } = await supabase
    .from("advisors").select("id").eq("auth_user_id", user.id).limit(1).maybeSingle();

  const r = await callBot("/api/grupos/senal/evento", {
    signalId,
    tipo,
    motivo: typeof motivo === "string" ? motivo.slice(0, 500) : null,
    advisorId: advisor?.id ?? null,
  });
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}
