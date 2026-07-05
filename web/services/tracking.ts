/**
 * Punto de integracion Meta Pixel + Conversions API.
 * TODO(v1.x): cuando config.integrations.metaPixelId este definido:
 *  - Cliente: fbq('track', 'Lead') en el submit del formulario.
 *  - Servidor: evento CAPI desde /api/leads con event_id compartido (dedup).
 * Hoy es un no-op para que el data flow quede cableado desde el dia 1.
 */
export async function trackLead(_data: {
  context: "home" | "property" | "seller";
  propertyRef?: string;
}): Promise<void> {
  // no-op
}
