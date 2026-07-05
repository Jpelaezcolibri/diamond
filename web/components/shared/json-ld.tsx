// U+2028 y U+2029 son válidos en JSON pero son terminadores de línea en JS y
// rompen un <script> inline. Se construyen desde su código para no incluir el
// carácter literal en la fuente (rompería el parser de TS).
const U2028 = String.fromCharCode(0x2028);
const U2029 = String.fromCharCode(0x2029);
const LINE_SEPARATORS = new RegExp(`[${U2028}${U2029}]`, "g");

/**
 * Serializa JSON-LD de forma segura para incrustar en <script>. Escapa los
 * caracteres que podrían romper el contexto (`<`, `>`, `&`) y los separadores
 * de línea. Los títulos vienen de Wasi (datos externos), así que el hardening
 * no es opcional.
 */
function safeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(LINE_SEPARATORS, (ch) => (ch === U2028 ? "\\u2028" : "\\u2029"));
}

/** Inyecta JSON-LD (schema.org) server-rendered. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(data) }} />
  );
}
