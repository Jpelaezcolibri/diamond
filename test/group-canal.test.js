// El canal de escucha en vivo y la frontera del envio.
//
// ═══ POR QUE ESTE ARCHIVO EXISTE Y QUE REEMPLAZA ═══
//
// Hasta el 2026-07-30 habia TRES tests (group-canal, group-fase2,
// group-waha-qr) que leian el fuente para probar que el sistema NO podia enviar
// nada por la linea vinculada. Esa garantia se retiro a proposito el 2026-08-16
// para que el radar pueda responder dentro del grupo.
//
// Retirarla sin poner nada en su lugar seria el error. La garantia nueva es mas
// debil pero sigue siendo verificable: el envio existe en UNA sola funcion
// (`waha.enviarTexto`), y ningun otro punto del canal puede publicar. Si alguien
// agrega un fetch al canal, o un segundo endpoint de envio al cliente de WAHA,
// esta suite falla.
//
// Se verifica sobre el TEXTO del fuente, no sobre los exports: el canal exporta
// un router de Express, asi que mirar los exports daria un falso negativo el dia
// que alguien meta un envio dentro de un handler sin exportarlo.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), "utf8");

// Quita comentarios de linea y de bloque: los encabezados de estos modulos
// hablan largo de /api/sendText y de fetch, y no son codigo.
function soloCodigo(fuente) {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("el canal no tiene ninguna via de salida propia", () => {
  // Todo lo que publica pasa por waha.enviarTexto. Si aparece un fetch, un
  // axios o una llamada directa al API de WAHA aca, hay una segunda puerta.
  const codigo = soloCodigo(leer("src/channels/whatsapp-group.js"));
  for (const prohibido of ["fetch(", "axios", "http.request", "/api/send", "sendText(", "sendMessage("]) {
    assert.ok(
      !codigo.includes(prohibido),
      `El canal no puede contener "${prohibido}": el envio vive solo en waha.enviarTexto`
    );
  }
});

test("el canal cita el mensaje original al responder (replyTo), no solo lo publica suelto", () => {
  // Juan, 2026-08-20: en un grupo activo el pedido ya se perdio en el scroll
  // para cuando el bot contesta. Sin citarlo, el colega no se entera de que
  // le respondieron a EL especificamente.
  const codigo = soloCodigo(leer("src/channels/whatsapp-group.js"));
  assert.match(codigo, /enviarTexto\(ev\.sesion, ev\.chatId, texto, \{ replyTo: ev\.waMessageId \}\)/);
});

test("el cliente de WAHA expone exactamente UN endpoint de envio", () => {
  const codigo = soloCodigo(leer("src/lib/waha.js"));
  // El unico endpoint de escritura de mensajes permitido.
  const envios = codigo.match(/\/api\/send\w*/g) || [];
  assert.deepStrictEqual(
    [...new Set(envios)],
    ["/api/sendText"],
    "Si aparece otro /api/send*, hay una capacidad nueva que nadie decidio agregar"
  );
  // Y una sola funcion que lo use.
  const funciones = codigo.match(/async function (\w+)/g) || [];
  assert.ok(funciones.includes("async function enviarTexto"));
  assert.strictEqual(
    (codigo.match(/"\/api\/sendText"/g) || []).length,
    1,
    "El endpoint de envio se menciona una sola vez, dentro de enviarTexto"
  );
});

test("enviarTexto se niega a escribir fuera de un grupo", async () => {
  // Guarda dura: este cliente existe para hablar en grupos gremiales. Un
  // chatId que no sea de grupo significa que algo aguas arriba se equivoco de
  // destinatario, y escribirle por error al privado de un colega es peor que
  // no enviar nada.
  process.env.WAHA_URL = "http://waha.test";
  process.env.WAHA_API_KEY = "x";
  const waha = require("../src/lib/waha");

  const privado = await waha.enviarTexto("sesion", "573001234567@c.us", "hola");
  assert.strictEqual(privado.ok, false);
  assert.match(privado.error, /Destino invalido/);

  const vacio = await waha.enviarTexto("sesion", null, "hola");
  assert.strictEqual(vacio.ok, false);
});

// replyTo (Juan, 2026-08-20): citar el pedido original en vez de escribirle
// al interno del colega — mismo problema (que se entere que le respondieron
// en un grupo activo) sin el riesgo de un mensaje 1:1 no solicitado.
test("enviarTexto manda reply_to cuando se lo pasan, y lo omite cuando no", async (t) => {
  process.env.WAHA_URL = "http://waha.test";
  process.env.WAHA_API_KEY = "x";
  const waha = require("../src/lib/waha");

  let ultimoBody = null;
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    ultimoBody = JSON.parse(opts.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: { _serialized: "wamid-1" } }) };
  });

  await waha.enviarTexto("sesion", "123@g.us", "hola", { replyTo: "false_123@g.us_ABC" });
  assert.strictEqual(ultimoBody.reply_to, "false_123@g.us_ABC");

  await waha.enviarTexto("sesion", "123@g.us", "hola");
  assert.strictEqual("reply_to" in ultimoBody, false, "sin replyTo no se manda el campo, ni siquiera en null");
});

