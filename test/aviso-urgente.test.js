// Una oportunidad APROBADA que el bot no pudo mandar tiene que gritar (Juan,
// 2026-09-02): "no se puede enviar por que el numero no esta disponible,
// envialo con urgencia que es una gran oportunidad, con emojis de alerta [...]
// para que yo pueda saber que es lo que se queda y por que".
//
// Caso real: Fontanar / Julieth Piedrahita. Sofi aprobo (refs_utiles), no
// salio por sin_telefono, y el feed decia "En cola de salida" sin la razon —
// Juan entendio que Sofi la habia negado por tener mas de lo pedido.
const { test } = require("node:test");
const assert = require("node:assert");
const feed = require("../src/groups/feed-comando");
const alerta = require("../src/groups/alerta-asesor");

const senal = {
  grupo_nombre: "PEDIDOS 7:00A.M.8:00P.M.",
  autor_nombre: "Julieth Piedrahíta",
  autor_telefono: "262396832686143",
  texto_original: "Busco Apartamento en el Poblado, minimo 150 mts, 3 habitaciones",
};
const matches = [{ ref: "9935585", titulo: "Apartamento en Venta Fontanar", zona: "El Poblado", precio: "$1.250.000.000", operacion: "Venta", puntaje: 95 }];
const aprobado = { sirve_alguna: true, refs_utiles: ["9935585"], refs_dudosas: [], sin_confirmar: ["balcón amplio"], por_que: "Cumple zona y presupuesto." };

test("feed: aprobada y sin telefono -> encabezado de alerta, la razon y la urgencia", () => {
  const t = feed.construir(senal, aprobado, matches, { enCola: true, motivoDm: "sin_telefono" });
  assert.ok(t.startsWith("🚨🚨 Sofi APROBO un pedido del radar — el bot NO pudo escribirle al colega"), t);
  assert.ok(t.includes("No salio al colega: 🚨 No teníamos ni número ni @lid del colega"), t);
  assert.ok(t.includes("YA APROBADA por Sofi: escribile vos con urgencia"), t);
  assert.ok(t.includes("En cola de salida"), "sigue diciendo que el aviso a la asesora si va");
});

test("feed: aprobada y el DM SI salio -> encabezado normal, sin alerta", () => {
  const t = feed.construir(senal, aprobado, matches, { avisada: true, destinatarioNombre: "Natalia", motivoDm: "ok" });
  assert.ok(t.startsWith("✅ Sofi APROBO"), t);
  assert.ok(!t.includes("🚨"), t);
});

test("feed: descartada por Sofi -> nunca la urgencia, aunque no haya telefono", () => {
  const rechazado = { sirve_alguna: false, refs_utiles: [], refs_dudosas: ["9935585"], por_que: "No calza." };
  const t = feed.construir(senal, rechazado, matches, { motivoDm: "sin_telefono" });
  assert.ok(t.startsWith("❌ Sofi DESCARTO"), t);
  assert.ok(!t.includes("urgencia"), t);
});

test("aviso a la asesora: aprobada y sin telefono -> primera linea de alerta y la urgencia en la razon", () => {
  const t = alerta.construir(senal, aprobado, matches, null, { id: "org-1" }, "sin_telefono");
  assert.ok(t.startsWith("🚨🚨 OPORTUNIDAD APROBADA — el bot NO pudo escribirle al colega"), t);
  assert.ok(t.includes("Por qué no salió solo: 🚨 No teníamos ni número ni @lid"), t);
  assert.ok(t.includes("escribile vos con urgencia"), t);
});

test("aviso a la asesora: solo dudosas -> sin urgencia, es para que decida", () => {
  const dudoso = { sirve_alguna: false, refs_utiles: [], refs_dudosas: ["9935585"], por_que: "Dudosa." };
  const t = alerta.construir(senal, dudoso, matches, null, { id: "org-1" }, "sin_telefono");
  assert.ok(t.startsWith("🎯 Oportunidad en un grupo"), t);
  assert.ok(!t.includes("urgencia"), t);
});

test("porqueNoSalioSolo: con utiles lleva alerta y urgencia; sin utiles, la frase de siempre", () => {
  assert.ok(alerta.porqueNoSalioSolo("sin_telefono", true).startsWith("🚨"));
  assert.ok(alerta.porqueNoSalioSolo("sin_telefono", false).startsWith("Sofi no aprobó ninguna"));
  assert.strictEqual(alerta.porqueNoSalioSolo("ok", true), null, "si salio, no hay razon que dar");
});
