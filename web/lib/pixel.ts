/**
 * Helper cliente del Pixel. El event_id viaja tambien a /api/leads para que
 * el evento CAPI del servidor se deduplique con este (mismo eventID).
 */

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

export function trackPixelLead(
  eventId: string,
  data: { context: "home" | "property" | "seller"; propertyRef?: string }
): void {
  if (typeof window === "undefined" || !window.fbq) return;
  window.fbq(
    "track",
    "Lead",
    {
      content_category: data.context,
      ...(data.propertyRef ? { content_ids: [data.propertyRef] } : {}),
    },
    { eventID: eventId }
  );
}
