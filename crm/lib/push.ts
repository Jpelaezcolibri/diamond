// Clave PUBLICA VAPID del push de la App de asesores (2026-10-07). Es publica
// por diseno: el navegador la necesita para suscribirse. La privada vive solo
// en Railway (VAPID_PRIVATE_KEY del servicio del bot, que es quien envia).
export const VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
  "BKvGfsI7goUpRgPyjE_GQvKoHkz704q3sa4R77jWwKcfsiLIiJhxPcW_MKS-iWnuddQ3lksxAOh5RpBG8SZkapw";

export function base64UrlToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
