// Sprint "asistente valioso": resumen_lead y cruzar_propiedad_leads.
// Mismo criterio que command-tools.test.js: el scope viene del ctx del
// servidor y el modelo no puede ampliarlo desde el input.
const { test } = require("node:test");
const assert = require("node:assert");
const { executeCommandTool } = require("../src/agent/sofi-comando-tools");
const command = require("../src/data/command");
const properties = require("../src/data/properties");

function asesorScope() {
  return Object.freeze({ orgId: "org-1", viewerUid: "asesor-1", role: "asesor_ventas", isAdmin: false });
}

// ── parsePresupuesto: texto libre de clientes → pesos ─────────────────────
test("parsePresupuesto entiende millones, pesos completos y arriendos", () => {
  assert.strictEqual(command.parsePresupuesto("1.300 millones"), 1300000000);
  assert.strictEqual(command.parsePresupuesto("80 millones"), 80000000);
  assert.strictEqual(command.parsePresupuesto("500.000.000"), 500000000);
  assert.strictEqual(command.parsePresupuesto("1300"), 1300000000);
  assert.strictEqual(command.parsePresupuesto("2.500.000 para arriendo"), 2500000);
  assert.strictEqual(command.parsePresupuesto(null), null);
  assert.strictEqual(command.parsePresupuesto("no sabe"), null);
});

// ── matchLeadsConPropiedad: el cruce puro ──────────────────────────────────
const PROPIEDAD = {
  ref: "9776475",
  titulo: "Apartaloft cerca a Laureles",
  tipo: "Apartaestudio",
  operacion: "Venta",
  precio: "$346.000.000",
  zona: "Laureles",
  ciudad: "Medellin",
};

test("matchLeadsConPropiedad: encaja por zona y presupuesto, y explica el porque", () => {
  const leads = [
    { id: "l1", nombre: "Marta", phone: "573001", estado: "calificado", score: 80, categoria: "compra", presupuesto: "400 millones", zona_interes: "Laureles", tipo_interes: "apartaestudio" },
  ];
  const out = command.matchLeadsConPropiedad(leads, PROPIEDAD);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0].coincide_en.sort(), ["presupuesto", "tipo", "zona"]);
});

test("matchLeadsConPropiedad: presupuesto declarado que no alcanza excluye al lead", () => {
  const leads = [
    { id: "l2", nombre: "Pedro", estado: "calificado", score: 90, categoria: "compra", presupuesto: "200 millones", zona_interes: "Laureles" },
  ];
  assert.strictEqual(command.matchLeadsConPropiedad(leads, PROPIEDAD).length, 0);
});

test("matchLeadsConPropiedad: margen del 90% — presupuesto apenas por debajo del precio si entra", () => {
  const leads = [
    { id: "l3", nombre: "Rosa", estado: "nuevo", score: 40, categoria: "compra", presupuesto: "320 millones", zona_interes: "Belen" },
  ];
  const out = command.matchLeadsConPropiedad(leads, PROPIEDAD);
  assert.strictEqual(out.length, 1);
  assert.ok(out[0].coincide_en.includes("presupuesto"));
});

test("matchLeadsConPropiedad: lead de arriendo no encaja con propiedad en venta", () => {
  const leads = [
    { id: "l4", nombre: "Luis", estado: "calificado", score: 70, categoria: "alquiler", presupuesto: "400 millones", zona_interes: "Laureles" },
  ];
  assert.strictEqual(command.matchLeadsConPropiedad(leads, PROPIEDAD).length, 0);
});

test("matchLeadsConPropiedad: coincidir SOLO en tipo no basta para entrar a la lista", () => {
  const leads = [
    { id: "l5", nombre: "Ana", estado: "nuevo", score: 10, categoria: "compra", presupuesto: null, zona_interes: "Envigado", tipo_interes: "apartaestudio" },
  ];
  assert.strictEqual(command.matchLeadsConPropiedad(leads, PROPIEDAD).length, 0);
});