test("sin configuracion de WAHA no se intenta enviar nada", async () => {
  const url = process.env.WAHA_URL;
  delete process.env.WAHA_URL;
  const waha = require("../src/lib/waha");
  const r = await waha.enviarTexto("sesion", "123@g.us", "hola");
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /WAHA_URL/);
  if (url) process.env.WAHA_URL = url;
});

test("una sesion caida NO se levanta sola", () => {
  // Decision de Juan (2026-08-16). El 2026-07-30 la secuencia fue 503 -> 60
  // reintentos en 5 min -> sesion trabada -> baneo.
  //
  // Importante para no confundirse: el 503 llego PRIMERO, asi que los reintentos
  // fueron consecuencia y no causa — esto NO es lo que evita un baneo. Lo que
  // consigue es que una caida sea visible en vez de quedar tapada por un bucle,
  // y que el sistema no siga golpeando cuando ya le dijeron que no.
  const waha = soloCodigo(leer("src/lib/waha.js"));

  // El unico /restart permitido es el del reintento manual.
  const restarts = waha.match(/\/restart/g) || [];
  assert.strictEqual(restarts.length, 1, "solo puede haber un punto que reinicie, y es el manual");
  const i = waha.indexOf("/restart");
  const fn = waha.lastIndexOf("async function", i);
  assert.ok(
    waha.slice(fn, i).includes("reintentarUnaVez"),
    "el unico reinicio tiene que estar dentro de reintentarUnaVez"
  );

  // Y crearSesion no puede reiniciar por su cuenta: antes lo hacia.
  const crear = waha.slice(waha.indexOf("async function crearSesion"), waha.indexOf("async function estadoSesion"));
  assert.ok(!crear.includes("/restart"), "vincular una linea no puede reiniciar una sesion caida");

  // Nada de temporizadores: un reintento programado es un bucle con otro nombre.
  for (const p of ["setInterval", "setTimeout"]) {
    assert.ok(!waha.includes(p), `waha.js no puede usar ${p}: seria una reconexion automatica`);
  }
});

test("el reintento manual no lo dispara ningun programador", () => {
  // Existe un solo llamador y es un endpoint HTTP, o sea una persona.
  const crm = soloCodigo(leer("src/api/crm.js"));
  assert.ok(crm.includes('"/api/grupos/sesion/reintentar"'));
  assert.ok(crm.includes("waha.reintentarUnaVez"));
  const scheduler = soloCodigo(leer("src/scheduler/group-digest.js"));
  assert.ok(!scheduler.includes("reintentar"), "ningun worker puede reintentar la sesion");
});

test("el canal descarta lo que no es grupo antes de tocar la base", () => {
  // INVARIANTE 1. El orden importa: el descarte tiene que estar ANTES de
  // organizations.getDefault(), o los chats privados de la linea llegarian a
  // generar consultas y logs.
  const codigo = soloCodigo(leer("src/channels/whatsapp-group.js"));
  const guardia = codigo.indexOf("!esGrupo(ev.chatId)");
  const primeraConsulta = codigo.indexOf("organizations.getDefault()");
  assert.ok(guardia > 0, "tiene que existir el guard de @g.us");
  assert.ok(primeraConsulta > guardia, "el descarte va antes de cualquier consulta");
});

