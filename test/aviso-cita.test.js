// Aviso de cita por confirmar (plan 6, 2026-10-07): va al chat del CRM por
// avisar-asesor (motivo "visita"); el WhatsApp es solo el aviso corto.
const { test } = require("node:test");
const assert = require("node:assert");
const { avisarCitaPorConfirmar } = require("../src/notifications/aviso-cita");

const ORG = { id: "org-1", name: "Diamond" };
const ADV = { id: "a2", name: "Claudia Valencia", phone: "573000008113" };
const LEAD = { id: "l1", nombre: "Laura", phone: "573125550000", source: "colega" };
const CITA = { fecha_hora: "2026-10-09T20:00:00Z", ref: "10012722", corte_at: "2026-10-09T16:00:00Z" };

test("la visita se avisa con motivo visita y los datos van a la app, no al WhatsApp", async () => {
  const llamadas = [];
  const r = await avisarCitaPorConfirmar({
    org: ORG, advisor: ADV, lead: LEAD, cita: CITA,
    deps: { avisar: async (args) => { llamadas.push(args); return { ok: true }; } },
  });
  assert.deepStrictEqual(r, { ok: true, via: "app" });
  assert.strictEqual(llamadas[0].motivo, "visita");
  assert.strictEqual(llamadas[0].advisor, ADV);
  assert.strictEqual(llamadas[0].lead, LEAD);
  assert.match(llamadas[0].cuerpo, /Ref 10012722 .* Laura \(colega\) · confirmá antes de/);
});

test("si avisar falla, lo informa sin lanzar", async () => {
  const r = await avisarCitaPorConfirmar({ org: ORG, advisor: ADV, lead: LEAD, cita: CITA, deps: { avisar: async () => { throw new Error("x"); } } });
  assert.strictEqual(r.ok, false);
});
