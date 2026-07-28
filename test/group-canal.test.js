// Tests del canal de escucha de grupos. Cada invariante de privacidad del
// diseño tiene el suyo: son la promesa que le hacemos al asesor para que
// acepte vincular su línea, y si se rompe una, se rompe el trato.
//
// Como en test/ally-tool.test.js: los data modules crean un cliente Supabase
// REAL si SUPABASE_URL está en el .env (así está este repo, apuntando a
// producción), así que se mockean. Y no se levanta servidor HTTP: se invoca el
// router directo con req/res falsos — más rápido, y sin el keep-alive de fetch
// que deja el proceso de test colgado.
process.env.GROUPS_WEBHOOK_SECRET = "secreto-de-prueba";

const { test, mock, beforeEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const canal = require("../src/channels/whatsapp-group");
const buffer = require("../src/groups/buffer");
const whatsappGroups = require("../src/data/whatsapp-groups");
const organizations = require("../src/data/organizations");

const SECRETO = "secreto-de-prueba";
const GRUPO_JID = "120363111111111111@g.us";
const PRIVADO_JID = "573001234567@c.us";
const ORG = { id: "org-test" };

let registrados = [];
let listaBlanca = new Map();

beforeEach(() => {
  mock.restoreAll();
  buffer._reset();
  registrados = [];
  listaBlanca = new Map();
  mock.method(organizations, "getDefault", async () => ORG);
  mock.method(whatsappGroups, "whitelist", async () => listaBlanca);
  mock.method(whatsappGroups, "registrarGrupo", async (orgId, { jid }) => {
    registrados.push(jid);
    return { id: "g1", jid, modo: "ignorar" };
  });
  mock.method(whatsappGroups, "touchSession", async () => {});
});

function habilitar(modo = "sombra") {
  listaBlanca.set(GRUPO_JID, { id: "g1", modo, nombre: "Inmobiliarias Medellín" });
}

function evento({ chatId = GRUPO_JID, texto = "Tengo cliente para apto en Laureles hasta 400 millones", id = `msg_${Math.random()}`, fromMe = false } = {}) {
  return {
    event: "message",
    session: "asesor1",
    payload: { id, from: chatId, participant: "573009999999@c.us", body: texto, fromMe, timestamp: 1, _data: { notifyName: "Colega" } },
  };
}

// Invoca el router de express con req/res falsos. El handler sólo usa
// res.status().json() y res.json().
function postear(body, secreto = SECRETO) {
  return new Promise((resolve, reject) => {
    const req = {
      method: "POST",
      url: "/webhook/grupos",
      headers: secreto ? { "x-api-key": secreto } : {},
      body,
    };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(payload) { resolve({ status: this.statusCode, json: payload }); return this; },
    };
    canal(req, res, (err) => (err ? reject(err) : resolve({ status: 404, json: null })));
  });
}

// ══ INVARIANTE 3 ═════════════════════════════════════════════════════════

test("INVARIANTE 3: el canal no puede enviar nada — no hay salida hacia WhatsApp", () => {
  // No es un flag apagado que alguien pueda prender con prisa: la capacidad no
  // existe. Es lo que mantiene el riesgo de baneo de la línea del asesor en
  // cero, y lo que hace que la decisión no quede abierta a futuro.
  //
  // Se verifica sobre el FUENTE, no sobre los exports: el módulo exporta un
  // router de Express, y un router trae .post/.get propios (registrar rutas,
  // nada que ver con enviar mensajes). Mirar los exports daría un falso
  // positivo y, peor, un falso negativo el día que alguien agregue el envío
  // dentro de un handler sin exportarlo.
  const fuente = fs.readFileSync(path.join(__dirname, "..", "src", "channels", "whatsapp-group.js"), "utf8");
  const codigo = fuente.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

  for (const prohibido of ["sendText", "sendMessage", "sendImage", "/api/send", "sendSeen", "startTyping"]) {
    assert.ok(!codigo.includes(prohibido), `el canal menciona '${prohibido}': eso es capacidad de envío`);
  }
  // Ninguna llamada saliente, de ningún tipo: el canal sólo recibe.
  for (const saliente of ["fetch(", "axios", "http.request", "https.request"]) {
    assert.ok(!codigo.includes(saliente), `el canal hace una llamada saliente con '${saliente}'`);
  }
});

// ══ INVARIANTE 1 ═════════════════════════════════════════════════════════

test("INVARIANTE 1: un chat privado del asesor se descarta y no toca nada", async () => {
  habilitar();
  const r = await postear(evento({ chatId: PRIVADO_JID, texto: "Amor, ¿compraste la leche? 400 millones de gracias" }));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(buffer.estado().recibidos, 0);
  assert.strictEqual(buffer.estado().pendientes, 0);
  assert.deepStrictEqual(registrados, [], "un chat privado no puede quedar registrado ni como grupo");
});

