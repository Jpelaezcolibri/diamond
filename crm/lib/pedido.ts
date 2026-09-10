// A qué pedido le responde el asesor (Juan, 2026-09-10). Misma regla que
// src/groups/pedido.js#numeroPedido (fuente de verdad del bot): "pedido" +
// hasta 8 caracteres que no sean letra ni dígito + 2-6 dígitos, o el código
// C_647. Sin \p{L}\p{N} (que sí usa el bot): esas clases Unicode dependen del
// target de TypeScript del CRM, y acá se prefirió la lista explícita de
// letras con tilde/ñ para no arrastrar esa dependencia.
const PATRONES_NUMERO = [
  /pedido[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]{0,8}(\d{2,6})(?!\d)/i,
  /(?:^|[^A-Za-z0-9])C_(\d{2,6})(?!\d)/,
];

export function numeroPedido(texto: string | null | undefined): string | null {
  const t = String(texto || "");
  for (const patron of PATRONES_NUMERO) {
    const m = t.match(patron);
    if (m) return m[1];
  }
  return null;
}
