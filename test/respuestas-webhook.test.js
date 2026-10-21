const { test } = require("node:test");
const assert = require("node:assert");

const config = require("../src/config");
config.groups.webhookSecret = "secreto-de-prueba";

const wg = require("../src/channels/whatsapp-group");
const waha = require("../src/lib/waha");
const organizations = require("../src/data/organizations");
const whatsappGroups = require("../src/data/whatsapp-groups");
const lineaDm = require("../src/data/linea-dm");
const respuestas = require("../src/groups/respuestas-publicacion");

wg._configSalida.graciaMs = 0;

test("normalizar conserva el id del mensaje citado", () => {
  const ev = wg._normalizar({ session: "S", payload: { id: "m1", from: "g@g.us", body: "info", replyTo: { id: "3EB0WAMID" } } });
  assert.strictEqual(ev.replyToId, "3EB0WAMID");
  const sin = wg._normalizar({ session: "S", payload: { id: "m2", from: "g@g.us", body: "x" } });
  assert.strictEqual(sin.replyToId, null);
});

test("un wamid enviado por el sistema se reconoce como propio, en forma completa o desnuda", () => {
  waha._recordarEnvioPropio("3EBPROPIO");
  assert.strictEqual(waha.esEnvioPropio("3EBPROPIO"), true);
  assert.strictEqual(waha.esEnvioPropio("3EBHUMANO"), false);
  waha._recordarEnvioPropio("true_123@lid_3EBFULL");
  assert.strictEqual(waha.esEnvioPropio("3EBFULL"), true);
  assert.strictEqual(waha.esEnvioPropio("true_123@lid_3EBFULL"), true);
  assert.strictEqual(waha.esEnvioPropio(null), false);
});

test("la sesion se suscribe a message y message.any", () => {
  assert.deepStrictEqual(waha.EVENTOS_SESION, ["message", "message.any"]);
});

function rutaPost() {
  const capa = wg.stack.find((c) => c.route?.path === "/webhook/grupos" && c.route.methods.post);
  return capa.route.stack[capa.route.stack.length - 1].handle;
}
function resFalsa() {
  const r = { cuerpo: null, headersSent: false };
  r.status = () => r;
  r.json = (b) => { r.cuerpo = b; r.headersSent = true; return r; };
  return r;
}
function pedido(event, payload) {
  return { headers: { "x-api-key": "secreto-de-prueba" }, body: { event, session: "RADA", payload: { timestamp: Math.floor(Date.now() / 1000), ...payload } } };
}
function preparar(t) {
  t.mock.method(organizations, "getDefault", async () => ({ id: "org-1" }));
  t.mock.method(whatsappGroups, "sesionPorNombre", async () => ({ id: "s", escucha_desde: new Date(Date.now() - 86400e3).toISOString() }));
  t.mock.method(whatsappGroups, "touchSession", async () => {});
  const llamadas = { create: [], atendida: [], deGrupo: [] };
  t.mock.method(lineaDm, "create", async (o, f) => { llamadas.create.push(f); return { mensaje: null, duplicado: false }; });
  t.mock.method(respuestas, "atendidaPorLinea", async (o, i) => { llamadas.atendida.push(i); return 1; });
  t.mock.method(respuestas, "deGrupo", async (o, a) => { llamadas.deGrupo.push(a); return null; });
  return llamadas;
}
const dormir = () => new Promise((r) => setTimeout(r, 30));

test("message.any fromMe a un @lid con wamid no propio: salida humana", async (t) => {
  const l = preparar(t);
  const res = resFalsa();
  await rutaPost()(pedido("message.any", { id: "true_900@lid_HUM1", from: "5731@c.us", to: "900@lid", fromMe: true, body: "te llamo" }), res);
  assert.strictEqual(res.cuerpo.ok, true);
  assert.deepStrictEqual(l.atendida, [{ telefono: null, lid: "900@lid" }]);
  assert.strictEqual(l.create.length, 1);
  assert.strictEqual(l.create[0].direccion, "salida");
  assert.strictEqual(l.create[0].remitenteLid, "900@lid");
});

test("message.any fromMe con wamid propio (incluso id desnudo) no hace nada", async (t) => {
  const l = preparar(t);
  waha._recordarEnvioPropio("true_901@lid_SISTEMA1");
  const res = resFalsa();
  await rutaPost()(pedido("message.any", { id: "SISTEMA1", from: "901@lid", fromMe: true, body: "dm del radar" }), res);
  assert.strictEqual(l.create.length, 0);
  assert.strictEqual(l.atendida.length, 0);
});

