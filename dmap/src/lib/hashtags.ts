/**
 * Normaliza hashtags para que SIEMPRE salgan como hashtags reales en FB/IG.
 * Bug real (2026-07-06): el copywriter a veces devolvia los tags sin "#"
 * ("ApartamentosMedellin") y en la publicacion aparecian como texto plano.
 * Se aplica en dos puntos: al parsear la salida del copywriter (filas nuevas)
 * y al armar el caption en el publisher (filas viejas ya guardadas sin #).
 */
export function normalizeHashtags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    // Sin "#" iniciales, sin espacios/puntuacion interna (un hashtag se corta
    // en el primer caracter no alfanumerico; se conservan letras con tilde/ñ).
    const cleaned = raw
      .trim()
      .replace(/^#+/, "")
      .replace(/[^\p{L}\p{N}_]+/gu, "");
    if (!cleaned) continue;
    const tag = `#${cleaned}`;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}
