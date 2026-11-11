// Quien escribio cada salida de la linea del radar (Juan, 2026-10-21): Sofi
// contesta hasta 3 veces y calla para siempre si una persona del equipo
// escribio en ese chat. Antes de esto la linea nunca guardaba sus propios
// envios: toda salida sin autor es de una persona.

const { test } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const lineaDm = require("../src/data/linea-dm");

const ORG = "org-autor";
let n = 0;
const fila = (identidad, extra) =>
  lineaDm.create(ORG, { sesion: "DaianaDiamond", waMessageId: `w-${++n}`, remitenteLid: identidad.lid, texto: `m${n}`, ...extra });

test("cuenta las respuestas de Sofi y ve a la persona", async () => {
  memory.lineaDm = [];
  const id = { lid: "111@lid" };
  await fila(id, {});
  await fila(id, { direccion: "salida", autor: "sofi" });
  await fila(id, { direccion: "salida", autor: "sofi" });
  let e = await lineaDm.estadoConversacion(ORG, id, { desdeIso: "2000-01-01T00:00:00Z" });
  assert.strictEqual(e.respuestasSofi, 2);
  assert.strictEqual(e.humano, false);
  assert.strictEqual(e.faltaAutor, false);
  assert.deepStrictEqual(e.hilo.map((m) => m.direccion), ["entrada", "salida", "salida"]);

  await fila(id, { direccion: "salida", autor: "humano" });
  e = await lineaDm.estadoConversacion(ORG, id, { desdeIso: "2000-01-01T00:00:00Z" });
  assert.strictEqual(e.humano, true);
});

test("una salida vieja sin autor es de una persona", async () => {
  memory.lineaDm = [];
  const id = { lid: "222@lid" };
  await fila(id, { direccion: "salida" });
  const e = await lineaDm.estadoConversacion(ORG, id, { desdeIso: "2000-01-01T00:00:00Z" });
  assert.strictEqual(e.humano, true);
});

test("las respuestas de Sofi anteriores a la ventana no cuentan", async () => {
  memory.lineaDm = [];
  const id = { lid: "333@lid" };
  await fila(id, { direccion: "salida", autor: "sofi" });
  memory.lineaDm[0].created_at = "2026-01-01T00:00:00Z";
  const e = await lineaDm.estadoConversacion(ORG, id, { desdeIso: "2026-10-01T00:00:00Z" });
  assert.strictEqual(e.respuestasSofi, 0);
});

test("lo de otro colega no se mezcla", async () => {
  memory.lineaDm = [];
  await fila({ lid: "444@lid" }, { direccion: "salida", autor: "humano" });
  const e = await lineaDm.estadoConversacion(ORG, { lid: "555@lid" }, { desdeIso: "2000-01-01T00:00:00Z" });
  assert.strictEqual(e.humano, false);
  assert.strictEqual(e.hilo.length, 0);
});

// Caso Norha Vélez (2026-11-09): la línea del radar es un WhatsApp Business con
// saludo automático ("Gracias por comunicarte con Diamond Inversiones SAS…").
// Entra por message.any como salida `humano`, y Sofi callaba para siempre en
// 19 de 108 chats con pedido aunque ninguna persona había escrito.
test("el saludo automático de nuestra línea no cuenta como persona", async () => {
  memory.lineaDm = [];
  const id = { lid: "777@lid" };
  await fila(id, {});
  await fila(id, { direccion: "salida", autor: "humano", texto: "Gracias por comunicarte con Diamond Inversiones SAS 💛🩵❤️ Somos tu mejor aliado a la hora de vender , comprar , construir" });
  let e = await lineaDm.estadoConversacion(ORG, id, { desdeIso: "2000-01-01T00:00:00Z" });
  assert.strictEqual(e.humano, false);

  await fila(id, { direccion: "salida", autor: "humano", texto: "Hola Norha, soy Claudia. ¿Te llamo ahora?" });
  e = await lineaDm.estadoConversacion(ORG, id, { desdeIso: "2000-01-01T00:00:00Z" });
  assert.strictEqual(e.humano, true);
});

// Juan (2026-11-11): Sofi solo calla mientras una persona está atendiendo; se
// necesita saber cuándo escribió la persona por última vez.
test("ultimoHumanoAt: la hora de la última salida de una persona (no del saludo automático ni de Sofi)", async () => {
  memory.lineaDm = [];
  const id = { lid: "888@lid" };
  await fila(id, {});
  await fila(id, { direccion: "salida", autor: "humano", texto: "Hola, te habla Claudia" });
  const humana = memory.lineaDm[memory.lineaDm.length - 1].created_at;
  await fila(id, { direccion: "salida", autor: "sofi", texto: "Soy Sofi" });
  await fila(id, { direccion: "salida", autor: "humano", texto: "Gracias por comunicarte con Diamond Inversiones SAS" });
  const e = await lineaDm.estadoConversacion(ORG, id, { desdeIso: "2000-01-01T00:00:00Z" });
  assert.ok(humana, "la fila guarda su hora");
  assert.strictEqual(e.ultimoHumanoAt, humana);
});
