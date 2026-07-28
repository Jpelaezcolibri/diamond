// El buffer es lo que hace que el sistema cueste centavos y no decenas de
// dólares: acumula y clasifica de a 20 en vez de uno por uno. Y es donde muere
// el ruido, que es la invariante de privacidad #4.
const { test, mock, beforeEach } = require("node:test");
const assert = require("node:assert");
const buffer = require("../src/groups/buffer");
const classify = require("../src/groups/classify");
const match = require("../src/groups/match");
const groupSignals = require("../src/data/group-signals");

const ORG = { id: "org-test" };

let guardadas = [];
let lotesClasificados = [];

const mensaje = (n, clase = "demanda") => ({
  id: `m${n}`, waMessageId: `wa_${n}`, groupId: "g1", grupo: "Grupo",
  autor: "Colega", autorTelefono: "573001112233", texto: `mensaje ${n}`, _clase: clase,
});

beforeEach(() => {
  mock.restoreAll();
  buffer._reset();
  guardadas = [];
  lotesClasificados = [];

  mock.method(classify, "classify", async (lote) => {
    lotesClasificados.push(lote.length);
    return {
      clasificados: lote.map((m) => ({
        clase: m._clase, confianza: 0.9, operacion: "venta", tipo: "apartamento",
        zona: "Laureles", ciudad: "", precio_min: 0, precio_max: 400000000,
        habitaciones: 3, contacto: "", notas: "", mensaje: m,
      })),
      uso: { input_tokens: 100, output_tokens: 50, costoUsd: 0.00035 },
      lotesFallidos: 0,
      lotes: 1,
    };
  });

  mock.method(match, "cruzar", async (clasificados) => ({
    demandas: clasificados.filter((c) => c.clase === "demanda").map((c) => ({ ...c, matches: [{ fuente: "diamond", ref: "9921388" }] })),
    ofertas: clasificados.filter((c) => c.clase === "oferta").map((c) => ({ ...c, utilizable: true, matches: [] })),
    ruido: [],
  }));

  mock.method(groupSignals, "create", async (orgId, fields) => {
    const dup = guardadas.some((g) => g.wa_message_id === fields.wa_message_id);
    if (!dup) guardadas.push(fields);
    return { signal: fields, duplicado: dup };
  });
});

test("no clasifica hasta juntar 20 — es lo que hace que el costo sea trivial", async () => {
  for (let i = 0; i < 19; i++) buffer.push(ORG, mensaje(i));
  assert.strictEqual(buffer.estado().pendientes, 19);
  assert.deepStrictEqual(lotesClasificados, [], "no debería haber llamado a la IA todavía");
});

test("al llegar a 20 dispara el lote solo", async () => {
  for (let i = 0; i < 20; i++) buffer.push(ORG, mensaje(i));
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(lotesClasificados, [20]);
  assert.strictEqual(buffer.estado().pendientes, 0);
  assert.strictEqual(guardadas.length, 20);
});

test("flush({forzar}) vacía aunque no se llegue a 20 — es el tick del worker", async () => {
  buffer.push(ORG, mensaje(1));
  buffer.push(ORG, mensaje(2));
  await buffer.flush({ forzar: true });
  assert.deepStrictEqual(lotesClasificados, [2]);
  assert.strictEqual(guardadas.length, 2);
});

test("INVARIANTE 4: el ruido no se persiste, sólo se cuenta", async () => {
  buffer.push(ORG, mensaje(1, "ruido"));
  buffer.push(ORG, mensaje(2, "demanda"));
  await buffer.flush({ forzar: true });
  assert.strictEqual(guardadas.length, 1, "sólo la demanda debería guardarse");
  assert.strictEqual(guardadas[0].clase, "demanda");
  assert.strictEqual(buffer.estado().ruido, 1);
});

test("si todo el lote es ruido no se toca la base", async () => {
  const create = mock.method(groupSignals, "create", async () => ({ duplicado: false }));
  buffer.push(ORG, mensaje(1, "ruido"));
  await buffer.flush({ forzar: true });
  assert.strictEqual(create.mock.callCount(), 0);
});

test("la señal guardada lleva el id de WhatsApp, que es la clave de dedup", async () => {
  buffer.push(ORG, mensaje(7, "demanda"));
  await buffer.flush({ forzar: true });
  assert.strictEqual(guardadas[0].wa_message_id, "wa_7");
  assert.strictEqual(guardadas[0].group_id, "g1");
  assert.strictEqual(guardadas[0].autor_telefono, "573001112233");
  assert.deepStrictEqual(guardadas[0].matches, [{ fuente: "diamond", ref: "9921388" }]);
});

test("un duplicado se cuenta pero no se guarda dos veces", async () => {
  buffer.push(ORG, mensaje(1, "demanda"));
  await buffer.flush({ forzar: true });
  buffer.push(ORG, mensaje(1, "demanda")); // mismo wa_message_id
  await buffer.flush({ forzar: true });
  assert.strictEqual(guardadas.length, 1);
  assert.strictEqual(buffer.estado().duplicados, 1);
});

test("el costo se acumula en las métricas, medido no estimado", async () => {
  buffer.push(ORG, mensaje(1));
  await buffer.flush({ forzar: true });
  assert.ok(buffer.estado().costoUsd > 0);
});

test("lo que entra mientras corre la IA va al lote siguiente, no se pierde", async () => {
  // El lote se saca del buffer ANTES de llamar a la IA justamente para esto.
  let resolver;
  mock.method(classify, "classify", async (lote) => {
    lotesClasificados.push(lote.length);
    await new Promise((r) => { resolver = r; });
    return { clasificados: [], uso: { costoUsd: 0 }, lotesFallidos: 0, lotes: 1 };
  });

  for (let i = 0; i < 20; i++) buffer.push(ORG, mensaje(i));
  await new Promise((r) => setImmediate(r));
  buffer.push(ORG, mensaje(99));
  assert.strictEqual(buffer.estado().pendientes, 1, "el mensaje nuevo debe quedar esperando el lote siguiente");
  resolver();
});

test("si una señal no se puede guardar, el resto del lote igual se guarda", async () => {
  let n = 0;
  mock.method(groupSignals, "create", async (orgId, fields) => {
    if (++n === 1) throw new Error("Supabase caído");
    guardadas.push(fields);
    return { duplicado: false };
  });
  buffer.push(ORG, mensaje(1));
  buffer.push(ORG, mensaje(2));
  await buffer.flush({ forzar: true });
  assert.strictEqual(guardadas.length, 1);
});

test("flush sin nada pendiente no llama a la IA", async () => {
  await buffer.flush({ forzar: true });
  assert.deepStrictEqual(lotesClasificados, []);
});
