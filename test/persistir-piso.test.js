// EL PEDIDO SE GUARDA CON EL PISO QUE EXIGIO (2026-09-18).
//
// La leccion de amoblado, que costo que 92 de 92 pedidos de arriendo quedaran
// en null: el cruce en vivo usa el clasificado en MEMORIA, asi que la
// compuerta funciona igual sin guardar nada y el hueco no falla ruidosamente.
// Lo pierden el CRM, el aviso a la asesora y cualquier recalculo desde la
// base. Se guarda desde el primer dia.

const { test } = require("node:test");
const assert = require("node:assert");

const groupSignals = require("../src/data/group-signals");
const { persistirSenal } = require("../src/groups/persistir");

const ORG = { id: "org-1" };

function clasificado(extra) {
  return {
    clase: "demanda",
    confianza: 0.9,
    operacion: "venta",
    tipo: "apartamento",
    zonas: ["Laureles"],
    precio_max: 400000000,
    matches: [],
    mensaje: { groupId: "g1", texto: "Busco apto en Laureles solo hasta 3er piso", autor: "Colega" },
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

test("persistirSenal guarda el techo y el piso minimo del pedido", async (t) => {
  const creados = capturar(t);
  await persistirSenal(ORG, clasificado({ piso_max: 3, piso_min: 0 }), { origen: "vivo", waMessageId: "vivo:1" });

  assert.strictEqual(creados.length, 1);
  assert.strictEqual(creados[0].piso_max, 3);
  assert.strictEqual(creados[0].piso_min, 0);
});

test("un pedido que no menciona el piso guarda 0, no null", async (t) => {
  const creados = capturar(t);
  await persistirSenal(ORG, clasificado({ piso_max: 0, piso_min: 0 }), { origen: "vivo", waMessageId: "vivo:2" });

  assert.strictEqual(creados[0].piso_max, 0);
  assert.strictEqual(creados[0].piso_min, 0);
});
