// EL PEDIDO SE GUARDA CON LO QUE PIDIO DE MUEBLES Y DE PLAZO (2026-09-12).
//
// classify.js extrae `amoblado` (si | no | "") y `periodo` (mes | corta | "")
// desde el 2026-09-07, y group_signals tiene las dos columnas
// (db/migrations/2026-09-07_amoblado.sql), pero persistirSenal nunca las
// copiaba: 92 de 92 pedidos de arriendo quedaron en null en produccion. El
// cruce en vivo no se enteraba (usa el clasificado en memoria, antes de
// guardar), pero el CRM y cualquier relectura desde la base si.

const { test } = require("node:test");
const assert = require("node:assert");

const groupSignals = require("../src/data/group-signals");
const { persistirSenal } = require("../src/groups/persistir");

const ORG = { id: "org-1" };

function clasificado(extra) {
  return {
    clase: "demanda",
    confianza: 0.9,
    operacion: "arriendo",
    tipo: "apartamento",
    zonas: ["Laureles"],
    precio_max: 4500000,
    matches: [],
    mensaje: { groupId: "g1", texto: "Busco apto amoblado en Laureles por 15 dias", autor: "Colega" },
    ...extra,
  };
}

function capturar(t) {
  const creados = [];
  t.mock.method(groupSignals, "create", async (orgId, fields) => {
    creados.push(fields);
    return { signal: { id: "s1", ...fields }, duplicado: false };
  });
  return creados;
}

test("persistirSenal guarda amoblado y periodo tal como los devolvio el clasificador", async (t) => {
  const creados = capturar(t);
  await persistirSenal(ORG, clasificado({ amoblado: "si", periodo: "corta" }), { origen: "vivo", waMessageId: "vivo:1" });

  assert.strictEqual(creados.length, 1);
  assert.strictEqual(creados[0].amoblado, "si");
  assert.strictEqual(creados[0].periodo, "corta");
});

test('un pedido que no menciona muebles guarda "" y no null: "no lo pidio" y "no se sabe" son distintos', async (t) => {
  const creados = capturar(t);
  await persistirSenal(ORG, clasificado({ amoblado: "", periodo: "" }), { origen: "vivo", waMessageId: "vivo:2" });

  assert.strictEqual(creados[0].amoblado, "");
  assert.strictEqual(creados[0].periodo, "");
});
