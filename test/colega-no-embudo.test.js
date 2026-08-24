// C2 (revision 2026-08-24): reconocer a un colega no alcanza si todo lo que
// viene despues sigue tratandolo como cliente.
//
// Hasta esta revision, engine.js solo blindaba `if (!advisor)` — el colega
// (que tambien es `!advisor`) se colaba entero por ese bloque: quedaba con
// intencion "vender" si decia "tengo un cliente que quiere vender", el
// captador de una propiedad recibia un aviso real de "un cliente se
// intereso" cuando en realidad era un colega buscando para el suyo, y su
// categoria de tablero (compra/alquiler) se fijaba igual que la de un lead
// real — todo eso es "entrar al embudo como oportunidad de venta", que es
// justo lo que promptColega dice que Sofi NO hace con un colega.
//
// Verificado sobre el fuente (como colega-deteccion.test.js) para las partes
// de engine.js que no vale la pena montar con mocks, y con mocks reales (como
// captador-alert.test.js) para el comportamiento observable de las tools que
// ahora usan ctx.colega.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const fuente = fs.readFileSync(path.join(__dirname, "..", "src", "agent", "engine.js"), "utf8");

test("el ctx que arma engine.js lleva colega, para que las tools lo distingan", () => {
  const i = fuente.indexOf("const ctx = {");
  assert.ok(i > -1);
  const bloque = fuente.slice(i, i + 700);
  assert.match(bloque, /colega,/, "ctx.colega tiene que existir para que maybeCaptadorAlert y buscar_propiedades lo lean");
});

test("detectSellerIntent no corre para un colega (solo para el cliente final)", () => {
  const i = fuente.indexOf("detectSellerIntent(m.content)");
  assert.ok(i > -1, "la deteccion de intencion de venta tiene que seguir existiendo");
  const antes = fuente.slice(Math.max(0, i - 400), i);
  assert.match(antes, /!advisor\s*&&\s*!colega/, "el gate tiene que excluir asesor Y colega, no solo asesor");
});

test("el bloque de property_ref_origen (ad, kanban, categoria) no corre para un colega", () => {
  const i = fuente.indexOf("&& lead.property_ref_origen) {");
  assert.ok(i > -1, "tiene que existir el gate compuesto sobre property_ref_origen");
  const antes = fuente.slice(Math.max(0, i - 60), i);
  assert.match(antes, /!advisor\s*&&\s*!colega/, "el gate tiene que excluir asesor Y colega");
});

test("dentro del bloque de cliente, el idioma SI corre para un colega (no esta detras del !colega)", () => {
  // El idioma es la unica pieza de ese bloque que el propio caso real pide
  // conservar para un colega (Juan: "que sofi lo atienda con tono para
  // colega" no dice nada de ignorar en que idioma escribe).
  const iIdioma = fuente.indexOf("detectClientLanguage(text)");
  const iColegaGate = fuente.indexOf("if (!colega) {");
  assert.ok(iIdioma > -1 && iColegaGate > -1);
  assert.ok(iIdioma < iColegaGate, "la deteccion de idioma tiene que quedar ANTES del gate !colega, no adentro");
});

// ── Comportamiento observable de las tools con ctx.colega ──────────────────

const { executeTool, maybeCaptadorAlert } = require("../src/agent/tools");
const properties = require("../src/data/properties");
const advisors = require("../src/data/advisors");
const leads = require("../src/data/leads");
const propertyContext = require("../src/data/property-context");
const propertyOwnerAlerts = require("../src/data/property-owner-alerts");

const PROP = Object.freeze({
  id: "prop-1", org_id: "org-1", ref: "10207832", titulo: "Apto en Laureles",
  zona: "Laureles", disponible: true, captador_id: "adv-9", operacion: "Venta",
});

function ctxColega(extra = {}) {
  return {
    org: { id: "org-1", name: "Diamond" },
    lead: { id: "lead-1", phone: "573001112233", categoria: "otros", estado: "nuevo", score: 0 },
    colega: { nombre: "Esteban Higuita" },
    propertyInteres: null, transfer: null, cita: null, allyMatch: null, allyAlert: null,
    captadorAlert: null, lastUserMessage: "tengo un cliente para esa",
    ...extra,
  };
}

test("maybeCaptadorAlert NO avisa al captador cuando quien mira la propiedad es un colega", async (t) => {
  const register = t.mock.method(propertyOwnerAlerts, "registerAlert", async () => true);
  const ctx = ctxColega();
  await maybeCaptadorAlert(ctx, PROP);
  assert.strictEqual(ctx.captadorAlert, null, "no debe armar un aviso de 'cliente interesado' sobre un colega");
  assert.strictEqual(register.mock.calls.length, 0, "ni siquiera deberia llegar a registrar el alert");
});

test("maybeCaptadorAlert SIGUE avisando cuando no hay colega en el ctx (no se rompe el caso normal)", async (t) => {
  t.mock.method(propertyOwnerAlerts, "registerAlert", async () => true);
  t.mock.method(advisors, "findById", async () => ({ id: "adv-9", name: "Natalia", phone: "573009998877", activo: true }));
  const ctx = ctxColega({ colega: null });
  await maybeCaptadorAlert(ctx, PROP);
  assert.ok(ctx.captadorAlert, "sin colega, el aviso al captador tiene que seguir funcionando igual que siempre");
});

test("buscar_propiedades no mete a un colega en el tablero compra/alquiler", async (t) => {
  t.mock.method(properties, "search", async () => [PROP]);
  t.mock.method(propertyContext, "getSalesContext", async () => null);
  const updateLead = t.mock.method(leads, "update", async (id, patch) => patch);
  const ctx = ctxColega();
  await executeTool("buscar_propiedades", { zona: "Laureles" }, ctx);
  assert.strictEqual(ctx.lead.categoria, "otros", "la categoria de un colega no la define lo que busca");
  const patchesDeCategoria = updateLead.mock.calls.filter((c) => "categoria" in (c.arguments[1] || {}));
  assert.strictEqual(patchesDeCategoria.length, 0, "no debe persistir ninguna categoria para el lead del colega");
});

test("buscar_propiedades SIGUE fijando la categoria para un cliente final (no se rompe el caso normal)", async (t) => {
  t.mock.method(properties, "search", async () => [PROP]);
  t.mock.method(propertyContext, "getSalesContext", async () => null);
  t.mock.method(leads, "update", async (id, patch) => patch);
  // Sin doble de propertyOwnerAlerts/advisors, maybeCaptadorAlert (que
  // buscar_propiedades tambien dispara) saldria a la Supabase real -- ver la
  // advertencia del enunciado sobre I/O real en tests sin mock.
  t.mock.method(propertyOwnerAlerts, "registerAlert", async () => true);
  t.mock.method(advisors, "findById", async () => ({ id: "adv-9", name: "Natalia", phone: "573009998877", activo: true }));
  const ctx = ctxColega({ colega: null, lead: { id: "lead-2", categoria: "otros", estado: "en_conversacion", score: 0 } });
  await executeTool("buscar_propiedades", { zona: "Laureles" }, ctx);
  assert.strictEqual(ctx.lead.categoria, "compra");
});
