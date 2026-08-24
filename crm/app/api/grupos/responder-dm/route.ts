import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { callBot } from "@/lib/bot";

// Dispara el DM manual al colega para un pedido que quedó sin responder por
// DM (Juan, 2026-08-24) -- ver src/groups/vivo.js#responderPorDmManual y la
// ruta hermana en src/api/crm.js (/api/grupos/senal/responder-dm).
//
// Solo admin: el mismo criterio que /api/grupos/permiso y /api/grupos/radar,
// no el de /api/grupos/senal (que es trabajo diario del asesor). Esto manda
// un WhatsApp real, sin reintento, por la línea que ya fue baneada una vez
// en julio de 2026 (ver la nota grande de riesgo en src/lib/waha.js) -- es
// una decisión deliberada de saltar el freno de antigüedad, no una marca de
// estado.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!isAdmin(user)) {
    return NextResponse.json(
      { error: "Solo un administrador puede mandar el DM manual al colega" },
      { status: 403 }
    );
  }

  const { signalId, refs } = await request.json().catch(() => ({}));
  if (!signalId) return NextResponse.json({ error: "Falta signalId" }, { status: 400 });

  // `refs` (Juan, 2026-08-24, opcional): la selección de propiedades que el
  // usuario marcó en el panel -- ver senales-grupos.tsx y la nota de diseño
  // grande en src/groups/vivo.js#responderPorDmManual. Se reenvía tal cual;
  // la validación real (cruzar contra los matches de la señal) vive del otro
  // lado, no acá.
  const r = await callBot("/api/grupos/senal/responder-dm", { signalId, refs: Array.isArray(refs) ? refs : undefined });
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}
