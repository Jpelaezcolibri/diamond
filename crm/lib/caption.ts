// Vista previa del texto final que DMAP publica en FB/IG. Espejo de
// dmap/src/services/publish.service.ts (buildCaption/buildContactBlock) +
// dmap/src/lib/hashtags.ts (normalizeHashtags), para que el Content Studio
// muestre EXACTAMENTE lo que se publicara, incluyendo el link a la landing y
// el WhatsApp de Sofi (que DMAP agrega al publicar, no se guarda en el copy).
//
// Las constantes son valores PUBLICOS (no secretos) que reflejan los env de
// DMAP (LANDING_BASE_URL / CONTACT_WHATSAPP_NUMBER). Si cambian alla, cambiar aca.
import { buildSlug } from "./slug";

const LANDING_BASE_URL = "https://diamondinmobiliaria.com";
const CONTACT_WHATSAPP_NUMBER = "573044653609";

export function normalizeHashtags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const cleaned = raw.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]+/gu, "");
    if (!cleaned) continue;
    const tag = `#${cleaned}`;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

export function buildContactBlock(ref: string | null | undefined, titulo: string | null | undefined): string | null {
  if (!ref) return null;
  const lines = [`🔗 Conoce esta propiedad: ${LANDING_BASE_URL}/propiedades/${buildSlug(titulo ?? "", ref)}`];
  const prefilled = encodeURIComponent(`Hola Sofi, me interesa la propiedad ${ref}`);
  lines.push(`💬 Escríbenos al WhatsApp (Ref ${ref}): https://wa.me/${CONTACT_WHATSAPP_NUMBER}?text=${prefilled}`);
  return lines.join("\n");
}

/** Arma el caption final igual que publish.service: copy + CTA + contacto + hashtags. */
export function buildFinalCaption(params: {
  copy: string;
  cta: string | null;
  hashtags: string[];
  ref: string | null | undefined;
  titulo: string | null | undefined;
}): string {
  const hashtags = normalizeHashtags(params.hashtags).join(" ");
  const parts = [params.copy, params.cta, buildContactBlock(params.ref, params.titulo), hashtags]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p));
  return parts.join("\n\n");
}