test("message.any con fromMe false se ignora (ya llego por message)", async (t) => {
  const l = preparar(t);
  const res = resFalsa();
  await rutaPost()(pedido("message.any", { id: "ENT1", from: "902@lid", fromMe: false, body: "hola" }), res);
  assert.strictEqual(res.cuerpo.ok, true);
  assert.strictEqual(l.create.length, 0);
  assert.strictEqual(l.atendida.length, 0);
});

test("message de grupo con replyToId llama a deGrupo", async (t) => {
  const l = preparar(t);
  t.mock.method(whatsappGroups, "whitelist", async () => new Map([["g1@g.us", { id: "gr1", nombre: "Grupo" }]]));
  const vivo = require("../src/groups/vivo");
  t.mock.method(vivo, "procesarMensaje", async () => ({ resultado: "ruido" }));
  const res = resFalsa();
  await rutaPost()(pedido("message", { id: "GM1", from: "g1@g.us", participant: "77@lid", fromMe: false, body: "info", replyTo: { id: "3EB0WAMID" }, notifyName: "Pedro" }), res);
  await dormir();
  assert.strictEqual(l.deGrupo.length, 1);
  assert.strictEqual(l.deGrupo[0].replyToId, "3EB0WAMID");
  assert.strictEqual(l.deGrupo[0].autorId, "77@lid");
});

test("message.any fromMe viejo (reentrega de WAHA) no escribe ni marca atendida", async (t) => {
  const l = preparar(t);
  const res = resFalsa();
  const viejo = Math.floor((Date.now() - 3 * 86400e3) / 1000);
  await rutaPost()(pedido("message.any", { id: "true_950@lid_VIEJO1", from: "5731@c.us", to: "950@lid", fromMe: true, body: "hola", timestamp: viejo }), res);
  assert.strictEqual(l.create.length, 0);
  assert.strictEqual(l.atendida.length, 0);
});

test("fromMe a un grupo no escribe nada ni busca la organizacion", async (t) => {
  const l = preparar(t);
  const org = organizations.getDefault;
  const res = resFalsa();
  await rutaPost()(pedido("message.any", { id: "ECO1", from: "g1@g.us", fromMe: true, body: "post" }), res);
  assert.strictEqual(res.cuerpo.ok, true);
  assert.strictEqual(org.mock.callCount(), 0);
  assert.strictEqual(l.create.length, 0);
  assert.strictEqual(l.atendida.length, 0);
});

test("grupo de publicacion fuera de la escucha: registra la respuesta citada sin radar", async (t) => {
  const l = preparar(t);
  t.mock.method(whatsappGroups, "whitelist", async () => new Map());
  t.mock.method(whatsappGroups, "grupoDePublicacion", async (o, jid) => (jid === "gp@g.us" ? { id: "gp", nombre: "Pub" } : null));
  const reg = t.mock.method(whatsappGroups, "registrarGrupo", async () => {});
  const vivo = require("../src/groups/vivo");
  const radar = t.mock.method(vivo, "procesarMensaje", async () => ({ resultado: "ruido" }));
  const res = resFalsa();
  await rutaPost()(pedido("message", { id: "GP1", from: "gp@g.us", participant: "88@lid", fromMe: false, body: "info", replyTo: { id: "3EBPOST" }, notifyName: "Ana" }), res);
  await dormir();
  assert.strictEqual(l.deGrupo.length, 1);
  assert.strictEqual(l.deGrupo[0].replyToId, "3EBPOST");
  assert.strictEqual(radar.mock.callCount(), 0);
  assert.strictEqual(reg.mock.callCount(), 0);
  // un grupo cualquiera no escuchado y sin publica: nada
  await rutaPost()(pedido("message", { id: "GP2", from: "otro@g.us", participant: "88@lid", fromMe: false, body: "info", replyTo: { id: "3EBPOST" } }), resFalsa());
  await dormir();
  assert.strictEqual(l.deGrupo.length, 1);
  assert.strictEqual(reg.mock.callCount(), 1);
});

test("linea-dm: la salida no entra en el historial del colega (memoria)", async () => {
  const memory = require("../src/data/memory");
  memory.lineaDm = [];
  await lineaDm.create("o9", { waMessageId: "e1", remitenteLid: "5@lid", texto: "del colega" });
  await lineaDm.create("o9", { waMessageId: "s1", remitenteLid: "5@lid", texto: "de la linea", direccion: "salida" });
  const h = await lineaDm.historialDe("o9", { lid: "5@lid" });
  assert.deepStrictEqual(h.map((m) => m.texto), ["del colega"]);
});
