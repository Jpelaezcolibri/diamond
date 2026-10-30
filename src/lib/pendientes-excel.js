// El Excel de pendientes de la asesora (spec 2026-10-30 §5-6). Puro: arma el
// libro, lo lee de vuelta y valida cada fila. No toca base ni WhatsApp.
// Columnas por NOMBRE (no por posicion): Excel o Google Sheets pueden
// reordenarlas. Sin la hoja _lote, igual se acepta si trae la columna Codigo:
// el codigo de cada fila es lo que manda (Google Sheets puede soltar la hoja oculta).
const ExcelJS = require("exceljs");

const RESULTADOS = [
  { clave: "visita", texto: "Agendó visita" },
  { clave: "interesado", texto: "Interesado, sigue en conversación" },
  { clave: "otras_opciones", texto: "Quiere otras opciones" },
  { clave: "no_contesta", texto: "No contesta" },
  { clave: "no_interesa", texto: "No le interesa / ya consiguió" },
  { clave: "numero_equivocado", texto: "Número equivocado" },
];

const INFO = [
  ["Código", "codigo", 9], ["Nombre", "nombre", 22], ["Colega / cliente", "tipo", 10], ["WhatsApp", "whatsapp", 22],
  ["Por qué", "porQue", 30], ["Qué pidió", "pidio", 40], ["Qué se le ofreció", "ofrecido", 40],
  ["Lo último que dijo", "ultimoSuyo", 35], ["Lo último de Sofi", "ultimoSofi", 40], ["Chat CRM", "chatUrl", 14],
];
const LLENAR = [["Resultado", "resultado", 28], ["Fecha visita", "fecha", 13], ["Hora", "hora", 10], ["Ref visita", "ref", 11], ["Nota", "nota", 35]];

const GRIS = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEDED" } };
const AMARILLO = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2B3" } };

async function armarLibro({ loteId, asesorId, casos }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Pendientes", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
  ws.columns = [...INFO, ...LLENAR].map(([header, key, width]) => ({ header, key, width }));
  ws.getRow(1).font = { bold: true };
  const lista = `"${RESULTADOS.map((r) => r.texto).join(",")}"`;
  for (const c of casos) {
    const row = ws.addRow({ ...c, chatUrl: c.chatUrl ? { text: "Abrir chat", hyperlink: c.chatUrl } : "" });
    if (/^wa\.me\//.test(c.whatsapp || "")) row.getCell("whatsapp").value = { text: c.whatsapp, hyperlink: `https://${c.whatsapp}` };
    row.alignment = { vertical: "top", wrapText: true };
    INFO.forEach(([, key]) => { row.getCell(key).fill = GRIS; });
    LLENAR.forEach(([, key]) => { const cell = row.getCell(key); cell.fill = AMARILLO; cell.protection = { locked: false }; });
    row.getCell("resultado").dataValidation = { type: "list", allowBlank: true, formulae: [lista], showErrorMessage: true, errorTitle: "Resultado", error: "Elige una opción de la lista." };
  }
  await ws.protect("", { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, formatRows: true });
  const meta = wb.addWorksheet("_lote", { state: "veryHidden" });
  meta.getCell("A1").value = loteId;
  meta.getCell("B1").value = asesorId;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Valor plano de una celda de exceljs: texto, numero, fecha, link o formula.
function plano(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === "number") return v;
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return plano(v.result);
    if ("text" in v) return plano(v.text);
    return null;
  }
  const s = String(v).trim();
  return s === "" ? null : s;
}
const texto = (v) => { const p = plano(v); return p === null ? "" : String(p).trim(); };

async function leerLibro(buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { return { ok: false, error: "ilegible" }; }
  const ws = wb.getWorksheet("Pendientes") || wb.worksheets.find((w) => w.state !== "veryHidden" && w.state !== "hidden");
  if (!ws) return { ok: false, error: "no_es_nuestro" };
  const col = {};
  ws.getRow(1).eachCell((c, i) => { col[texto(c.value).toLowerCase()] = i; });
  if (!col["código"] && !col["codigo"]) return { ok: false, error: "no_es_nuestro" };
  const idx = (nombre) => col[nombre.toLowerCase()];
  const meta = wb.getWorksheet("_lote");
  const filas = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const codigo = texto(row.getCell(idx("Código") || col["codigo"]).value).toUpperCase();
    if (!/^C-\d+$/.test(codigo)) return;
    const celda = (h) => (idx(h) ? plano(row.getCell(idx(h)).value) : null);
    filas.push({ fila: n, codigo, resultado: texto(celda("Resultado")), fecha: celda("Fecha visita"), hora: celda("Hora"), ref: texto(celda("Ref visita")), nota: texto(celda("Nota")) });
  });
  return { ok: true, loteId: meta ? texto(meta.getCell("A1").value) || null : null, asesorId: meta ? texto(meta.getCell("B1").value) || null : null, filas };
}