test("el permiso de responder es distinto del de escuchar, y nace apagado", () => {
  const whatsappGroups = require("../src/data/whatsapp-groups");
  const codigo = soloCodigo(leer("src/data/whatsapp-groups.js"));

  // Importar una linea trae TODOS sus grupos de golpe (la asesora de julio
  // tenia 80). Si `responde` naciera en true, un clic pondria al bot a hablar
  // en ochenta grupos gremiales a la vez.
  assert.ok(codigo.includes("responde: false"), "un grupo nuevo nace sin permiso de responder");
  assert.strictEqual(typeof whatsappGroups.setResponde, "function");
  // Y se cambia por una funcion propia, no como efecto secundario de setModo.
  const setModo = codigo.slice(codigo.indexOf("async function setModo"), codigo.indexOf("async function setResponde"));
  assert.ok(!setModo.includes("responde"), "setModo no puede tocar el permiso de publicar");
});

test("la lista blanca falla cerrada y no inventa el permiso", async () => {
  // Si la migracion no corrio, la columna `responde` no viene: el grupo queda
  // sin permiso en vez de heredar un true optimista.
  const codigo = soloCodigo(leer("src/data/whatsapp-groups.js"));
  assert.ok(codigo.includes("responde: g.responde === true"));
  assert.ok(codigo.includes("return new Map()"), "ante un error, mapa vacio: quedamos sordos, no abiertos");
});

test("apagar el radar cierra TODAS las puertas que tocan WhatsApp", () => {
  // La leccion del 2026-07-30: GROUPS_ENABLED=false frenaba el webhook pero no
  // estos endpoints, asi que un clic en "Vincular linea" desde el CRM podia
  // re-parear el numero mientras Meta revisaba la cuenta suspendida. Un
  // interruptor que deja una puerta abierta no es un interruptor.
  const codigo = soloCodigo(leer("src/api/crm.js"));
  for (const ruta of [
    '"/api/grupos/sesion"',
    '"/api/grupos/sesion/estado"',
    '"/api/grupos/sesion/revincular"',
    '"/api/grupos/importar"',
  ]) {
    const i = codigo.indexOf(ruta);
    assert.ok(i > 0, `falta la ruta ${ruta}`);
    const declaracion = codigo.slice(i, i + 120);
    assert.ok(
      declaracion.includes("requiereGruposActivos"),
      `${ruta} tiene que estar detras de requiereGruposActivos: toca la linea de WhatsApp`
    );
  }
});

test("lo que NO toca WhatsApp sigue disponible con el radar apagado", () => {
  // Leer lo ya guardado y administrar permisos no parea ninguna linea. Meterlos
  // detras de la guarda dejaria al asesor sin poder apagar un grupo justo
  // cuando mas lo necesita.
  const codigo = soloCodigo(leer("src/api/crm.js"));
  for (const ruta of ['"/api/grupos/listar"', '"/api/grupos/responde"', '"/api/grupos/modo"']) {
    const i = codigo.indexOf(ruta);
    assert.ok(i > 0, `falta la ruta ${ruta}`);
    assert.ok(!codigo.slice(i, i + 120).includes("requiereGruposActivos"), `${ruta} no deberia estar bloqueada`);
  }
});

test("el canal solo se monta con las dos variables puestas", () => {
  const codigo = soloCodigo(leer("src/server.js"));
  assert.ok(codigo.includes("config.groups.webhookSecret && config.groups.enabled"));
  // GROUPS_ENABLED tiene que exigir el string exacto: cualquier otra cosa deja
  // el canal apagado en vez de encenderlo por accidente.
  assert.ok(soloCodigo(leer("src/config.js")).includes('process.env.GROUPS_ENABLED === "true"'));
});
