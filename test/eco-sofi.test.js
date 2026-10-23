// Eco de la linea de Sofi en la linea del radar (caso real, 2026-10-21 al 23).
//
// Sofi le escribe a Daiana por la linea OFICIAL (Cloud API): el resumen de
// pedidos de 12 m. y 5 p. m., el aviso "Respuestas sin atender", el
// mantenimiento de la ventana. Esos mensajes llegan a la linea VINCULADA de
// Daiana como un DM entrante de un contacto llamado "Diamond" (lid
// 48297494470698). Como nombran refs, respuestas-publicacion#deLinea los
// registraba como respuesta de un colega a nuestra publicacion (3 de las 7
// filas de la tabla eran de este origen) y el siguiente resumen los volvia a
// listar: un bucle. Y con RADAR_SOFI_LINEA encendido, Sofi se contestaria a
// si misma.
//
// La regla: un DM cuyo texto es un mensaje que Sofi mando hace poco por la
// linea oficial NO es de un colega. No se guarda, no se atribuye, no se
// contesta. Falla abierta: si la base no responde, el mensaje sigue su camino
// normal (nunca se le calla a un colega por una duda).

const { test } = require("node:test");
const assert = require("node:assert");
const eco = require("../src/groups/eco-sofi");

const ORG = { id: "org-1", contact_whatsapp_number: "573044653609" };
const RESUMEN = "*5. Inverex* · ARRIENDOS 7AM 8PM · vie, 11:52 a. m.\n📞 sin número: escríbele desde el grupo\n*Pidió:* Se busca apartamento moderno 2-3 habitaciones San Lucas";

function base(filas, { error = null } = {}) {
  const llamadas = [];
  const c = {
    select: () => c, eq: (k, v) => { llamadas.push(["eq", k, v]); return c; },
    gte: (k, v) => { llamadas.push(["gte", k, v]); return c; },
    limit: () => c,
    then: (resolve) => resolve({ data: error ? null : filas, error }),
  };
  return { from: (t) => { llamadas.push(["from", t]); return c; }, llamadas };
}

test("el telefono de la linea oficial de Sofi es eco, sin consultar la base", async (t) => {
  eco._reset();
  const sb = base([]);
  t.mock.method(eco, "_supabase", () => sb);
  assert.strictEqual(await eco.esEcoDeSofi(ORG, { texto: "hola", telefono: "573044653609", lid: null }), true);
  assert.strictEqual(sb.llamadas.length, 0);
});

test("un resumen que Sofi mando hace poco por la linea oficial es eco", async (t) => {
  eco._reset();
  const sb = base([{ id: "m-1" }]);
  t.mock.method(eco, "_supabase", () => sb);
  const r = await eco.esEcoDeSofi(ORG, { texto: RESUMEN, lid: "48297494470698@lid", telefono: null });
  assert.strictEqual(r, true);
  assert.deepStrictEqual(sb.llamadas[0], ["from", "messages"]);
  assert.ok(sb.llamadas.some(([op, k, v]) => op === "eq" && k === "role" && v === "assistant"));
  assert.ok(sb.llamadas.some(([op, k, v]) => op === "eq" && k === "content" && v === RESUMEN));
  assert.ok(sb.llamadas.some(([op, k]) => op === "gte" && k === "created_at"));
});

test("el lid que ya se reconocio como Sofi queda aprendido: lo siguiente del mismo lid es eco sin consulta", async (t) => {
  eco._reset();
  const sb = base([{ id: "m-1" }]);
  t.mock.method(eco, "_supabase", () => sb);
  assert.strictEqual(await eco.esEcoDeSofi(ORG, { texto: RESUMEN, lid: "48297494470698@lid" }), true);
  const antes = sb.llamadas.length;
  assert.strictEqual(await eco.esEcoDeSofi(ORG, { texto: "Hola", lid: "48297494470698@lid" }), true);
  assert.strictEqual(sb.llamadas.length, antes, "no vuelve a la base");
});

test("un texto corto no se compara: 'Hola' de un colega nunca es eco aunque Sofi haya dicho 'Hola'", async (t) => {
  eco._reset();
  const sb = base([{ id: "m-1" }]);
  t.mock.method(eco, "_supabase", () => sb);
  assert.strictEqual(await eco.esEcoDeSofi(ORG, { texto: "Hola", lid: "1@lid" }), false);
  assert.strictEqual(await eco.esEcoDeSofi(ORG, { texto: "", lid: "1@lid" }), false);
  assert.strictEqual(sb.llamadas.length, 0);
});

