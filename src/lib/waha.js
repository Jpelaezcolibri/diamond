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
    // Una sesion caida o detenida no se arregla reaplicando config: hay que
    // reiniciarla. Sin esto, "Vincular linea" no hacia nada util con una
    // sesion en FAILED y el unico camino visible era volver a molestar al
    // asesor con el QR — que muchas veces ni siquiera hace falta, porque las
    // credenciales siguen en el volumen.
    const estado = await estadoSesion(nombre).catch(() => null);
    if (estado && ["FAILED", "STOPPED"].includes(estado.status)) {
      console.warn(`[waha] La sesion ${nombre} esta en ${estado.status}; reiniciando.`);
      try {
        await pedir(`/api/sessions/${encodeURIComponent(nombre)}/restart`, { metodo: "POST" });
        return estadoSesion(nombre);
      } catch (e3) {
        console.error(`[waha] No se pudo reiniciar ${nombre}: ${e3.message}`);
      }
    }
    return estado || estadoSesion(nombre);
  }
}

async function estadoSesion(nombre) {
  return pedir(`/api/sessions/${encodeURIComponent(nombre)}`);
}

// Descarta las credenciales guardadas y arranca de cero para pedir un QR nuevo.
//
// Hace falta cuando WhatsApp deja de aceptar el dispositivo vinculado. El
// sintoma es inconfundible en los logs: la sesion llega hasta "logging in..."
// con el numero correcto y WhatsApp responde "Connection Failure", una y otra
// vez, hasta que WAHA se rinde con "Session stuck in STARTING status". Las
// credenciales estan ahi, pero ya no valen.
//
// Reiniciar NO arregla eso — reintenta con las mismas credenciales rechazadas y
// vuelve a morir. Hay que hacer logout: `restart` conserva la autenticacion,
// `logout` la borra. Despues del logout la sesion queda en STOPPED, asi que se
// arranca para que emita el QR.
//
// Es la unica operacion de este modulo que le cuesta algo a una persona (el
// asesor tiene que volver a escanear), por eso no se dispara sola en ningun
// lado: la pide un humano desde el CRM.
async function revincular(nombre) {
  const n = encodeURIComponent(nombre);
  await pedir(`/api/sessions/${n}/logout`, { metodo: "POST" });
  try {
    await pedir(`/api/sessions/${n}/start`, { metodo: "POST" });
  } catch (e) {
    // Arrancar puede devolver 422 si WAHA ya la levanto solo tras el logout.
    if (e.status !== 422 && e.status !== 409) throw e;
  }
  return estadoSesion(nombre);
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
//
// SI VIENE VACIO SE FUERZA UN REFRESH. El listado sale del store del motor, y
// ese store puede estar vacio aunque la sesion este funcionando perfecto: al
// reconectar, WAHA registra "Reconnection with existing sync data, skipping
// history sync wait" y NO vuelve a pedir la lista de chats. Paso exactamente
// eso el 2026-07-29 — la sesion recibia mensajes con normalidad y /groups
// devolvia cero, asi que los 80 grupos vivian solo con su jid y en pantalla
// salian todos como "Grupo sin nombre". Sin nombre el asesor no sabe donde ir
// a responder, que es el punto de todo esto.
async function listarGrupos(nombre) {
  let filas = await pedirGrupos(nombre);

  if (filas.length === 0) {
    console.warn(`[waha] La sesion ${nombre} no devolvio ningun grupo; forzando refresh del store.`);
    try {
      await pedir(`/api/${encodeURIComponent(nombre)}/groups/refresh`, { metodo: "POST" });
      filas = await pedirGrupos(nombre);
      console.log(`[waha] Tras el refresh: ${filas.length} grupo(s).`);
    } catch (e) {
      console.error(`[waha] No se pudo refrescar la lista de grupos: ${e.message}`);
    }
  }

  return normalizarGrupos(nombre, filas);
}

async function pedirGrupos(nombre) {
  const r = await pedir(`/api/${encodeURIComponent(nombre)}/groups`);
  return Array.isArray(r) ? r : r?.data || r?.groups || [];
}

async function normalizarGrupos(nombre, filas) {

  const grupos = filas
    .map((g) => ({
      jid: jidDeGrupo(g),
      nombre: nombreDeGrupo(g),
      participantes: Array.isArray(g.participants) ? g.participants.length : null,
    }))
    .filter((g) => typeof g.jid === "string" && g.jid.endsWith("@g.us"));

  // Si vinieron grupos pero ninguno con nombre, el listado masivo no expone la
  // metadata. Se piden de a uno: es una llamada por grupo, pero la importacion
  // se hace una vez y una lista de "Grupo sin nombre" no se puede administrar
  // — el usuario no sabe cual apagar.
  if (grupos.length > 0 && !grupos.some((g) => g.nombre)) {
    console.warn(
      `[waha] El listado no trae nombres. Claves que devuelve WAHA:`,
      Object.keys(filas[0] || {}).join(", ") || "(objeto vacio)",
      `— pidiendo ${grupos.length} grupo(s) de a uno.`
    );
    await completarNombres(nombre, grupos);
  }

  return grupos;
}

// Pide cada grupo individualmente para sacarle el nombre. De a 4 en paralelo.
//
// PLAZO DURO: los nombres son comodidad, la importacion es lo importante. Con
// muchos grupos y un WAHA lento, esto se pasaba del tiempo que el CRM espera al
// bot y hacia fallar la importacion ENTERA — se perdian los grupos por no
// conseguir sus nombres. Ahora, pasado el plazo, se devuelve lo que haya.
const PLAZO_NOMBRES_MS = 12000;

async function completarNombres(sesion, grupos, concurrencia = 4) {
  const limite = Date.now() + PLAZO_NOMBRES_MS;
  let i = 0;
  let vencido = false;

  const worker = async () => {
    while (i < grupos.length) {
      if (Date.now() > limite) { vencido = true; return; }
      const g = grupos[i++];
      try {
        const d = await pedir(`/api/${encodeURIComponent(sesion)}/groups/${encodeURIComponent(g.jid)}`);
        g.nombre = nombreDeGrupo(d) || nombreDeGrupo(d?.groupMetadata || {}) || null;
      } catch (e) {
        console.warn(`[waha] No se pudo leer el nombre de un grupo: ${e.message}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrencia, grupos.length) }, worker));
  if (vencido) {
    console.warn(
      `[waha] Se acabo el plazo para los nombres: ${grupos.filter((g) => g.nombre).length}/${grupos.length} resueltos. ` +
      "La importacion sigue; volve a importar para completar el resto."
    );
  }
}

module.exports = { configurado, crearSesion, estadoSesion, revincular, qr, listarGrupos };
