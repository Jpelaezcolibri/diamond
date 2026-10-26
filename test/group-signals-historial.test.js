// N2 (segunda revision del DM amplio, 2026-10-26): los pedidos recientes de un
// colega, por lid o por telefono, para saber si alguna vez fue tajante.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const groupSignals = require("../src/data/group-signals");

const DESDE = "2026-07-28T00:00:00.000Z";
beforeEach(() => {
  memory.groupSignals.length = 0;
  memory.groupSignals.push(
    { org_id: "o1", created_at: "2026-10-21T21:34:24Z", autor_telefono: "272245326893071", texto_original: "No enviar inmuebles que no cumplan con todo" },
    { org_id: "o1", created_at: "2026-10-24T13:39:44Z", autor_telefono: "272245326893071", texto_original: "Busco apto Laureles" },
    { org_id: "o1", created_at: "2026-09-13T15:10:03Z", autor_telefono: "999999999999999", respuesta_destino_telefono: "573113345468", texto_original: "Solo laureles primer parque" },
    { org_id: "o1", created_at: "2026-06-01T00:00:00Z", autor_telefono: "272245326893071", texto_original: "viejo, fuera de los 90 dias" },
    { org_id: "o2", created_at: "2026-10-24T00:00:00Z", autor_telefono: "272245326893071", texto_original: "otra org" },
    { org_id: "o1", created_at: "2026-10-24T00:00:00Z", autor_telefono: "111111111111111", texto_original: "otro colega" },
  );
});

test("textosRecientesColega junta los pedidos del colega por lid y por telefono, del mas nuevo al mas viejo", async () => {
  const t = await groupSignals.textosRecientesColega("o1", { lid: "272245326893071@lid", telefono: "573113345468" }, DESDE);
  assert.deepStrictEqual(t, ["Busco apto Laureles", "No enviar inmuebles que no cumplan con todo", "Solo laureles primer parque"]);
});

test("textosRecientesColega sin con que identificar al colega devuelve null (quien llama falla cerrado)", async () => {
  assert.strictEqual(await groupSignals.textosRecientesColega("o1", {}, DESDE), null);
  assert.strictEqual(await groupSignals.textosRecientesColega("o1", { lid: "123" }, DESDE), null);
});
