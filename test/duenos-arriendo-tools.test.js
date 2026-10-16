// Captacion de duenos para arriendo (spec 2026-10-16 §4). Mismo patron de
// mocks que captador-transfer.test.js.
const { test } = require("node:test");
const assert = require("node:assert");
const { executeTool, TOOL_DEFINITIONS: TOOLS } = require("../src/agent/tools");
const advisors = require("../src/data/advisors");
const leads = require("../src/data/leads");

function baseCtx(extra = {}) {
  return {
    org: { id: "org-1", name: "Diamond" },
    lead: { id: "lead-1", phone: "573001112233", categoria: "otros", estado: "en_conversacion", score: 10 },
    propertyInteres: null, transfer: null, cita: null, allyMatch: null, allyAlert: null, captadorAlert: null,
    lastUserMessage: "quiero arrendar mi apto",
    ...extra,
  };
}

const DAIANA = { id: "adv-2", name: "Daiana", phone: "573011880668", especialidad: "arriendo", activo: true, alias_publico: "Asesor 1" };

test("registrar_dato_lead: 'consignar_arriendo' no se vuelve 'arrendar'", async (t) => {
  t.mock.method(leads, "update", async (id, patch) => patch);
  const ctx = baseCtx();
  const r = await executeTool("registrar_dato_lead", { campo: "intencion", valor: "consignar_arriendo" }, ctx);
  assert.strictEqual(ctx.lead.intencion, "consignar_arriendo");
  assert.match(r, /PROPIETARIO que quiere ARRENDAR/);
});

test("registrar_dato_lead: 'arrendar' sigue siendo inquilino", async (t) => {
  t.mock.method(leads, "update", async (id, patch) => patch);
  const ctx = baseCtx();
  await executeTool("registrar_dato_lead", { campo: "intencion", valor: "arrendar" }, ctx);
  assert.strictEqual(ctx.lead.intencion, "arrendar");
});

test("registrar_inmueble_ofrecido hace merge y persiste", async (t) => {
  const update = t.mock.method(leads, "update", async (id, patch) => patch);
  const ctx = baseCtx({ lead: { id: "lead-1", phone: "573001112233", intencion: "consignar_arriendo", inmueble_ofrecido: { zona: "Provenza" } } });
  await executeTool("registrar_inmueble_ofrecido", { habitaciones: 2, periodo: "corta", rnt: "en tramite" }, ctx);
  assert.deepStrictEqual(ctx.lead.inmueble_ofrecido, { zona: "Provenza", habitaciones: 2, periodo: "corta", rnt: "en tramite" });
  assert.deepStrictEqual(update.mock.calls[0].arguments[1], { inmueble_ofrecido: ctx.lead.inmueble_ofrecido });
});

test("registrar_inmueble_ofrecido sin la columna no rompe y queda en memoria", async (t) => {
  t.mock.method(leads, "update", async () => { throw new Error('column "inmueble_ofrecido" does not exist'); });
  const ctx = baseCtx();
  const r = await executeTool("registrar_inmueble_ofrecido", { zona: "Envigado" }, ctx);
  assert.deepStrictEqual(ctx.lead.inmueble_ofrecido, { zona: "Envigado" });
  assert.match(r, /registrad/i);
});

test("registrar_inmueble_ofrecido ignora campos vacios y desconocidos", async (t) => {
  t.mock.method(leads, "update", async (id, patch) => patch);
  const ctx = baseCtx();
  await executeTool("registrar_inmueble_ofrecido", { zona: "  ", tipo: "apartamento", hackeo: "x" }, ctx);
  assert.deepStrictEqual(ctx.lead.inmueble_ofrecido, { tipo: "apartamento" });
});

test("transferir con consignar_arriendo va a arriendo, categoria alquiler, sin captador", async (t) => {
  t.mock.method(leads, "update", async (id, patch) => patch);
  const findById = t.mock.method(advisors, "findById", async () => ({ id: "adv-9", activo: true }));
  const forTransfer = t.mock.method(advisors, "findForTransfer", async () => DAIANA);
  const ctx = baseCtx({
    lead: { id: "lead-1", phone: "573001112233", categoria: "otros", intencion: "consignar_arriendo" },
    propertyInteres: { id: "p", ref: "1", operacion: "Venta", captador_id: "adv-9" },
  });
  await executeTool("transferir_a_asesor", { motivo: "dueno quiere arrendar", especialidad: "venta", intencion: "consignar_arriendo" }, ctx);
  assert.strictEqual(ctx.transfer.especialidad, "arriendo");
  assert.strictEqual(forTransfer.mock.calls[0].arguments[1], "arriendo");
  assert.strictEqual(findById.mock.calls.length, 0);
  assert.strictEqual(ctx.lead.categoria, "alquiler");
});

test("la tool nueva esta declarada y transferir acepta la intencion", () => {
  const tool = TOOLS.find((x) => x.name === "registrar_inmueble_ofrecido");
  assert.ok(tool, "falta la definicion de registrar_inmueble_ofrecido");
  const transferir = TOOLS.find((x) => x.name === "transferir_a_asesor");
  assert.ok(transferir.input_schema.properties.intencion.enum.includes("consignar_arriendo"));
  const dato = TOOLS.find((x) => x.name === "registrar_dato_lead");
  assert.match(dato.input_schema.properties.valor.description, /consignar_arriendo/);
});
