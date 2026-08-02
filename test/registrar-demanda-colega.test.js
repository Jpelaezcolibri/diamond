// La demanda de un colega, reenviada por un asesor a Sofi.
//
// Es la mitad que faltaba del reenvío: `registrar_propiedad_aliado` cubría al
// colega que OFRECE; sin esto, un pedido reenviado ("tengo cliente para apto
// en Laureles") no dejaba rastro — Sofi listaba propiedades en el chat y la
// información moría ahí, fuera del CRM y fuera del digest.
//
// Los data modules crean un cliente Supabase REAL si hay .env, así que se
// mockean las funciones que tocan la base.

const { test } = require("node:test");
const assert = require("node:assert");

const { executeTool, TOOL_DEFINITIONS } = require("../src/agent/tools");
const groupSignals = require("../src/data/group-signals");
const whatsappGroups = require("../src/data/whatsapp-groups");
const allyProperties = require("../src/data/ally-properties");
const properties = require("../src/data/properties");

function ctxAsesor() {
  return {
    org: { id: "org-1", name: "Diamond" },
    lead: { id: "lead-1", phone: "573001878024", estado: "en_conversacion", score: 0, categoria: "otros" },
    lastUserMessage: "Tengo cliente para apto 3 alcobas en Laureles hasta 600 millones — Marcela Ruiz",
  };
}

function mockDatos(t, { propias = [], aliadas = [] } = {}) {
  const señales = [];
  t.mock.method(whatsappGroups, "asegurarGrupoVirtual", async (orgId, { prefijo, nombre }) => ({
    id: "grp-reenvio", jid: `${prefijo}:${whatsappGroups.slug(nombre)}`, nombre,
  }));
  t.mock.method(groupSignals, "create", async (orgId, fields) => {
    const dup = señales.some((s) => s.wa_message_id === fields.wa_message_id);
    if (dup) return { signal: null, duplicado: true };
    señales.push({ orgId, ...fields });
    return { signal: { id: `sig-${señales.length}`, ...fields }, duplicado: false };
  });
  t.mock.method(properties, "search", async () => propias);
  t.mock.method(allyProperties, "search", async () => aliadas);
  return señales;
}

const APTO_LAURELES = {
  ref: "9944723", titulo: "Apartamento en Laureles", zona: "Laureles", ciudad: "Medellín",
  tipo: "Apartamento", operacion: "Venta", precio: "$600.000.000", habitaciones: 4,
  link: "https://diamondinmobiliaria.com/propiedades/apto-9944723",
};

// ══ Contrato de la tool ══════════════════════════════════════════════════

test("la tool está declarada y exige el nombre del colega", () => {
  const def = TOOL_DEFINITIONS.find((t) => t.name === "registrar_demanda_colega");
  assert.ok(def, "registrar_demanda_colega debe estar en TOOL_DEFINITIONS");
  assert.deepStrictEqual(def.input_schema.required, ["contacto_nombre"]);
  // Que quede explícito que NO es para un cliente final: es el error caro.
  assert.match(def.description, /registrar_dato_lead/);
});

test("sin nombre del colega no registra nada y pide el dato", async (t) => {
  const señales = mockDatos(t);
  const out = await executeTool("registrar_demanda_colega", { zona: "Laureles" }, ctxAsesor());
  assert.match(out, /NO registre el pedido/);
  assert.strictEqual(señales.length, 0);
});

// ══ Cruce y respuesta ════════════════════════════════════════════════════

test("cruza contra el inventario propio y devuelve las refs que calzan", async (t) => {
  mockDatos(t, { propias: [APTO_LAURELES] });
  const out = await executeTool("registrar_demanda_colega", {
    contacto_nombre: "Marcela Ruiz",
    operacion: "Venta", tipo: "Apartamento", zona: "Laureles",
    presupuesto_max: 600000000, habitaciones: 3,
  }, ctxAsesor());

  assert.match(out, /Marcela Ruiz/);
  assert.match(out, /9944723/);
  assert.match(out, /propia/);
  assert.match(out, /diamondinmobiliaria\.com/, "el link va para que el asesor lo pase");
});