test("INVARIANTE 1: el chat privado se descarta ANTES de resolver la org", async () => {
  // Si el guard estuviera después de la consulta, un fallo de Supabase podría
  // dejar pasar contenido privado por el camino del catch.
  const getDefault = mock.method(organizations, "getDefault", async () => {
    throw new Error("Supabase caído");
  });
  const r = await postear(evento({ chatId: PRIVADO_JID }));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(getDefault.mock.callCount(), 0, "no se debe consultar nada antes de descartar el chat privado");
});

test("un status@broadcast se descarta", async () => {
  habilitar();
  await postear(evento({ chatId: "status@broadcast" }));
  assert.strictEqual(buffer.estado().recibidos, 0);
});

test("un evento que no es 'message' se descarta", async () => {
  habilitar();
  await postear({ event: "message.ack", session: "s", payload: { id: "x", from: GRUPO_JID } });
  assert.strictEqual(buffer.estado().recibidos, 0);
});

// ══ INVARIANTE 2 ═════════════════════════════════════════════════════════

test("INVARIANTE 2: un grupo que no está en la lista blanca no procesa nada", async () => {
  // listaBlanca vacía = todos los grupos en 'ignorar'.
  await postear(evento());
  assert.deepStrictEqual(registrados, [GRUPO_JID], "el grupo debe quedar registrado para poder prenderlo");
  assert.strictEqual(buffer.estado().recibidos, 0);
  assert.strictEqual(buffer.estado().pendientes, 0);
});

test("INVARIANTE 2: al registrar un grupo nuevo NO se manda su contenido", async () => {
  const registrar = mock.method(whatsappGroups, "registrarGrupo", async () => ({ id: "g1", modo: "ignorar" }));
  await postear(evento({ texto: "un secreto que no debe salir de aquí" }));
  const args = registrar.mock.calls[0].arguments[1];
  assert.deepStrictEqual(Object.keys(args), ["jid"], "sólo se registra el JID, nunca el texto");
});

test("un grupo habilitado sí procesa el mensaje", async () => {
  habilitar("sombra");
  await postear(evento());
  assert.strictEqual(buffer.estado().recibidos, 1);
  assert.strictEqual(buffer.estado().pendientes, 1);
});

test("FALLA CERRADA: si la lista blanca revienta, no pasa nada", async () => {
  // Un error que abriera la puerta sería una fuga silenciosa de los chats del
  // asesor, y eso no se puede deshacer.
  habilitar();
  mock.method(whatsappGroups, "whitelist", async () => { throw new Error("Supabase caído"); });
  const r = await postear(evento());
  assert.strictEqual(r.status, 200);
  assert.strictEqual(buffer.estado().pendientes, 0);
});

// ══ INVARIANTE 4 ═════════════════════════════════════════════════════════

test("INVARIANTE 4: lo que no pasa el prefiltro no llega al buffer", async () => {
  habilitar("sombra");
  await postear(evento({ texto: "Buenos días a todos" }));
  assert.strictEqual(buffer.estado().recibidos, 1);
  assert.strictEqual(buffer.estado().prefiltrados, 1);
  assert.strictEqual(buffer.estado().pendientes, 0, "el ruido no puede quedar en memoria esperando IA");
});

// ══ Autenticación y robustez ═════════════════════════════════════════════

test("sin el secreto correcto el webhook responde 401", async () => {
  assert.strictEqual((await postear(evento(), "otro")).status, 401);
  assert.strictEqual((await postear(evento(), null)).status, 401);
});

test("lo que escribe el propio asesor no se procesa", async () => {
  habilitar("sombra");
  await postear(evento({ fromMe: true }));
  assert.strictEqual(buffer.estado().pendientes, 0);
});

test("el mismo mensaje visto dos veces sólo se procesa una", async () => {
  // Pasa de verdad: dos asesores en el mismo grupo, o un reintento de WAHA.
  habilitar("sombra");
  const ev = evento({ id: "msg_repetido_unico" });
  await postear(ev);
  await postear(ev);
  assert.strictEqual(buffer.estado().pendientes, 1);
});

test("un payload roto no tumba el webhook", async () => {
  habilitar("sombra");
  assert.strictEqual((await postear({})).status, 200);
  assert.strictEqual((await postear({ event: "message" })).status, 200);
  assert.strictEqual((await postear({ event: "message", payload: { from: GRUPO_JID } })).status, 200);
  assert.strictEqual(buffer.estado().pendientes, 0);
});

// ══ Normalización del payload de WAHA ════════════════════════════════════

test("normalizar distingue el grupo del autor real", () => {
  // En un grupo, `from` es el JID del grupo y `participant` es quien escribió.
  const n = canal._normalizar(evento());
  assert.strictEqual(n.chatId, GRUPO_JID);
  assert.strictEqual(n.autorId, "573009999999@c.us");
  assert.strictEqual(n.autorNombre, "Colega");
});

test("esGrupo sólo acepta @g.us", () => {
  assert.strictEqual(canal._esGrupo(GRUPO_JID), true);
  assert.strictEqual(canal._esGrupo(PRIVADO_JID), false);
  assert.strictEqual(canal._esGrupo("status@broadcast"), false);
  assert.strictEqual(canal._esGrupo(null), false);
  assert.strictEqual(canal._esGrupo(undefined), false);
});