const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function claveResultado(t) {
  const s = sinTildes(t);
  if (!s) return null;
  if (s.startsWith("agend")) return "visita";
  if (s.startsWith("interes")) return "interesado";
  if (s.includes("otras opciones")) return "otras_opciones";
  if (s.startsWith("no contesta")) return "no_contesta";
  if (s.startsWith("no le interesa") || s.includes("ya consigu")) return "no_interesa";
  if (s.includes("equivocado")) return "numero_equivocado";
  return null;
}

function partesFecha(v, ahora) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return { y: v.getUTCFullYear(), m: v.getUTCMonth() + 1, d: v.getUTCDate() };
  if (typeof v === "number") return partesFecha(new Date(Math.round((v - 25569) * 86400000)), ahora);
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(s);
  if (!m) return undefined; // texto que no es fecha
  const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : ahora.getUTCFullYear();
  return { y, m: +m[2], d: +m[1] };
}

function partesHora(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return { h: v.getUTCHours(), min: v.getUTCMinutes() };
  if (typeof v === "number") { const t = Math.round((v % 1) * 1440); return { h: Math.floor(t / 60), min: t % 60 }; }
  const s = sinTildes(v).replace(/\s+/g, " ");
  const m = /^(\d{1,2})(?:[:.h](\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?$/.exec(s);
  if (!m) return undefined;
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  if (m[3] && m[3].startsWith("p") && h < 12) h += 12;
  if (m[3] && m[3].startsWith("a") && h === 12) h = 0;
  if (!m[3] && h >= 1 && h <= 6) h += 12; // nadie visita a las 3 de la madrugada
  if (h > 23 || min > 59) return undefined;
  return { h, min };
}

// Fecha y hora de Bogota (UTC-5, sin horario de verano) -> ISO UTC.
function fechaHoraBogota(fecha, hora, ahora = new Date()) {
  const f = partesFecha(fecha, ahora);
  const h = partesHora(hora);
  if (!f || !h) return null;
  const dia = new Date(Date.UTC(f.y, f.m - 1, f.d));
  if (isNaN(dia.getTime()) || dia.getUTCMonth() + 1 !== f.m || dia.getUTCDate() !== f.d) return null; // 31/02
  return new Date(Date.UTC(f.y, f.m - 1, f.d, h.h + 5, h.min)).toISOString();
}

function validarFila(fila, { ahora = new Date() } = {}) {
  if (!fila.resultado) return { vacia: true };
  const tipo = claveResultado(fila.resultado);
  if (!tipo) return { ok: false, error: `"${fila.resultado}" no es una de las opciones de la lista` };
  const nota = fila.nota || "";
  if (tipo !== "visita") return { ok: true, accion: { tipo, nota } };
  if (partesFecha(fila.fecha, ahora) === null) return { ok: false, error: "falta la fecha de la visita" };
  if (partesFecha(fila.fecha, ahora) === undefined) return { ok: false, error: `no entiendo la fecha "${fila.fecha}" (escríbela así: 31/10)` };
  if (partesHora(fila.hora) === null) return { ok: false, error: "falta la hora de la visita" };
  if (partesHora(fila.hora) === undefined) return { ok: false, error: `no entiendo la hora "${fila.hora}" (escríbela así: 10:00 a. m.)` };
  const fechaHoraIso = fechaHoraBogota(fila.fecha, fila.hora, ahora);
  if (!fechaHoraIso) return { ok: false, error: "la fecha no existe" };
  if (new Date(fechaHoraIso).getTime() <= ahora.getTime()) return { ok: false, error: "esa fecha y hora ya pasó" };
  const ref = String(fila.ref || "").replace(/\D/g, "");
  if (!ref) return { ok: false, error: "falta la ref de la visita" };
  return { ok: true, accion: { tipo, fechaHoraIso, ref, nota } };
}

module.exports = { RESULTADOS, armarLibro, leerLibro, validarFila, fechaHoraBogota, claveResultado };
