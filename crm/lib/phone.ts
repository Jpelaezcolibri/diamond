// Normaliza a formato E.164 sin "+" (mismo formato que usa el bot y la tabla
// advisors, ej "573016981200"). Asume celular colombiano si vienen 10 digitos.
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("3")) return `57${digits}`;
  if (digits.length === 12 && digits.startsWith("57")) return digits;
  if (digits.length >= 10 && digits.length <= 13) return digits;
  return null;
}