test("un colega de verdad no es eco", async (t) => {
  eco._reset();
  const sb = base([]);
  t.mock.method(eco, "_supabase", () => sb);
  const r = await eco.esEcoDeSofi(ORG, { texto: "Buenas, ¿la 10505566 sigue disponible? Tengo un cliente para mostrarla el sábado", lid: "1@lid", telefono: null });
  assert.strictEqual(r, false);
});

test("falla abierta: si la base revienta, el mensaje sigue como de un colega", async (t) => {
  eco._reset();
  const sb = base(null, { error: { message: "timeout" } });
  t.mock.method(eco, "_supabase", () => sb);
  assert.strictEqual(await eco.esEcoDeSofi(ORG, { texto: RESUMEN, lid: "1@lid" }), false);
  t.mock.method(eco, "_supabase", () => { throw new Error("sin cliente"); });
  assert.strictEqual(await eco.esEcoDeSofi(ORG, { texto: RESUMEN, lid: "2@lid" }), false);
});

test("sin numero de la org cae al env CONTACT_WHATSAPP_NUMBER", async (t) => {
  eco._reset();
  const previo = process.env.CONTACT_WHATSAPP_NUMBER;
  process.env.CONTACT_WHATSAPP_NUMBER = "573044653609";
  t.after(() => { if (previo === undefined) delete process.env.CONTACT_WHATSAPP_NUMBER; else process.env.CONTACT_WHATSAPP_NUMBER = previo; });
  t.mock.method(eco, "_supabase", () => base([]));
  assert.strictEqual(await eco.esEcoDeSofi({ id: "org-1" }, { texto: "x", telefono: "57 304 465 3609" }), true);
});

// ── Cableado: dm.procesarMensaje corta ANTES de guardar, atribuir o contestar.
test("dm.procesarMensaje: el eco no se guarda en linea_dm ni se registra como respuesta a una publicacion", async (t) => {
  eco._reset();
  const dm = require("../src/groups/dm");
  const lineaDm = require("../src/data/linea-dm");
  const groupSignals = require("../src/data/group-signals");
  const rp = require("../src/groups/respuestas-publicacion");
  t.mock.method(eco, "esEcoDeSofi", async () => true);
  const create = t.mock.method(lineaDm, "create", async () => ({ mensaje: { id: "dm-1" }, duplicado: false }));
  const buscar = t.mock.method(groupSignals, "buscarPorLid", async () => null);
  const registrar = t.mock.method(rp, "deLinea", async () => ({ id: "r-1" }));

  const r = await dm.procesarMensaje(ORG, {
    waMessageId: "w-1", sesion: "DaianaDiamond", remitenteLid: "48297494470698@lid", remitenteTelefono: null,
    remitenteNombre: "Diamond", texto: RESUMEN, fechaMensaje: "2026-10-23T17:09:00Z",
  });
  assert.strictEqual(r.resultado, "eco_sofi");
  assert.strictEqual(create.mock.callCount(), 0);
  assert.strictEqual(buscar.mock.callCount(), 0);
  assert.strictEqual(registrar.mock.callCount(), 0);
});

test("dm.procesarMensaje: si no es eco, el camino de siempre sigue (se guarda y se atribuye)", async (t) => {
  eco._reset();
  const dm = require("../src/groups/dm");
  const lineaDm = require("../src/data/linea-dm");
  const groupSignals = require("../src/data/group-signals");
  const rp = require("../src/groups/respuestas-publicacion");
  const sofiLinea = require("../src/groups/sofi-linea");
  const puente = require("../src/groups/puente-sofi");
  t.mock.method(eco, "esEcoDeSofi", async () => false);
  const create = t.mock.method(lineaDm, "create", async () => ({ mensaje: { id: "dm-1" }, duplicado: true }));
  t.mock.method(groupSignals, "buscarPorLid", async () => null);
  t.mock.method(rp, "deLinea", async () => null);
  t.mock.method(sofiLinea, "activo", () => false);
  t.mock.method(puente, "tenderPuente", async () => ({ resultado: "sin_senal" }));

  const r = await dm.procesarMensaje(ORG, {
    waMessageId: "w-2", sesion: "DaianaDiamond", remitenteLid: "1@lid", remitenteTelefono: null,
    remitenteNombre: "Laura", texto: "¿la 10505566 tiene parqueadero?", fechaMensaje: "2026-10-23T17:09:00Z",
  });
  assert.strictEqual(r.resultado, "duplicado");
  assert.strictEqual(create.mock.callCount(), 1);
});
