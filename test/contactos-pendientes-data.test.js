const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const cp = require("../src/data/contactos-pendientes");

beforeEach(() => { memory.contactosPendientes.length = 0; });

test("abrir crea uno con código y no duplica el abierto del mismo lead", async () => {
  const a = await cp.abrir({ orgId: "o1", leadId: "l1", conversationId: "c1", asesorId: "a1", motivo: "no_contesto" });
  assert.strictEqual(a.nuevo, true);
  assert.match(a.pendiente.codigo, /^C-\d{4}$/);
  const b = await cp.abrir({ orgId: "o1", leadId: "l1", conversationId: "c1", asesorId: "a1", motivo: "pide_asesor" });
  assert.strictEqual(b.nuevo, false);
  assert.strictEqual(b.pendiente.id, a.pendiente.id);
  assert.strictEqual(b.pendiente.motivo, "pide_asesor");
});

test("enviar, cerrar una sola vez y volver a pendiente", async () => {
  const { pendiente } = await cp.abrir({ orgId: "o1", leadId: "l1", asesorId: "a1", motivo: "no_contesto" });
  await cp.marcarEnviados([pendiente.id], { loteId: "L1", asesorId: "a2" });
  const [e] = await cp.porCodigos("o1", [pendiente.codigo]);
  assert.deepStrictEqual([e.estado, e.lote_id, e.asesor_id], ["enviado", "L1", "a2"]);
  const v = await cp.volverAPendiente(pendiente.id, { intentos: 1, nota: "no contesta", por: "Daiana" });
  assert.deepStrictEqual([v.estado, v.intentos], ["pendiente", 1]);
  assert.ok(await cp.cerrar(pendiente.id, { estado: "resuelto", resultado: "visita", por: "Daiana" }));
  assert.strictEqual(await cp.cerrar(pendiente.id, { estado: "resuelto", resultado: "visita", por: "Daiana" }), null);
  assert.strictEqual((await cp.abiertos("o1")).length, 0);
});

test("resolverPorLead cierra el abierto cuando la persona vuelve a escribir", async () => {
  await cp.abrir({ orgId: "o1", leadId: "l1", asesorId: "a1", motivo: "no_contesto" });
  assert.strictEqual(await cp.resolverPorLead("l1", "volvio_a_escribir"), 1);
  assert.strictEqual((await cp.abiertos("o1")).length, 0);
});
