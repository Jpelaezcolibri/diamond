// La marca "solo llamada" (Juan, 2026-09-10). Caso Angela Moscoso: pidio que
// la contacten solo por llamada y el radar le mando un DM dos horas despues.
// Lo que se fija aca: que la marca se reconozca por CUALQUIERA de las tres
// llaves (lid, telefono con el cruce de directorio_lids, celular escrito en el
// pedido) — Juan: "que no se nos filtren los mensajes porque queda marcado el
// colega pero de pronto el lid sigue disponible".
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const memory = require("../src/data/memory");
delete require.cache[require.resolve("../src/data/supabase")];
delete require.cache[require.resolve("../src/data/colegas")];
const supabasePath = require.resolve("../src/data/supabase");
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: null };
const colegas = require("../src/data/colegas");

const ORG = "org-1";
const ANGELA = { id: "c-angela", org_id: ORG, lid: "266150634110990", telefono: "573146399667", nombre: "tengotuinmueblecomercial1", grupos: [], solo_llamada: true };

beforeEach(() => {
  memory.colegasGrupos.length = 0;
  memory.directorioLids = [];
});

test("marcada por lid: el radar la reconoce por el identificador oculto", async () => {
  memory.colegasGrupos.push({ ...ANGELA });
  assert.strictEqual(await colegas.esSoloLlamada(ORG, { lid: "266150634110990" }), true);
  assert.strictEqual(await colegas.esSoloLlamada(ORG, { lid: "266150634110990@lid" }), true, "con sufijo tambien");
});

test("marcada por telefono: con o sin indicativo", async () => {
  memory.colegasGrupos.push({ ...ANGELA });
  assert.strictEqual(await colegas.esSoloLlamada(ORG, { telefono: "573146399667" }), true);
  assert.strictEqual(await colegas.esSoloLlamada(ORG, { telefono: "3146399667" }), true);
});

test("el cruce de directorio_lids: la fila marcada solo tiene lid y el DM iria por telefono", async () => {
  memory.colegasGrupos.push({ ...ANGELA, telefono: null });
  memory.directorioLids.push({ org_id: ORG, lid: "266150634110990", telefono: "573146399667" });
  assert.strictEqual(await colegas.esSoloLlamada(ORG, { telefono: "573146399667" }), true);
});

test("el cruce al reves: la fila marcada solo tiene telefono y el DM iria por lid", async () => {
  memory.colegasGrupos.push({ ...ANGELA, lid: "otro-lid-99999999" });
  memory.directorioLids.push({ org_id: ORG, lid: "266150634110990", telefono: "573146399667" });
  assert.strictEqual(await colegas.esSoloLlamada(ORG, { lid: "266150634110990" }), true);
});

test("el celular escrito en el pedido: si publica desde otra cuenta, igual se reconoce", async () => {
  memory.colegasGrupos.push({ ...ANGELA });
  const texto = "🟢 PEDIDO 👉 650 BUSCO APARTAMENTO 🙋 Angela Moscoso 📲 314 639 9667";
  assert.strictEqual(await colegas.esSoloLlamada(ORG, { lid: "999999999999999", textoPedido: texto }), true);
});

test("sin marca, o de otra organizacion, o sin ninguna llave: false", async () => {
  memory.colegasGrupos.push({ ...ANGELA, solo_llamada: false });
  memory.colegasGrupos.push({ ...ANGELA, id: "otra-org", org_id: "org-2", lid: "111111111111111", telefono: "573001112233" });
  assert.strictEqual(await colegas.esSoloLlamada(ORG, { lid: "266150634110990" }), false);
  assert.strictEqual(await colegas.esSoloLlamada(ORG, { telefono: "573001112233" }), false, "la marca de otra org no cruza");
  assert.strictEqual(await colegas.esSoloLlamada(ORG, {}), false);
});

test("sin org no se puede verificar: null (falla cerrado)", async () => {
  assert.strictEqual(await colegas.esSoloLlamada(null, { lid: "266150634110990" }), null);
});

test("marcarSoloLlamada: la encuentra por telefono y la marca", async () => {
  memory.colegasGrupos.push({ ...ANGELA, solo_llamada: false });
  const r = await colegas.marcarSoloLlamada(ORG, { telefono: "573146399667" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.colega.lid, "266150634110990");
  assert.strictEqual(memory.colegasGrupos[0].solo_llamada, true);
  assert.ok(memory.colegasGrupos[0].solo_llamada_at);
});

test("marcarSoloLlamada: si la fila no tiene telefono, la encuentra por directorio_lids", async () => {
  memory.colegasGrupos.push({ ...ANGELA, telefono: null, solo_llamada: false });
  memory.directorioLids.push({ org_id: ORG, lid: "266150634110990", telefono: "573146399667" });
  const r = await colegas.marcarSoloLlamada(ORG, { telefono: "3146399667" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(memory.colegasGrupos[0].solo_llamada, true);
});

test("marcarSoloLlamada: sin fila no inventa nada", async () => {
  const r = await colegas.marcarSoloLlamada(ORG, { telefono: "573146399667" });
  assert.deepStrictEqual(r, { ok: false, motivo: "no_encontrado" });
  assert.deepStrictEqual(await colegas.marcarSoloLlamada(ORG, { telefono: "123" }), { ok: false, motivo: "sin_telefono" });
});
