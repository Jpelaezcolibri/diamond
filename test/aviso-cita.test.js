// Aviso de cita por confirmar por plantilla (2026-10-07): llega aunque la
// ventana de 24 h este cerrada; si la plantilla falla, cae al texto.
const { test } = require("node:test");
const assert = require("node:assert");
const { avisarCitaPorConfirmar } = require("../src/notifications/aviso-cita");

const ORG = { id: "org-1", name: "Diamond" };
const ADV = { id: "a2", name: "Claudia Valencia", phone: "573000008113" };
const LEAD = { id: "l1", nombre: "Laura", phone: "573125550000", source: "colega" };
const CITA = { fecha_hora: "2026-10-09T20:00:00Z", ref: "10012722", corte_at: "2026-10-09T16:00:00Z" };

test("sale por plantilla con los dos botones de esa cita", async () => {
  const llamadas = [];
  const r = await avisarCitaPorConfirmar({
    org: ORG, advisor: ADV, lead: LEAD, cita: CITA,
    deps: {
      plantilla: async (...a) => { llamadas.push(a); return { ok: true }; },
      respaldo: async () => { throw new Error("no debía usarse"); },
    },
  });
  assert.deepStrictEqual(r, { ok: true, via: "plantilla" });
  const [, to, opts] = llamadas[0];
  assert.strictEqual(to, "573000008113");
  assert.strictEqual(opts.name, "cita_por_confirmar");
  assert.strictEqual(opts.bodyParams[0], "10012722");
  assert.match(opts.bodyParams[2], /Laura \(colega\)/);
  assert.deepStrictEqual(opts.buttonPayloads, ["cita:l1:confirmar", "cita:l1:otro"]);
});

test("si la plantilla falla, cae al texto con respaldo", async () => {
  const r = await avisarCitaPorConfirmar({
    org: ORG, advisor: ADV, lead: LEAD, cita: CITA,
    deps: {
      plantilla: async () => ({ ok: false, error: "template not approved" }),
      respaldo: async (_org, _adv, texto) => { assert.match(texto, /OK CONFIRMADA/); return { ok: true }; },
    },
  });
  assert.deepStrictEqual(r, { ok: true, via: "texto" });
});
