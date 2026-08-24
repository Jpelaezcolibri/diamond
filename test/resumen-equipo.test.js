// El resumen de matches pendientes, armado del dato real (no redactado por
// el modelo) — construido para que Sofi nunca tenga que inventar un link de
// contacto (caso real 2026-08-18, ver validar-mensaje.test.js).

const { test } = require("node:test");
const assert = require("node:assert");
const { construir } = require("../src/groups/resumen-equipo");

function señal(extra = {}) {
  return {
    colega: "Liliana Giraldo",
    grupo: "PEDIDOS INMOBILIARIOS",
    pidio: "Busco apto en Loma de los Bernal, 2-3 hab, $600M",
    motor: { detalle: [{ ref: "10013037", zona: "San Joaquín", precio: "$500.000.000" }] },
    sofi: { aprobo: true, refs: ["10013037"] },
    contacto_wa: "https://wa.me/573001234567",
    resultado: null,
    ...extra,
  };
}

test("un pendiente: cita el pedido tal cual, con la ref y el contacto real", () => {
  const texto = construir([señal()]);
  assert.match(texto, /Liliana Giraldo \(grupo PEDIDOS INMOBILIARIOS\)/);
  assert.match(texto, /Pidió: "Busco apto en Loma de los Bernal, 2-3 hab, \$600M"/);
  assert.match(texto, /Ref 10013037/);
  assert.match(texto, /https:\/\/wa\.me\/573001234567/);
  assert.match(texto, /^Match pendiente de seguimiento:/);
});

// Nunca "respondele en el grupo" (norma de Juan, 2026-08-22): el gremio pide
// no llenar los grupos de informacion. Sin telefono resuelto, la accion real
// es tocar el nombre del colega en el grupo para abrirle el chat privado
// (tocarNombreEnGrupo, src/lib/contacto.js) — ver test/no-respondas-en-el-grupo.test.js
// para la garantia de que esa frase vieja no vuelva a aparecer en ningun aviso.
test("sin contacto_wa, dice explicito que no hay telefono — nunca inventa un link, y nunca manda a responder en el grupo", () => {
  const texto = construir([señal({ contacto_wa: null })]);
  assert.match(texto, /sin teléfono — tocá el nombre de Liliana Giraldo en el grupo/);
  assert.doesNotMatch(texto, /wa\.me\/(?!573001234567)/);
  assert.doesNotMatch(texto, /respondele en el grupo/);
});

test("varias señales: plural correcto, cada una con su propio bloque", () => {
  const texto = construir([
    señal({ colega: "Liliana Giraldo" }),
    señal({ colega: "Alexander Castaño", grupo: "PEDIDOS 7AM-8PM", pidio: "Busco casa en Envigado" }),
  ]);
  assert.match(texto, /^Match(es)? pendientes de seguimiento:/);
  assert.match(texto, /Liliana Giraldo/);
  assert.match(texto, /Alexander Castaño/);
  assert.match(texto, /Busco casa en Envigado/);
});

test("descarta señales que Sofi no aprobo o que no tienen refs — no hay nada que ofrecer ahi", () => {
  assert.strictEqual(construir([señal({ sofi: { aprobo: false, refs: [] } })]), null);
  assert.strictEqual(construir([señal({ sofi: { aprobo: true, refs: [] } })]), null);
});

test("sin señales, no arma nada", () => {
  assert.strictEqual(construir([]), null);
  assert.strictEqual(construir(undefined), null);
});

test("termina pidiendo el resultado — es el dato que cierra el ciclo", () => {
  assert.match(construir([señal()]), /Contame en qué quedó cada uno para registrarlo\.$/);
});
