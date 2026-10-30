const { test } = require("node:test");
const assert = require("node:assert");
const ExcelJS = require("exceljs");
const px = require("../src/lib/pendientes-excel");

const AHORA = new Date("2026-10-30T13:00:00Z"); // vie 8 a. m. Bogota
const caso = (over = {}) => ({ codigo: "C-0001", nombre: "Clara", tipo: "colega", whatsapp: "wa.me/573014521622", porQue: "no le contestó a Sofi", pidio: "Casa en arriendo en El Poblado", ofrecido: "Ref 10414675 https://info.wasi.co/x/10414675?shared=whatsapp", ultimoSuyo: "quiero agendar", ultimoSofi: "¿te sirve el jueves?", chatUrl: "https://crm.x/inbox/c1", ...over });

async function llenar(buffer, valores) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet("Pendientes");
  const col = {};
  ws.getRow(1).eachCell((c, i) => { col[String(c.value)] = i; });
  valores.forEach((v, i) => { for (const [k, x] of Object.entries(v)) ws.getRow(i + 2).getCell(col[k]).value = x; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test("arma el libro, con lista desplegable, y lo vuelve a leer con el lote", async () => {
  const buf = await px.armarLibro({ loteId: "L-1", asesorId: "a1", casos: [caso(), caso({ codigo: "C-0002", nombre: "Luz" })] });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet("Pendientes");
  const colRes = ws.getRow(1).values.indexOf("Resultado");
  assert.strictEqual(ws.getRow(2).getCell(colRes).dataValidation.type, "list");
  const leido = await px.leerLibro(buf);
  assert.deepStrictEqual([leido.ok, leido.loteId, leido.asesorId, leido.filas.length], [true, "L-1", "a1", 2]);
  assert.strictEqual(leido.filas[0].codigo, "C-0001");
});

test("lee lo que llenó la asesora, con fecha y hora como celdas o como texto", async () => {
  const base = await px.armarLibro({ loteId: "L-1", asesorId: "a1", casos: [caso(), caso({ codigo: "C-0002" })] });
  const buf = await llenar(base, [
    { Resultado: "Agendó visita", "Fecha visita": new Date(Date.UTC(2026, 9, 31)), Hora: "10:00 a. m.", "Ref visita": 10414675, Nota: "va con la esposa" },
    { Resultado: "No contesta" },
  ]);
  const { filas } = await px.leerLibro(buf);
  const v = px.validarFila(filas[0], { ahora: AHORA });
  assert.deepStrictEqual(v, { ok: true, accion: { tipo: "visita", fechaHoraIso: "2026-10-31T15:00:00.000Z", ref: "10414675", nota: "va con la esposa" } });
  assert.deepStrictEqual(px.validarFila(filas[1], { ahora: AHORA }).accion.tipo, "no_contesta");
});

test("errores de llenado", () => {
  const f = (o) => ({ fila: 2, codigo: "C-0001", resultado: "", fecha: null, hora: null, ref: "", nota: "", ...o });
  assert.deepStrictEqual(px.validarFila(f({}), { ahora: AHORA }), { vacia: true });
  assert.match(px.validarFila(f({ resultado: "lo llamé" }), { ahora: AHORA }).error, /no es una de las opciones/);
  assert.match(px.validarFila(f({ resultado: "Agendó visita", fecha: "31/10", ref: "1" }), { ahora: AHORA }).error, /falta la hora/);
  assert.match(px.validarFila(f({ resultado: "Agendó visita", hora: "10:00", ref: "1" }), { ahora: AHORA }).error, /falta la fecha/);
  assert.match(px.validarFila(f({ resultado: "Agendó visita", fecha: "29/10/2026", hora: "10:00", ref: "1" }), { ahora: AHORA }).error, /ya pasó/);
  assert.match(px.validarFila(f({ resultado: "Agendó visita", fecha: "31/10", hora: "10:00" }), { ahora: AHORA }).error, /falta la ref/);
  assert.match(px.validarFila(f({ resultado: "Agendó visita", fecha: "mañana", hora: "10:00", ref: "1" }), { ahora: AHORA }).error, /no entiendo la fecha/);
});

test("horas escritas de varias formas", () => {
  const iso = (h) => px.fechaHoraBogota("31/10/2026", h, AHORA);
  assert.strictEqual(iso("15:30"), "2026-10-31T20:30:00.000Z");
  assert.strictEqual(iso("3:30 pm"), "2026-10-31T20:30:00.000Z");
  assert.strictEqual(iso("3 p. m."), "2026-10-31T20:00:00.000Z");
  assert.strictEqual(iso("3"), "2026-10-31T20:00:00.000Z"); // sin am/pm, 1 a 6 se lee de la tarde
  assert.strictEqual(iso("9"), "2026-10-31T14:00:00.000Z");
});

test("un archivo que no es nuestro o no es Excel", async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Hoja1").addRow(["hola"]);
  assert.deepStrictEqual(await px.leerLibro(Buffer.from(await wb.xlsx.writeBuffer())), { ok: false, error: "no_es_nuestro" });
  assert.deepStrictEqual(await px.leerLibro(Buffer.from("no soy un excel")), { ok: false, error: "ilegible" });
});
