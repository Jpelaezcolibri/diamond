import type { TenantConfig } from "@/config/tenant-schema";
import { localizeText, type Language } from "@/config/i18n";

export function waUrl(number: string, message: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

// Los mensajes prellenados pueden ser bilingues ({ es, en }) en la config del
// tenant. El idioma por defecto es español: los server components (que no
// conocen el idioma del visitante) generan es; los CTAs client-side usan
// <WaLink> (components/shared/wa-link.tsx) para resolver el idioma activo.
// El prellenado EN es ademas la señal con la que Sofi detecta el idioma del
// lead (src/agent/intent.js:detectClientLanguage) — no cambiar su texto sin
// actualizar esa deteccion.
export function generalWhatsAppUrl(config: TenantConfig, lang: Language = "es"): string {
  return waUrl(config.contact.whatsapp.number, localizeText(config.contact.whatsapp.generalMessage, lang));
}

export function sellerWhatsAppUrl(config: TenantConfig, lang: Language = "es"): string {
  return waUrl(config.contact.whatsapp.number, localizeText(config.contact.whatsapp.sellerMessage, lang));
}

/** CTA de una propiedad: mensaje con la ref precargada (patron del playbook). */
export function propertyWhatsAppUrl(config: TenantConfig, ref: string, lang: Language = "es"): string {
  const message = localizeText(config.contact.whatsapp.propertyMessage, lang).replace("{ref}", ref);
  return waUrl(config.contact.whatsapp.number, message);
}
