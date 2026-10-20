// test/publicar-asesor-tools.test.js
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const { executeTool } = require("../src/agent/tools");
const datos = require("../src/data/propiedades-asesor");
const { normalizar, tokenDe } = require("../src/lib/propiedad-asesor");

const ORG = { id: "org-1", name: "Diamond", landing_base_url: "https://diamondinmobiliaria.com" };
const ADVISOR = { id: "adv-1", name: "Daiana Zea", phone: "573011880668" };
const ctx = () => ({ org: ORG, advisor: ADVISOR, colega: null, lead: { id: "l" }, conversationId: "conv-1" });
const DATOS = {
  operacion: "arriendo", tipo: "apartamento", barrio: "Laureles", municipio: "Medellín", precio: "4.500.000",
  periodo: "mensual", amoblado: true, area: "60", alcobas: 2, banos: 2,
};
let previo;
beforeEach(() => { previo = process.env.SOFI_PUBLICA_ASESOR; process.env.SOFI_PUBLICA_ASESOR = "true"; });
afterEach(() => { if (previo === undefined) delete process.env.SOFI_PUBLICA_ASESOR; else process.env.SOFI_PUBLICA_ASESOR = previo; });

test("un cliente o colega no puede usarlas", async () => {
  for (const tool of ["preparar_publicacion", "confirmar_publicacion", "actualizar_vigencia"]) {
    const r = await executeTool(tool, DATOS, { org: ORG, advisor: null });
    assert.match(r, /solo para un asesor/i);
  }
});

test("apagado: no crea nada", async () => {
  process.env.SOFI_PUBLICA_ASESOR = "false";
  const r = await executeTool("preparar_publicacion", DATOS, ctx());
  assert.match(r, /no está activa/i);
});

test("faltan datos y fotos: lista exacta", async (t) => {
  t.mock.method(datos, "fotosRecientes", async () => []);
  const r = await executeTool("preparar_publicacion", { operacion: "venta", tipo: "casa" }, ctx());
  assert.match(r, /FALTAN DATOS/);
  assert.match(r, /barrio o sector/);
  assert.match(r, /al menos una foto/);
});

test("completo: vista previa con token y numero de fotos", async (t) => {
  t.mock.method(datos, "fotosRecientes", async () => ["a.jpg", "b.jpg"]);
  const r = await executeTool("preparar_publicacion", DATOS, ctx());
  const { fila } = normalizar(DATOS);
  assert.match(r, /VISTA PREVIA/);
  assert.match(r, /Fotos recibidas: 2/);
  assert.match(r, new RegExp(`token=${tokenDe(fila, ["a.jpg", "b.jpg"])}`));
  assert.match(r, /Apartamento amoblado en arriendo en Laureles/);
});

test("confirmar con token viejo no crea", async (t) => {
  t.mock.method(datos, "fotosRecientes", async () => ["a.jpg"]);
  const crear = t.mock.method(datos, "crear", async () => ({}));
  const r = await executeTool("confirmar_publicacion", { ...DATOS, token: "000000000000" }, ctx());
  assert.match(r, /cambiaron/i);
  assert.strictEqual(crear.mock.callCount(), 0);
});

test("confirmar con el token correcto crea y devuelve ref y link", async (t) => {
  t.mock.method(datos, "fotosRecientes", async () => ["a.jpg"]);
  const crear = t.mock.method(datos, "crear", async () => ({ ref: "D1001", link: "https://diamondinmobiliaria.com/propiedades/x-d1001" }));
  const { fila } = normalizar(DATOS);
  const r = await executeTool("confirmar_publicacion", { ...DATOS, token: tokenDe(fila, ["a.jpg"]) }, ctx());
  assert.strictEqual(crear.mock.calls[0].arguments[1], ADVISOR);
  assert.match(r, /CREADA: ref D1001/);
  assert.match(r, /x-d1001/);
});

test("confirmar sin migracion lo dice", async (t) => {
  t.mock.method(datos, "fotosRecientes", async () => ["a.jpg"]);
  t.mock.method(datos, "crear", async () => { const e = new Error("x"); e.code = "SIN_MIGRACION"; throw e; });
  const { fila } = normalizar(DATOS);
  const r = await executeTool("confirmar_publicacion", { ...DATOS, token: tokenDe(fila, ["a.jpg"]) }, ctx());
  assert.match(r, /migraci/i);
  assert.match(r, /no prometas/i);
});

test("actualizar_vigencia: renueva o da de baja la del asesor", async (t) => {
  const aplicar = t.mock.method(datos, "aplicarVigencia", async (o, a, ref, sigue) => ({ estado: sigue ? "renovada" : "baja", ref: "D1001" }));
  assert.match(await executeTool("actualizar_vigencia", { ref: "D1001", sigue: true }, ctx()), /30 días más/);
  assert.match(await executeTool("actualizar_vigencia", { ref: "D1001", sigue: false }, ctx()), /sale del inventario/);
  assert.deepStrictEqual(aplicar.mock.calls[0].arguments, ["org-1", "adv-1", "D1001", true]);
});
