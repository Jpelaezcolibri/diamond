// Aviso inmediato al asesor CAPTADOR de una propiedad del inventario propio
// cuando un cliente muestra interes — mismo criterio de mock que
// ally-tool.test.js: los data modules se mockean para no tocar la base real.
const { test } = require("node:test");
const assert = require("node:assert");
const { executeTool, maybeCaptadorAlert } = require("../src/agent/tools");
const properties = require("../src/data/properties");
const advisors = require("../src/data/advisors");
const leads = require("../src/data/leads");
const propertyContext = require("../src/data/property-context");
const propertyOwnerAlerts = require("../src/data/property-owner-alerts");

function baseCtx() {
  return {
    org: { id: "org-1", name: "Diamond" },
    lead: { id: "lead-1", phone: "573001112233", nombre: "Carlos", categoria: "otros", estado: "en_conversacion", score: 0 },
    propertyInteres: null,
    transfer: null,
    cita: null,
    allyMatch: null,
    allyAlert: null,
    captadorAlert: null,
    lastUserMessage: "me interesa la ref 10207832",
  };
}

const PROP = Object.freeze({
  id: "prop-1", org_id: "org-1", ref: "10207832", titulo: "Apto en Laureles",
  zona: "Laureles", disponible: true, captador_id: "adv-9", operacion: "Venta",
});

test("interes en propiedad con captador dispara el aviso una sola vez", async (t) => {
  t.mock.method(propertyOwnerAlerts, "registerAlert", async () => true);
  t.mock.method(advisors, "findById", async (orgId, id) => {
    assert.strictEqual(orgId, "org-1");
    assert.strictEqual(id, "adv-9");
    return { id: "adv-9", name: "Natalia", phone: "573009998877", activo: true };
  });
  const ctx = baseCtx();
  await maybeCaptadorAlert(ctx, PROP);
  assert.ok(ctx.captadorAlert);
  assert.strictEqual(ctx.captadorAlert.advisorPhone, "573009998877");
  assert.match(ctx.captadorAlert.advisorAlert, /10207832/);
  assert.match(ctx.captadorAlert.advisorAlert, /Carlos/);
});

test("si ya se aviso por este cliente y propiedad, no vuelve a avisar", async (t) => {
  t.mock.method(propertyOwnerAlerts, "registerAlert", async () => false);
  const findById = t.mock.method(advisors, "findById", async () => ({ id: "adv-9", phone: "573009998877", activo: true }));
  const ctx = baseCtx();
  await maybeCaptadorAlert(ctx, PROP);
  assert.strictEqual(ctx.captadorAlert, null);
  assert.strictEqual(findById.mock.calls.length, 0);
});

test("propiedad sin captador no genera aviso", async (t) => {
  const register = t.mock.method(propertyOwnerAlerts, "registerAlert", async () => true);
  const ctx = baseCtx();
  await maybeCaptadorAlert(ctx, { ...PROP, captador_id: null });
  assert.strictEqual(ctx.captadorAlert, null);
  assert.strictEqual(register.mock.calls.length, 0);
});

test("captador inactivo no recibe aviso", async (t) => {
  t.mock.method(propertyOwnerAlerts, "registerAlert", async () => true);
  t.mock.method(advisors, "findById", async () => ({ id: "adv-9", phone: "573009998877", activo: false }));
  const ctx = baseCtx();
  await maybeCaptadorAlert(ctx, PROP);
  assert.strictEqual(ctx.captadorAlert, null);
});

test("un error de base (migracion pendiente) no tumba el flujo", async (t) => {
  t.mock.method(propertyOwnerAlerts, "registerAlert", async () => {
    throw new Error("relation property_owner_alerts does not exist");
  });
  const ctx = baseCtx();
  await maybeCaptadorAlert(ctx, PROP); // no debe lanzar
  assert.strictEqual(ctx.captadorAlert, null);
});

test("buscar_propiedades con ref marcada arma el aviso en el ctx", async (t) => {
  t.mock.method(properties, "findByRef", async () => ({ ...PROP }));
  t.mock.method(leads, "update", async (id, patch) => patch);
  t.mock.method(propertyContext, "getSalesContext", async () => null);
  t.mock.method(propertyOwnerAlerts, "registerAlert", async () => true);
  t.mock.method(advisors, "findById", async () => ({ id: "adv-9", name: "Natalia", phone: "573009998877", activo: true }));
  const ctx = baseCtx();
  await executeTool("buscar_propiedades", { ref: "10207832" }, ctx);
  assert.ok(ctx.captadorAlert);
  assert.strictEqual(ctx.propertyInteres.ref, "10207832");
});
