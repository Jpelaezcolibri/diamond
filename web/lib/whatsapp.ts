import type { TenantConfig } from "@/config/tenant-schema";

export function waUrl(number: string, message: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

export function generalWhatsAppUrl(config: TenantConfig): string {
  return waUrl(config.contact.whatsapp.number, config.contact.whatsapp.generalMessage);
}

export function sellerWhatsAppUrl(config: TenantConfig): string {
  return waUrl(config.contact.whatsapp.number, config.contact.whatsapp.sellerMessage);
}

/** CTA de una propiedad: mensaje con la ref precargada (patron del playbook). */
export function propertyWhatsAppUrl(config: TenantConfig, ref: string): string {
  const message = config.contact.whatsapp.propertyMessage.replace("{ref}", ref);
  return waUrl(config.contact.whatsapp.number, message);
}
