import { z } from "zod";

/**
 * Schema compartido form ↔ API. El telefono acepta formatos colombianos
 * comunes y se normaliza a E.164 sin "+" (mismo formato que usa el bot).
 */
export const LeadFormSchema = z.object({
  nombre: z.string().trim().min(2, "Cuéntanos tu nombre").max(80),
  telefono: z
    .string()
    .trim()
    .regex(/^[\d\s+()-]{7,20}$/, "Escribe un número de celular válido"),
  operacion: z.enum(["comprar", "arrendar", "vender"], { message: "Elige una opción" }),
  zona: z.string().trim().max(120).optional().or(z.literal("")),
  presupuesto: z.string().trim().max(80).optional().or(z.literal("")),
  /** Ref si el form viene del detalle de una propiedad. Alfanumérica: los refs
   *  de Wasi son dígitos (8616297) o códigos como AP001 — sin caracteres raros
   *  que puedan inyectar en la URL de WhatsApp. */
  propertyRef: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{1,20}$/)
    .optional()
    .or(z.literal("")),
  /** Contexto de origen para saber que formulario convirtio. */
  context: z.enum(["home", "property", "seller"]).default("home"),
  /** event_id compartido Pixel <-> CAPI (dedup). UUID generado en el cliente. */
  eventId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{8,64}$/)
    .optional()
    .or(z.literal("")),
  /** Honeypot: los humanos no lo ven; si llega con valor, es un bot.
   *  No se valida con max(0): el handler responde 200 fake, sin señal al bot. */
  _gotcha: z.string().max(500).optional(),
  /** Timestamp del render: submits en <2s son bots. */
  _ts: z.coerce.number(),
});

export type LeadFormValues = z.input<typeof LeadFormSchema>;

/** Normaliza a E.164 sin "+" (patron de crm/lib/phone.ts). */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("3")) return `57${digits}`;
  if (digits.length === 12 && digits.startsWith("57")) return digits;
  if (digits.length >= 10 && digits.length <= 13) return digits;
  return null;
}
