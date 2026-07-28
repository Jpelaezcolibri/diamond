const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { generarReporte, muestra, TAMANO_MUESTRA } = require("../scripts/group-mining/report");

test("la muestra de descartados es determinística — dos corridas se pueden comparar", () => {
  const items = Array.from({ length: 500 }, (_, i) => i);
  const a = muestra(items);
  const b = muestra(items);
  assert.strictEqual(a.length, TAMANO_MUESTRA);
  assert.deepStrictEqual(a, b);
});

test("la muestra devuelve todo si hay menos de 100", () => {
  const items = [1, 2, 3];
  assert.deepStrictEqual(muestra(items), items);
});

test("la muestra recorre toda la lista, no sólo el principio", () => {
  // Un muestreo que sólo mirara los primeros 100 dejaría meses sin auditar.
  const items = Array.from({ length: 1000 }, (_, i) => i);
  const m = muestra(items);
  assert.strictEqual(m[0], 0);
  assert.ok(m[m.length - 1] > 900, `el último elemento fue ${m[m.length - 1]}`);
});

// ── Generación del HTML ──────────────────────────────────────────────────

const datosMinimos = () => ({
  stats: { total: 10, pasan: 3, descartados: 7, tasaDescarte: 0.7, porMotivo: { muy_corto: 7 } },
  rango: { desde: "2026-07-05", hasta: "2026-07-07", dias: 3 },
  descartados: [{ grupo: "g", autor: "Colega", texto: "Gracias", motivoDescarte: "muy_corto" }],
  cruces: {
    demandas: [{
      operacion: "venta", tipo: "apartamento", zona: "Laureles", habitaciones: 3, precio_max: 400000000,
      matches: [{ fuente: "diamond", ref: "9921388", zona: "Laureles", precio: "$380.000.000" }],
      mensaje: { grupo: "g", fechaIso: "2026-07-05", autor: "Carlos", texto: "Tengo cliente para apto" },
    }],
    ofertas: [{
      operacion: "venta", tipo: "casa", zona: "Sabaneta", ciudad: "", precio_max: 650000000, precio_min: 0,
      utilizable: false, faltantes: ["contacto"],
      mensaje: { grupo: "g", fechaIso: "2026-07-05", autor: "Diana", texto: "Se vende casa" },
    }],
    ruido: [],
  },
  usoTokens: { input_tokens: 1000, output_tokens: 500, costoUsd: 0.0035 },
  lotesFallidos: 0,
});

function generarEnTemp(datos) {
  const destino = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "grupos-")), "reporte.html");
  generarReporte(destino, datos);
  return fs.readFileSync(destino, "utf8");
}

test("el reporte incluye las dos direcciones y la muestra de descartados", () => {
  const html = generarEnTemp(datosMinimos());
  assert.match(html, /Demandas de colegas/);
  assert.match(html, /Ofertas de colegas/);
  assert.match(html, /Muestra de descartados/);
  assert.match(html, /9921388/);
  assert.match(html, /falta contacto/);
});

test("el costo mensual se proyecta desde el costo medido y los días del export", () => {
  // 0.0035 USD en 3 días → 0.035 USD/mes
  const html = generarEnTemp(datosMinimos());
  assert.match(html, /US\$0\.04/);
});

test("SEGURIDAD: el texto de terceros se escapa — un mensaje no puede inyectar HTML", () => {
  // Los mensajes vienen de gente ajena a Diamond; sin escapar, un <script> en
  // un grupo se ejecuta al abrir el reporte.
  const datos = datosMinimos();
  datos.cruces.demandas[0].mensaje.texto = '<script>alert("xss")</script>';
  const html = generarEnTemp(datos);
  assert.ok(!html.includes("<script>alert"), "el script llegó sin escapar al HTML");
  assert.match(html, /&lt;script&gt;/);
});

test("un lote fallido sale como aviso destacado, no enterrado", () => {
  // Sin el aviso, un fallo masivo de la API se lee como 'poca señal' y el
  // proyecto se cancela por la razón equivocada.
  const datos = { ...datosMinimos(), lotesFallidos: 3 };
  const html = generarEnTemp(datos);
  assert.match(html, /3 lote\(s\) de clasificación fallaron/);
  assert.match(html, /subestiman el resultado real/);
});

test("sin lotes fallidos no aparece el aviso", () => {
  assert.ok(!generarEnTemp(datosMinimos()).includes("fallaron"));
});

test("el reporte no explota sin demandas ni ofertas", () => {
  const datos = datosMinimos();
  datos.cruces = { demandas: [], ofertas: [], ruido: [] };
  const html = generarEnTemp(datos);
  assert.match(html, /No se detectó ninguna demanda/);
  assert.match(html, /No se detectó ninguna oferta/);
});

test("las compuertas marcan PASA y NO PASA según el umbral", () => {
  const datos = datosMinimos();
  const html = generarEnTemp(datos);
  // Descarte 70% justo en el umbral → PASA. Demandas 0.3/día → NO PASA.
  assert.match(html, /PASA/);
  assert.match(html, /NO PASA/);
});

test("las dos métricas manuales quedan marcadas para revisión, no fingidas", () => {
  const html = generarEnTemp(datosMinimos());
  assert.match(html, /Precisión de clasificación[\s\S]{0,200}revisar a mano/);
  assert.match(html, /Falsos negativos[\s\S]{0,200}revisar a mano/);
});
