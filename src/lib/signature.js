// Verificacion de firma HMAC del webhook de Meta (WhatsApp).
// Meta firma el body crudo con el App Secret y lo manda en el header
// X-Hub-Signature-256 como "sha256=<hex>". Sin esta verificacion cualquiera
// que conozca la URL del webhook puede inyectar mensajes falsos.
const crypto = require("crypto");

// rawBody: Buffer del body sin parsear (ver server.js, express.json verify).
// header: valor crudo de X-Hub-Signature-256 (puede venir undefined).
// appSecret: META_APP_SECRET.
// Devuelve false si falta cualquiera de los tres o si la firma no coincide.
function verifyMetaSignature(rawBody, header, appSecret) {
  if (!rawBody || !header || !appSecret) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { verifyMetaSignature };
