// Cliente del API de WAHA — el servicio que sostiene la sesion vinculada a la
// linea del asesor.
//
// ═══ ESTE MODULO NO PUEDE ENVIAR MENSAJES ═══
//
// WAHA expone endpoints de envio (/api/sendText y compañia). Este cliente no
// los implementa, y eso es la mitad de la promesa que le hacemos al asesor: no
// es un flag apagado, es que la capacidad no existe en el codigo. Lo unico que
// hace es administrar la sesion (crear, ver el QR, ver el estado) y LEER la
// lista de grupos. Hay un test que lo verifica sobre el fuente.
//
// Docs: https://waha.devlike.pro/docs/how-to/sessions/

const BASE = () => (process.env.WAHA_URL || "").replace(/\/+$/, "");
const KEY = () => process.env.WAHA_API_KEY || "";
const TIMEOUT_MS = 20000;

function configurado() {
  return Boolean(BASE() && KEY());
}

async function pedir(ruta, { metodo = "GET", body = null } = {}) {
  if (!configurado()) throw new Error("Falta WAHA_URL o WAHA_API_KEY");
  const res = await fetch(`${BASE()}${ruta}`, {
    method: metodo,
    headers: { "X-Api-Key": KEY(), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const texto = await res.text();
  let datos = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch { datos = { raw: texto }; }
  if (!res.ok) {
    const e = new Error(datos?.message || datos?.error || `WAHA respondio ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return datos;
}

// Crea (o reusa) la sesion y la arranca. Idempotente: si ya existe, WAHA
// devuelve 422 y devolvemos la que hay.
async function crearSesion(nombre, { webhookUrl, webhookSecret }) {
  const config = {
    webhooks: [{
      url: webhookUrl,
      // Solo mensajes. Nada de acks, presencia ni typing: es ruido, y cada
      // evento extra es superficie de exposicion sin contrapartida.
      events: ["message"],
      customHeaders: [{ name: "x-api-key", value: webhookSecret }],
    }],
  };
  try {
    return await pedir("/api/sessions", { metodo: "POST", body: { name: nombre, start: true, config } });
  } catch (e) {
    if (e.status === 422 || e.status === 409) return estadoSesion(nombre);
    throw e;
  }
}

async function estadoSesion(nombre) {
  return pedir(`/api/sessions/${encodeURIComponent(nombre)}`);
}

// El QR en base64, para mostrarlo en el CRM. Caduca en segundos y se refresca
// solo: hay que pedirlo de nuevo, no cachearlo.
async function qr(nombre) {
  const r = await pedir(`/api/${encodeURIComponent(nombre)}/auth/qr?format=raw`);
  return r?.value || r?.qr || null;
}

// Todos los grupos en los que esta la linea. Es lo que permite importarlos de
// una en vez de esperar a que llegue un mensaje en cada uno.
async function listarGrupos(nombre) {
  const r = await pedir(`/api/${encodeURIComponent(nombre)}/groups`);
  const filas = Array.isArray(r) ? r : r?.data || [];
  return filas
    .map((g) => ({
      jid: g.id?._serialized || g.id || null,
      nombre: g.name || g.subject || g.formattedTitle || null,
      participantes: Array.isArray(g.participants) ? g.participants.length : null,
    }))
    .filter((g) => typeof g.jid === "string" && g.jid.endsWith("@g.us"));
}

module.exports = { configurado, crearSesion, estadoSesion, qr, listarGrupos };