test("matchLeadsConPropiedad: ordena por cantidad de coincidencias y luego score", () => {
  const leads = [
    { id: "a", nombre: "SoloZona", estado: "nuevo", score: 99, categoria: "compra", presupuesto: null, zona_interes: "Laureles" },
    { id: "b", nombre: "ZonaYPlata", estado: "calificado", score: 50, categoria: "compra", presupuesto: "400 millones", zona_interes: "Laureles" },
  ];
  const out = command.matchLeadsConPropiedad(leads, PROPIEDAD);
  assert.strictEqual(out[0].lead_id, "b");
  assert.strictEqual(out[1].lead_id, "a");
});

// ── resumen_lead (tool) ────────────────────────────────────────────────────
test("resumen_lead: con un solo match devuelve ficha + conversacion del alcance", async (t) => {
  let buscarScope = null;
  t.mock.method(command, "buscarLeads", async (scope, q) => {
    buscarScope = { scope, q };
    return [{ id: "lead-9", nombre: "Javier" }];
  });
  t.mock.method(command, "conversacionDeLead", async (scope, leadId) => ({
    lead: { id: leadId, nombre: "Javier", phone: "573007", estado: "calificado", score: 75, presupuesto: "1.300 millones", zona_interes: "Laureles" },
    mensajes: [{ role: "user", content: "busco apartamento con vista y parqueadero" }],
  }));

  const out = await executeCommandTool("resumen_lead", { cliente: "Javier", is_admin: true }, { scope: asesorScope(), session: null });

  assert.strictEqual(buscarScope.scope.viewerUid, "asesor-1");
  assert.strictEqual(buscarScope.scope.isAdmin, false);
  assert.match(out, /Javier/);
  assert.match(out, /vista y parqueadero/);
  assert.match(out, /1\.300 millones/);
});

test("resumen_lead: con varios matches pide desambiguar en vez de adivinar", async (t) => {
  t.mock.method(command, "buscarLeads", async () => [
    { id: "a", nombre: "Javier Gomez", phone: "5731", estado: "nuevo" },
    { id: "b", nombre: "Javier Ruiz", phone: "5732", estado: "calificado" },
  ]);
  const out = await executeCommandTool("resumen_lead", { cliente: "Javier" }, { scope: asesorScope(), session: null });
  assert.match(out, /2 leads/);
  assert.match(out, /pregunta al asesor cual/);
});

test("resumen_lead: sin matches lo dice con honestidad", async (t) => {
  t.mock.method(command, "buscarLeads", async () => []);
  const out = await executeCommandTool("resumen_lead", { cliente: "Nadie" }, { scope: asesorScope(), session: null });
  assert.match(out, /No encontre/);
});

// ── cruzar_propiedad_leads (tool) ──────────────────────────────────────────
test("cruzar_propiedad_leads: trae la propiedad por ref del scope y lista candidatos", async (t) => {
  let refRecibida = null;
  t.mock.method(properties, "findByRef", async (orgId, ref) => {
    refRecibida = { orgId, ref };
    return PROPIEDAD;
  });
  t.mock.method(command, "leadsParaPropiedad", async () => [
    { lead_id: "l1", nombre: "Marta", phone: "573001", coincide_en: ["zona", "presupuesto"], score: 80, estado: "calificado" },
  ]);

  const out = await executeCommandTool("cruzar_propiedad_leads", { ref: "9776475" }, { scope: asesorScope(), session: null });

  assert.strictEqual(refRecibida.orgId, "org-1");
  assert.match(out, /Marta/);
  assert.match(out, /coincide_en/);
});

test("cruzar_propiedad_leads: ref inexistente lo dice sin inventar", async (t) => {
  t.mock.method(properties, "findByRef", async () => null);
  const out = await executeCommandTool("cruzar_propiedad_leads", { ref: "000000" }, { scope: asesorScope(), session: null });
  assert.match(out, /No encontre la referencia/);
});

test("cruzar_propiedad_leads: sin candidatos responde honesto con la propiedad", async (t) => {
  t.mock.method(properties, "findByRef", async () => PROPIEDAD);
  t.mock.method(command, "leadsParaPropiedad", async () => []);
  const out = await executeCommandTool("cruzar_propiedad_leads", { ref: "9776475" }, { scope: asesorScope(), session: null });
  assert.match(out, /Ningun lead activo/);
});
