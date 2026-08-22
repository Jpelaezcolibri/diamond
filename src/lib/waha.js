// Cliente del API de WAHA — el servicio que sostiene la sesion vinculada a la
// linea dedicada.
//
// ═══ ESTE MODULO SI PUEDE ENVIAR. CAMBIO DELIBERADO DEL 2026-08-16 ═══
//
// Hasta el 2026-07-30 este cliente NO implementaba el envio, y no era un flag
// apagado: la capacidad no existia, y tres tests lo verificaban leyendo el
// fuente. Esa garantia se retira a proposito para que el radar pueda responder
// dentro del grupo. Conviene tener presente lo que se sabe:
//
//   · El montaje anterior SOLO LEIA y aun asi la cuenta fue baneada. O sea,
//     "no enviar" nunca fue lo que protegia: lo que WhatsApp sanciona es el
//     cliente no autorizado, no la conducta.
//   · Enviar a grupos es, ademas, el patron con mas reportes publicos de baneo
//     en este tipo de pasarelas. Esto es MAS riesgoso que lo anterior, no menos.
//
// Lo que sustituye a la vieja garantia:
//
//   1. La linea vinculada es una linea secundaria de la empresa, sacrificable.
//      Nunca la de Sofi (esta en Cloud API oficial y romperia la integracion),
//      nunca la de un asesor con clientes. Se anota en whatsapp_sessions.rol.
//   2. El envio vive en UNA sola funcion, `enviarTexto`, y nadie mas en el
//      canal puede publicar. El test group-canal lo verifica sobre el fuente.
//   3. Quien decide si se habla es src/groups/politica.js, no este modulo. Aca
//      no hay reglas de negocio: si te llaman, envias.
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
    // AQUI HABIA UN REINICIO AUTOMATICO. Se saco el 2026-08-16 por decision de
    // Juan: una sesion caida NO se levanta sola. Si esta en FAILED o STOPPED se
    // reporta y se queda ahi hasta que una persona decida reintentar.
    //
    // El motivo honesto: el 2026-07-30 la secuencia fue 503 -> 60 reintentos en
    // 5 min -> sesion trabada -> baneo. El 503 llego PRIMERO, asi que los
    // reintentos fueron consecuencia y no causa — quitar el reinicio automatico
    // NO es lo que evita un baneo. Lo que si consigue, y vale igual: que una
    // caida sea visible en vez de quedar tapada por un bucle, y que el sistema
    // no siga golpeando a WhatsApp cuando WhatsApp ya dijo que no.
    //
    // Ojo con el alcance: esto controla NUESTROS reintentos. El motor que corre
    // dentro de WAHA tiene su propia reconexion y no se apaga desde aca.
    return (await estadoSesion(nombre).catch(() => null)) || estadoSesion(nombre);
  }
}

async function estadoSesion(nombre) {
  return pedir(`/api/sessions/${encodeURIComponent(nombre)}`);
}

