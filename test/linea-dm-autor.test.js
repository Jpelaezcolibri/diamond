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
