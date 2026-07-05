import { createHash } from "crypto";

/**
 * Evento Lead server-side via Meta Conversions API. El cliente (Pixel) manda
 * el mismo event_id, asi Meta deduplica y cuenta la conversion una sola vez.
 * Sin NEXT_PUBLIC_META_PIXEL_ID + META_CAPI_ACCESS_TOKEN es un no-op: el
 * data flow queda cableado y el tracking nunca bloquea el guardado del lead.
 */

const GRAPH_VERSION = "v23.0";
const CAPI_TIMEOUT_MS = 3000;

interface TrackLeadInput {
  context: "home" | "property" | "seller";
  propertyRef?: string;
  /** UUID generado en el formulario; compartido con el Pixel para dedup. */
  eventId?: string;
  /** E.164 sin "+" (formato del bot). Se envia hasheado SHA-256, nunca en claro. */
  phone?: string;
  clientIp?: string;
  userAgent?: string;
  sourceUrl?: string;
}

export async function trackLead(data: TrackLeadInput): Promise<void> {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN;
  if (!pixelId || !accessToken) return;

  const payload = {
    data: [
      {
        event_name: "Lead",
        event_time: Math.floor(Date.now() / 1000),
        ...(data.eventId ? { event_id: data.eventId } : {}),
        action_source: "website",
        ...(data.sourceUrl ? { event_source_url: data.sourceUrl } : {}),
        user_data: {
          ...(data.phone ? { ph: [sha256(data.phone)] } : {}),
          ...(data.clientIp ? { client_ip_address: data.clientIp } : {}),
          ...(data.userAgent ? { client_user_agent: data.userAgent } : {}),
        },
        custom_data: {
          content_category: data.context,
          ...(data.propertyRef ? { content_ids: [data.propertyRef] } : {}),
        },
      },
    ],
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${accessToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(CAPI_TIMEOUT_MS),
      }
    );
    if (!res.ok) {
      // Sin body del error a los logs (puede ecoar user_data).
      console.error(`[REF] CAPI respondio ${res.status}`);
    }
  } catch {
    console.error("[REF] CAPI no disponible");
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
