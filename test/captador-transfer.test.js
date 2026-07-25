// La transferencia va al CAPTADOR de la propiedad de interes, salvo
// intencion vender/vehiculos. Mismo criterio de mock que ally-tool.test.js.
const { test } = require("node:test");
const assert = require("node:assert");
const { executeTool } = require("../src/agent/tools");
const advisors = require("../src/data/advisors");
const leads = require("../src/data/leads");

function baseCtx(extra = {}) {
  return {
    org: { id: "org-1", name: "Diamond" },
    lead: { id: "lead-1", phone: "573001112233", categoria: "compra", estado: "calificado", score: 80 },
    propertyInteres: { id: "prop-1", ref: "10207832", operacion: "Venta", captador_id: "adv-9", link: "https://x/p" },
    transfer: null, cita: null, allyMatch: null, allyAlert: null, captadorAlert: null,
    lastUserMessage: "quiero hablar con un asesor",
    ...extra,
  };
}

const NATALIA = { id: "adv-9", name: "Natalia", phone: "573009998877", especialidad: "venta", activo: true };
const GENERICO = { id: "adv-1", name: "Asesor Ventas", phone: "573000000001", especialidad: "venta", activo: true };

test("con propiedad marcada, transfiere al captador", async (t) => {
  t.mock.method(leads, "update", async (id, patch) => patch);
  t.mock.method(advisors, "findById", async () => NATALIA);
  const forTransfer = t.mock.method(advisors, "findForTransfer", async () => GENERICO);
  const ctx = baseCtx();
  await executeTool("transferir_a_asesor", { motivo: "calificado" }, ctx);
  assert.strictEqual(ctx.transfer.advisor.id, "adv-9");
  assert.strictEqual(forTransfer.mock.calls.length, 0);
});

test("intencion vender ignora al captador", async (t) => {
  t.mock.method(leads, "update", async (id, patch) => patch);
  const findById = t.mock.method(advisors, "findById", async () => NATALIA);
  t.mock.method(advisors, "findForTransfer", async () => GENERICO);
  const ctx = baseCtx({ lead: { id: "lead-1", phone: "573001112233", categoria: "otros", intencion: "vender", estado: "calificado", score: 80 } });
  await executeTool("transferir_a_asesor", { motivo: "quiere vender" }, ctx);
  assert.strictEqual(ctx.transfer.advisor.id, "adv-1");
  assert.strictEqual(findById.mock.calls.length, 0);
});

test("sin captador usa el flujo por especialidad", async (t) => {
  t.mock.method(leads, "update", async (id, patch) => patch);
  t.mock.method(advisors, "findForTransfer", async () => GENERICO);
  const ctx = baseCtx({ propertyInteres: { id: "prop-2", ref: "111", operacion: "Venta", captador_id: null } });
  await executeTool("transferir_a_asesor", { motivo: "calificado" }, ctx);
  assert.strictEqual(ctx.transfer.advisor.id, "adv-1");
});

test("captador inactivo cae al flujo por especialidad", async (t) => {
  t.mock.method(leads, "update", async (id, patch) => patch);
  t.mock.method(advisors, "findById", async () => ({ ...NATALIA, activo: false }));
  t.mock.method(advisors, "findForTransfer", async () => GENERICO);
  const ctx = baseCtx();
  await executeTool("transferir_a_asesor", { motivo: "calificado" }, ctx);
  assert.strictEqual(ctx.transfer.advisor.id, "adv-1");
});

test("error resolviendo el captador (migracion pendiente) cae a especialidad sin romper", async (t) => {
  t.mock.method(leads, "update", async (id, patch) => patch);
  t.mock.method(advisors, "findById", async () => {
    throw new Error("column captador_id does not exist");
  });
  t.mock.method(advisors, "findForTransfer", async () => GENERICO);
  const ctx = baseCtx();
  await executeTool("transferir_a_asesor", { motivo: "calificado" }, ctx);
  assert.strictEqual(ctx.transfer.advisor.id, "adv-1");
});

test("la transferencia respeta al asesor ya estampado en la cita (consistencia con round-robin)", async (t) => {
  t.mock.method(leads, "update", async (id, patch) => patch);
  const findById = t.mock.method(advisors, "findById", async (orgId, id) => {
    assert.strictEqual(id, "adv-cita");
    return { id: "adv-cita", name: "Natalia", phone: "573001878024", especialidad: "venta", activo: true };
  });
  const forTransfer = t.mock.method(advisors, "findForTransfer", async () => GENERICO);
  const ctx = baseCtx({
    propertyInteres: { id: "prop-2", ref: "111", operacion: "Venta", captador_id: null },
    cita: { tipo: "visita", fecha_hora: "2026-07-26T15:00:00-05:00", advisor_id: "adv-cita" },
  });
  await executeTool("transferir_a_asesor", { motivo: "calificado" }, ctx);
  assert.strictEqual(ctx.transfer.advisor.id, "adv-cita");
  assert.strictEqual(forTransfer.mock.calls.length, 0);
  assert.ok(findById.mock.calls.length >= 1);
});
