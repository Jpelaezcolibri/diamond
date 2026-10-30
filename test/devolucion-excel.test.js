const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const ExcelJS = require("exceljs");
const memory = require("../src/data/memory");
const cp = require("../src/data/contactos-pendientes");
const px = require("../src/lib/pendientes-excel");
const dev = require("../src/lib/devolucion-excel");

const ORG = { id: "o1", name: "Diamond" };
const ADV = { id: "a1", name: "Daiana" };
const AHORA = new Date("2026-10-30T13:00:00Z");
let aplicados, p1, p2, p3;

async function excelLleno(valores, { asesorId = "a1" } = {}) {
  const casos = [p1, p2, p3].map((p) => ({ codigo: p.codigo, nombre: "x" }));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await px.armarLibro({ loteId: "L-1", asesorId, casos }));
  const ws = wb.getWorksheet("Pendientes");
  const col = {};
  ws.getRow(1).eachCell((c, i) => { col[String(c.value)] = i; });
  valores.forEach((v, i) => { for (const [k, x] of Object.entries(v)) ws.getRow(i + 2).getCell(col[k]).value = x; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const deps = (buf, over = {}) => ({
  descargar: async () => buf,
  lead: async (_o, id) => ({ id, phone: "57300", source: "colega" }),
  refExiste: async (_o, ref) => ref === "10414675",
  choca: async () => false,
  aplicar: async (a) => { aplicados.push([a.pendiente.codigo, a.accion.tipo]); return { ok: true, resumen: a.accion.tipo === "visita" ? "visita" : "nota" }; },
  ...over,
});

beforeEach(async () => {
  memory.contactosPendientes.length = 0;
  aplicados = [];
  p1 = (await cp.abrir({ orgId: "o1", leadId: "l1", asesorId: "a1", motivo: "no_contesto" })).pendiente;
  p2 = (await cp.abrir({ orgId: "o1", leadId: "l2", asesorId: "a1", motivo: "no_contesto" })).pendiente;
  p3 = (await cp.abrir({ orgId: "o1", leadId: "l3", asesorId: "a2", motivo: "no_contesto" })).pendiente;
});

test("aplica lo válido y le cuenta qué falta corregir", async () => {
  const buf = await excelLleno([
    { Resultado: "Agendó visita", "Fecha visita": "31/10", Hora: "10:00", "Ref visita": "10414675" },
    { Resultado: "Agendó visita", "Fecha visita": "31/10" },
    { Resultado: "Interesado, sigue en conversación" },
  ]);
  const txt = await dev.procesar({ org: ORG, advisor: ADV, mediaUrl: "u", ahora: AHORA, deps: deps(buf) });
  assert.deepStrictEqual(aplicados, [[p1.codigo, "visita"]]);
  assert.match(txt, /apliqué 1/);
  assert.match(txt, new RegExp(`fila 3 \\(${p2.codigo}\\): falta la hora`));
  assert.match(txt, new RegExp(`fila 4 \\(${p3.codigo}\\): no es tuyo`));
});

test("ref inexistente y choque de agenda son errores de la fila", async () => {
  const buf = await excelLleno([
    { Resultado: "Agendó visita", "Fecha visita": "31/10", Hora: "10:00", "Ref visita": "999" },
    { Resultado: "Agendó visita", "Fecha visita": "31/10", Hora: "10:00", "Ref visita": "10414675" },
  ]);
  const txt = await dev.procesar({ org: ORG, advisor: ADV, mediaUrl: "u", ahora: AHORA, deps: deps(buf, { choca: async () => true }) });
  assert.strictEqual(aplicados.length, 0);
  assert.match(txt, /la ref 999 no está en el inventario/);
  assert.match(txt, /ya tienes otra visita a esa hora/);
});

test("sin nada llenado, o un archivo que no es el nuestro", async () => {
  const vacio = await excelLleno([]);
  assert.match(await dev.procesar({ org: ORG, advisor: ADV, mediaUrl: "u", ahora: AHORA, deps: deps(vacio) }), /no veo ningún resultado/);
  assert.match(await dev.procesar({ org: ORG, advisor: ADV, mediaUrl: "u", ahora: AHORA, deps: deps(Buffer.from("x")) }), /no lo pude abrir/);
});

test("reconoce un .xlsx", () => {
  assert.strictEqual(dev.esExcel({ type: "document", media_mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), true);
  assert.strictEqual(dev.esExcel({ type: "document", media_mime: "application/pdf" }), false);
  assert.strictEqual(dev.esExcel({ type: "image", media_mime: "image/jpeg" }), false);
});