test("la señal queda con origen 'reenvio' y los matches guardados", async (t) => {
  const señales = mockDatos(t, { propias: [APTO_LAURELES] });
  await executeTool("registrar_demanda_colega", {
    contacto_nombre: "Marcela Ruiz", tipo: "Apartamento", zona: "Laureles", presupuesto_max: 600000000,
  }, ctxAsesor());

  assert.strictEqual(señales.length, 1);
  assert.strictEqual(señales[0].origen, "reenvio");
  assert.strictEqual(señales[0].clase, "demanda");
  assert.strictEqual(señales[0].autor_nombre, "Marcela Ruiz");
  assert.ok(señales[0].matches.length > 0, "los matches se guardan para que el CRM muestre lo mismo que respondió Sofi");
  assert.ok(señales[0].fecha_mensaje, "un reenvío es de ahora");
});

test("sin nada que calce lo dice derecho, sin inventar", async (t) => {
  mockDatos(t, { propias: [] });
  const out = await executeTool("registrar_demanda_colega", {
    contacto_nombre: "Pedro Mesa", tipo: "Local", zona: "El Poblado", presupuesto_max: 3000000,
  }, ctxAsesor());

  assert.match(out, /NO tenemos nada que calce/);
});

test("un pedido sin zona ni ciudad explica por qué no se pudo cruzar", async (t) => {
  // Sin zona el cruce devolvería media ciudad, que es peor que nada: quema la
  // credibilidad de la pantalla y le hace perder el tiempo al asesor.
  mockDatos(t, { propias: [APTO_LAURELES] });
  const out = await executeTool("registrar_demanda_colega", {
    contacto_nombre: "Juan Colega", tipo: "Apartamento", presupuesto_max: 600000000,
  }, ctxAsesor());

  assert.match(out, /no trae zona ni ciudad/);
});

test("dos asesores reenviando el mismo pedido no duplican la señal", async (t) => {
  const señales = mockDatos(t, { propias: [APTO_LAURELES] });
  const input = { contacto_nombre: "Marcela Ruiz", tipo: "Apartamento", zona: "Laureles", presupuesto_max: 600000000 };

  await executeTool("registrar_demanda_colega", input, ctxAsesor());
  // Otro asesor, mismo mensaje reenviado.
  const otro = { ...ctxAsesor(), lead: { ...ctxAsesor().lead, id: "lead-2", phone: "573009998877" } };
  await executeTool("registrar_demanda_colega", input, otro);

  assert.strictEqual(señales.length, 1);
});

test("un colega que busca NUNCA se califica como lead comprador", async (t) => {
  mockDatos(t, { propias: [APTO_LAURELES] });
  const ctx = ctxAsesor();
  const antes = { ...ctx.lead };

  await executeTool("registrar_demanda_colega", {
    contacto_nombre: "Marcela Ruiz", tipo: "Apartamento", zona: "Laureles", presupuesto_max: 600000000,
  }, ctx);

  assert.deepStrictEqual(ctx.lead, antes, "no se toca categoria, estado ni score");
  assert.strictEqual(ctx.transfer, undefined);
});

test("si la persistencia falla, el asesor igual se lleva los matches", async (t) => {
  // El valor inmediato es la respuesta; guardar es para el CRM y el digest.
  mockDatos(t, { propias: [APTO_LAURELES] });
  t.mock.method(groupSignals, "create", async () => { throw new Error("falta la migración"); });

  const out = await executeTool("registrar_demanda_colega", {
    contacto_nombre: "Marcela Ruiz", tipo: "Apartamento", zona: "Laureles", presupuesto_max: 600000000,
  }, ctxAsesor());

  assert.match(out, /9944723/);
});

test("el resultado le recuerda a Sofi que ella no escribe en el grupo", async (t) => {
  mockDatos(t, { propias: [APTO_LAURELES] });
  const out = await executeTool("registrar_demanda_colega", {
    contacto_nombre: "Marcela Ruiz", tipo: "Apartamento", zona: "Laureles", presupuesto_max: 600000000,
  }, ctxAsesor());

  assert.match(out, /no escribis en ningun grupo/i);
});