// Reintento MANUAL, una sola vez. No hay bucle, no hay backoff, no hay
// programador que lo llame: lo dispara una persona desde el CRM y si falla,
// falla.
//
// Conserva las credenciales (a diferencia de `revincular`), asi que no obliga a
// escanear el QR de nuevo. Es lo primero que se prueba cuando la sesion se cae
// sola; si despues de esto sigue caida, hay que mirar por que en vez de seguir
// insistiendo.
async function reintentarUnaVez(nombre) {
  const n = encodeURIComponent(nombre);
  const antes = await estadoSesion(nombre).catch(() => null);
  console.warn(`[waha] Reintento manual de ${nombre} (estaba en ${antes?.status || "desconocido"}).`);
  await pedir(`/api/sessions/${n}/restart`, { metodo: "POST" });
  const despues = await estadoSesion(nombre).catch(() => null);
  console.warn(`[waha] Tras el reintento, ${nombre} quedo en ${despues?.status || "desconocido"}.`);
  return despues;
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

// Ultimo recurso cuando el listado viene vacio: pedirle a WAHA cada grupo por
// su id, usando los jid que YA tenemos guardados.
//
// El webhook registra cada grupo apenas llega un mensaje, pero de ahi solo sale
// el jid — el nombre nunca viaja en el evento. Asi que la base termina con
// decenas de grupos anonimos mientras el listado masivo, que si trae nombres,
// devuelve cero porque el store del motor esta vacio. Consultar de a uno no
// pasa por ese store, y son datos que ya conocemos: no descubre nada nuevo,
// solo le pone nombre a lo que ya estaba.
async function nombresPorJid(sesion, jids) {
  const grupos = jids.map((jid) => ({ jid, nombre: null }));
  await completarNombres(sesion, grupos);
  const mapa = new Map();
  for (const g of grupos) if (g.nombre) mapa.set(g.jid, g.nombre);
  return mapa;
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

// La UNICA via de salida hacia WhatsApp por la linea vinculada.
//
// Devuelve { ok, wamid, error } — la misma forma que sendWhatsApp del canal
// oficial, para que quien la consuma no tenga que distinguir el transporte.
//
// No lanza: un envio fallido es un dato del flujo, no una excepcion. El
// llamador (src/groups/vivo.js) NO registra la senal como respondida cuando
// esto devuelve ok:false, porque dar por publicado algo que no salio deja al
// limite de frecuencia mintiendo.
//
// No reintenta a proposito. Un reintento ciego sobre un envio que quiza si
// salio es la forma mas facil de publicar dos veces lo mismo en un grupo, que
// es exactamente la conducta que hace que a uno lo saquen.
// replyTo (Juan, 2026-08-20): en un grupo activo el pedido original ya se
// perdio en el scroll para cuando el bot contesta — el colega no se entera
// de que le respondieron. La tentacion es escribirle al interno, pero eso es
// justo el patron que mas reportes de baneo tiene en lineas no oficiales (y
// el que se llevo la linea de julio). Citar el mensaje (WAHA `reply_to`)
// resuelve lo mismo sin salir de un grupo donde ya somos miembro: WhatsApp
// muestra la respuesta enganchada al mensaje original, con notificacion,
// aunque hayan pasado cien mensajes desde entonces.
async function enviarTexto(sesion, chatId, texto, { replyTo = null } = {}) {
  if (!configurado()) return { ok: false, error: "Falta WAHA_URL o WAHA_API_KEY" };
  if (!chatId || !String(chatId).endsWith("@g.us")) {
    // Guarda dura: este cliente existe para hablar en grupos. Un chatId que no
    // sea de grupo significa que algo aguas arriba se equivoco de destinatario,
    // y escribirle por error al privado de un colega es peor que no enviar.
    return { ok: false, error: `Destino invalido para el radar: ${chatId}` };
  }
  try {
    const body = { session: sesion, chatId, text: texto };
    if (replyTo) body.reply_to = replyTo;
    const r = await pedir("/api/sendText", { metodo: "POST", body });
    const wamid = r?.id?._serialized || r?.id || r?.key?.id || null;
    return { ok: true, wamid };
  } catch (e) {
    console.error(`[waha] No se pudo publicar en ${chatId}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// ── LIDs: de identificador oculto a telefono ────────────────────────────
//
// WhatsApp ya no expone el numero de los participantes de un grupo: manda un
// "LID" (identificador oculto, `<digitos>@lid`). Lo que este canal guarda hoy
// en `group_signals.autor_telefono` NO es un telefono — son LIDs de 14-17
// digitos, contra los 12 de un movil colombiano. Verificado sobre las senales
// reales del 2026-08-22: 12 de 12 eran LIDs.
//
// Esto NO habilita por si solo responderle al privado a un colega: la guarda de
// `enviarTexto` sigue en pie y la decision de conducta no vive aca. Existe para
// poder MEDIR cuantos colegas son alcanzables antes de disenar nada — la propia
// doc de WAHA advierte que la resolucion falla si el numero no esta en los
// contactos de la linea o si la linea no es admin del grupo, y Natalia es
// miembro, no admin.
//
// Devuelve el telefono en digitos, o null si WAHA no lo conoce. No lanza: "no
// se pudo resolver" es un dato del flujo, igual que un envio fallido.
async function telefonoDeLid(sesion, lid) {
  const digitos = String(lid || "").replace(/\D/g, "");
  if (!sesion || !digitos) return null;
  try {
    const r = await pedir(`/api/${encodeURIComponent(sesion)}/lids/${digitos}`);
    // Segun version, WAHA devuelve { pn } o { phoneNumber }, con o sin @c.us.
    const crudo = r?.pn || r?.phoneNumber || r?.phone || null;
    const telefono = String(crudo || "").replace(/\D/g, "");
    return telefono || null;
  } catch (e) {
    // 404 = no hay mapeo conocido, y es el caso esperado, no un error.
    if (e.status !== 404) console.warn(`[waha] No se pudo resolver el lid ${digitos}: ${e.message}`);
    return null;
  }
}

/** Cuantos mapeos lid→telefono conoce la sesion. Sirve de termometro barato. */
async function contarLids(sesion) {
  try {
    const r = await pedir(`/api/${encodeURIComponent(sesion)}/lids/count`);
    return typeof r?.count === "number" ? r.count : null;
  } catch (e) {
    console.warn(`[waha] No se pudo contar los lids: ${e.message}`);
    return null;
  }
}

module.exports = {
  configurado, crearSesion, estadoSesion, reintentarUnaVez, revincular, qr,
  listarGrupos, nombresPorJid, enviarTexto, telefonoDeLid, contarLids,
};
