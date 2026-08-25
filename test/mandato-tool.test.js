// test/mandato-tool.test.js
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const mandatosData = require("../src/data/mandatos");
// OJO: el módulo exporta TOOL_DEFINITIONS, no `tools`. Verificado en
// src/agent/tools.js:1112 — el export es una lista explícita.
const { executeTool, TOOL_DEFINITIONS } = require("../src/agent/tools");

const CTX = { org: { id: "org-1" }, advisor: { id: "adv-nat", name: "Natalia Velez" } };

beforeEach(() => mandatosData._reset());

test("la tool esta declarada y exige el nombre del cliente", () => {
  const t = TOOL_DEFINITIONS.find((x) => x.name === "registrar_mandato_compra");
  assert.ok(t, "la tool tiene que existir");
  assert.ok(t.input_schema.required.includes("cliente_nombre"));
});

test("guarda el mandato y confirma CADA campo que entendio", async () => {
  const salida = await executeTool("registrar_mandato_compra", {
    cliente_nombre: "Marcela Restrepo",
    operacion: "Venta", tipo: "Apartamento",
    zonas: ["El Poblado", "Las Palmas"],
    precio_max: 2200000000, habitaciones: 4, area_min: 150,
    exigencias: ["balcón", "buena vista", "moderna", "zonas sociales"],
    texto_original: "Mi cliente subió presupuesto hasta 2.200 millones...",
  }, CTX);

  // La confirmacion es obligatoria: un mandato mal leido filtra mal para siempre
  // y no se queja. Es la unica defensa.
  assert.match(salida, /Marcela Restrepo/);
  assert.match(salida, /2\.200\.000\.000|2200000000/);
  assert.match(salida, /4/);
  assert.match(salida, /150/);
  assert.match(salida, /balcón/);
  assert.match(salida, /El Poblado/);
  assert.match(salida, /corrijo|corregir|está bien/i, "tiene que invitar a corregir");

  const guardados = await mandatosData.listarActivos("org-1");
  assert.strictEqual(guardados.length, 1);
  assert.strictEqual(guardados[0].advisor_id, "adv-nat", "el mandato queda a nombre del asesor que lo cargo");
  assert.deepStrictEqual(guardados[0].exigencias, ["balcón", "buena vista", "moderna", "zonas sociales"]);
  assert.ok(guardados[0].texto_original, "el brief original se conserva para poder auditarlo");
});

test("sin cliente_nombre no guarda nada y lo dice", async () => {
  const salida = await executeTool("registrar_mandato_compra", { precio_max: 500000000 }, CTX);
  assert.match(salida, /nombre/i);
  assert.strictEqual((await mandatosData.listarActivos("org-1")).length, 0);
});

test("un cliente final NO puede cargar mandatos", async () => {
  const salida = await executeTool("registrar_mandato_compra", { cliente_nombre: "X" }, { org: { id: "org-1" }, advisor: null });
  assert.match(salida, /asesor/i, "esto es una herramienta interna del equipo");
  assert.strictEqual((await mandatosData.listarActivos("org-1")).length, 0);
});

// IMPORTANT: operacion vacia desactivaba entera la compuerta mas cara de
// romper (mandato de venta que recibe arriendos). Igual que cliente_nombre,
// tiene que preguntarse antes de guardar, no fallar en silencio mas adelante.
test("sin operacion no guarda nada y lo dice", async () => {
  const salida = await executeTool("registrar_mandato_compra", { cliente_nombre: "X" }, CTX);
  assert.match(salida, /operacion|compra|arrienda/i);
  assert.strictEqual((await mandatosData.listarActivos("org-1")).length, 0);
});

test("si mandatos.crear falla, la tool devuelve un mensaje claro y no lanza", async () => {
  const original = mandatosData.crear;
  mandatosData.crear = async () => {
    throw new Error('relation "mandatos_compra" does not exist');
  };
  try {
    const salida = await executeTool("registrar_mandato_compra", {
      cliente_nombre: "X", operacion: "venta",
    }, CTX);
    assert.match(salida, /no pude guardar|migraci[oó]n|Juan/i);
  } finally {
    mandatosData.crear = original;
  }
});
