import { NextResponse } from "next/server";
import { getTenantConfig } from "@/config/tenant";
import { LeadFormSchema, normalizePhone } from "@/lib/lead-schema";
import { createAdminClient } from "@/lib/admin-supabase";
import { generalWhatsAppUrl, propertyWhatsAppUrl, sellerWhatsAppUrl } from "@/lib/whatsapp";
import { trackLead } from "@/services/tracking";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Máximo de envíos por IP en la ventana. Un humano legítimo no manda más de
// unos pocos leads por hora; esto frena scripts que llenen la tabla del CRM.
const RATE_LIMIT = 6;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hora

const CATEGORIA: Record<string, string> = {
  comprar: "compra",
  arrendar: "alquiler",
  vender: "otros",
};

function whatsappFor(context: string, propertyRef: string | undefined) {
  const config = getTenantConfig();
  if (context === "property" && propertyRef) return propertyWhatsAppUrl(config, propertyRef);
  if (context === "seller") return sellerWhatsAppUrl(config);
  return generalWhatsAppUrl(config);
}

/**
 * Guarda el lead en el CRM (upsert conservador) y devuelve la URL de
 * WhatsApp. El lead queda registrado aunque el visitante no complete el chat.
 */
export async function POST(request: Request) {
  // Rate limit por IP antes de tocar nada: primera línea contra spam del CRM.
  const limit = rateLimit(`leads:${clientIp(request)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: "Demasiadas solicitudes. Intenta más tarde o escríbenos por WhatsApp." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const parsed = LeadFormSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Datos inválidos" }, { status: 400 });
  }
  const values = parsed.data;

  // Anti-spam: honeypot lleno o submit en <2s → 200 fake (sin señal al bot).
  const tooFast = Date.now() - values._ts < 2000;
  if (values._gotcha || tooFast) {
    return NextResponse.json({ ok: true, whatsappUrl: whatsappFor(values.context, values.propertyRef) });
  }

  const phone = normalizePhone(values.telefono);
  if (!phone) {
    return NextResponse.json({ ok: false, error: "Teléfono inválido" }, { status: 400 });
  }

  const whatsappUrl = whatsappFor(values.context, values.propertyRef);
  const supabase = createAdminClient();
  const orgId = process.env.TENANT_ORG_ID;

  // Sin Supabase/org (modo demo): la conversion sigue viva via WhatsApp.
  if (!supabase || !orgId) {
    return NextResponse.json({ ok: true, whatsappUrl, saved: false });
  }

  const zona = values.zona?.trim() || null;
  const presupuesto = values.presupuesto?.trim() || null;

  const { data: existing, error: findError } = await supabase
    .from("leads")
    .select("id, nombre, zona_interes, presupuesto, property_ref_origen")
    .eq("org_id", orgId)
    .eq("phone", phone)
    .maybeSingle();

  if (findError) {
    // Sin detalles del error (evita filtrar estructura/PII a los logs).
    console.error("[REF] Error consultando leads");
    return NextResponse.json({ ok: true, whatsappUrl, saved: false });
  }

  if (existing) {
    // Merge NO destructivo: solo RELLENA campos vacíos. Nunca pisa datos que
    // ya tenga el lead (un tercero que conozca el teléfono no puede corromper
    // el contexto de un lead calificado por el bot/asesor). Tampoco toca
    // estado, score, source ni owner.
    const patch: Record<string, unknown> = {};
    if (values.nombre && !existing.nombre) patch.nombre = values.nombre;
    if (zona && !existing.zona_interes) patch.zona_interes = zona;
    if (presupuesto && !existing.presupuesto) patch.presupuesto = presupuesto;
    if (values.propertyRef && !existing.property_ref_origen) {
      patch.property_ref_origen = values.propertyRef;
    }

    if (Object.keys(patch).length > 0) {
      patch.updated_at = new Date().toISOString();
      const { error } = await supabase.from("leads").update(patch).eq("id", existing.id);
      if (error) console.error("[REF] Error actualizando lead");
    }
  } else {
    const { error } = await supabase.from("leads").insert({
      org_id: orgId,
      phone,
      nombre: values.nombre,
      zona_interes: zona,
      presupuesto,
      categoria: CATEGORIA[values.operacion] ?? "otros",
      estado: "nuevo",
      source: "landing",
      property_ref_origen: values.propertyRef ?? null,
    });
    if (error) console.error("[REF] Error insertando lead");
  }

  await trackLead({ context: values.context, propertyRef: values.propertyRef });

  return NextResponse.json({ ok: true, whatsappUrl, saved: true });
}
