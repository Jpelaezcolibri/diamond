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
    if (e.status !== 422 && e.status !== 409) throw e;

    // La sesion ya existia — pasa si se creo a mano en WAHA antes de conectar
    // el bot. Devolver el estado a secas dejaria una sesion SIN nuestro
    // webhook: pareada, recibiendo mensajes, y sin que llegue ni uno. Falla
    // silenciosa y dificil de diagnosticar, asi que se reaplica la config.
    try {
      await pedir(`/api/sessions/${encodeURIComponent(nombre)}`, { metodo: "PUT", body: { config } });
    } catch (e2) {
      console.error(
        `[waha] La sesion "${nombre}" ya existia y NO se pudo actualizar su webhook (${e2.message}). ` +
        `Revisala a mano en WAHA: sin el webhook apuntando al bot no va a llegar ningun mensaje.`
      );
    }
    return estadoSesion(nombre);
  }
}

async function estadoSesion(nombre) {
  return pedir(`/api/sessions/${encodeURIComponent(nombre)}`);
}

// El QR en base64 PNG, listo para un <img src="data:image/png;base64,...">.
// Caduca en segundos y se refresca solo: hay que pedirlo de nuevo, no cachearlo.
//
// Se pide format=image y NO format=raw: raw devuelve el TEXTO del codigo
// ("2@abc...") que sirve para generar el QR, no una imagen. Metido en un <img>
// da una imagen rota — sin error, solo el texto alternativo.
//
// Segun version, WAHA responde binario o un JSON {mimetype, data}. Se aceptan
// las dos formas.
async function qr(nombre) {
  if (!configurado()) throw new Error("Falta WAHA_URL o WAHA_API_KEY");
  const res = await fetch(`${BASE()}/api/${encodeURIComponent(nombre)}/auth/qr?format=image`, {
    headers: { "X-Api-Key": KEY() },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const e = new Error(`WAHA respondio ${res.status} al pedir el QR`);
    e.status = res.status;
    throw e;
  }

  const tipo = res.headers.get("content-type") || "";
  if (tipo.includes("application/json")) {
    const j = await res.json().catch(() => null);
    return j?.data || j?.base64 || null;
  }
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}

// El nombre del grupo viaja en una clave distinta segun el motor y la version
// de WAHA (WEBJS usa `name`, NOWEB tiende a `subject`, y algunas versiones lo
// anidan en groupMetadata o _data). Se prueban todas: fallar por buscar en el
// lugar equivocado deja al usuario con una lista de "Grupo sin nombre" que no
// puede administrar.
function nombreDeGrupo(g) {
  return (
    g.name || g.subject || g.formattedTitle ||
    g.groupMetadata?.subject || g.groupMetadata?.name ||
    g._data?.subject || g._data?.name ||
    g.metadata?.subject || null
  );
}

function jidDeGrupo(g) {
  const v = g.id?._serialized || g.id?.user || g.id || g.jid || g.chatId || null;
  return typeof v === "string" ? v : null;
}

// Todos los grupos en los que esta la linea. Es lo que permite importarlos de
// una en vez de esperar a que llegue un mensaje en cada uno.
async function listarGrupos(nombre) {
  const r = await pedir(`/api/${encodeURIComponent(nombre)}/groups`);
  const filas = Array.isArray(r) ? r : r?.data || r?.groups || [];

  const grupos = filas
    .map((g) => ({
      jid: jidDeGrupo(g),
      nombre: nombreDeGrupo(g),
      participantes: Array.isArray(g.participants) ? g.participants.length : null,
    }))
    .filter((g) => typeof g.jid === "string" && g.jid.endsWith("@g.us"));

  // Si vinieron grupos pero ninguno con nombre, estamos leyendo la clave
  // equivocada. Se registran las CLAVES del primero (nunca sus valores: los
  // nombres de los grupos son datos de terceros) para poder corregirlo sin
  // tener que entrar a la consola del contenedor.
  if (grupos.length > 0 && !grupos.some((g) => g.nombre)) {
    console.warn(
      `[waha] ${grupos.length} grupo(s) sin nombre. Claves que devuelve WAHA:`,
      Object.keys(filas[0] || {}).join(", ") || "(objeto vacio)"
    );
  }

  return grupos;
}

module.exports = { configurado, crearSesion, estadoSesion, qr, listarGrupos };
