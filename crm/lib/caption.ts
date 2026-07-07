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

// +57 304 465 3609 en vez de 573044653609 corrido — legible en un caption de
// IG donde la persona lo va a marcar a mano, no a copiar de un link.
function formatPhone(number: string): string {
  const country = number.slice(0, 2);
  const rest = number.slice(2); // celular colombiano de 10 digitos: 3-3-4
  const groups = [rest.slice(0, 3), rest.slice(3, 6), rest.slice(6)].filter(Boolean);
  return `+${country} ${groups.join(" ")}`;
}

export function buildContactBlock(
  ref: string | null | undefined,
  titulo: string | null | undefined,
  platform: "facebook" | "instagram"
): string | null {
  if (!ref) return null;
  const lines = [`🔗 Conoce esta propiedad: ${LANDING_BASE_URL}/propiedades/${buildSlug(titulo ?? "", ref)}`];
  // Facebook autolinkea URLs en el caption: link corto propio (redirige a
  // wa.me con el mensaje precargado, ver web/app/wa/[ref]/route.ts) en vez
  // del wa.me?text=... crudo con URL-encoding largo. Instagram nunca hace
  // clicable un link del caption — mostrar ahi una URL es puro ruido, mejor
  // el numero en texto plano para marcar a mano.
  if (platform === "facebook") {
    lines.push(`💬 Escríbenos al WhatsApp (Ref ${ref}): ${LANDING_BASE_URL}/wa/${ref}`);
  } else {
    lines.push(`📲 Escríbenos por WhatsApp al ${formatPhone(CONTACT_WHATSAPP_NUMBER)} y menciona la Ref ${ref}`);
  }
  return lines.join("\n");
}

/** Arma el caption final igual que publish.service: copy + CTA + contacto + hashtags. */
export function buildFinalCaption(params: {
  copy: string;
  cta: string | null;
  hashtags: string[];
  ref: string | null | undefined;
  titulo: string | null | undefined;
  platform: "facebook" | "instagram";
}): string {
  const hashtags = normalizeHashtags(params.hashtags).join(" ");
  const parts = [params.copy, params.cta, buildContactBlock(params.ref, params.titulo, params.platform), hashtags]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p));
  return parts.join("\n\n");
}
