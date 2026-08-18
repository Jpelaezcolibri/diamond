// Caso real 2026-08-18: Sofi le mando a Catherine
// "https://wa.me/message/YOUR_CONTACT_LINK" — un placeholder inventado — en
// vez de decir que no tenia el telefono del colega, aunque el prompt se lo
// prohibia explicitamente. Esta es la compuerta de codigo que no depende de
// que el modelo se acuerde de la regla: ver src/agent/sofi-comando-tools.js
// (enviar_whatsapp_equipo).

const { test } = require("node:test");
const assert = require("node:assert");
const { motivoDeBloqueo } = require("../src/lib/validar-mensaje");

test("bloquea el caso real: wa.me/message/YOUR_CONTACT_LINK", () => {
  const texto = "Contacto: Liliana Giraldo\nhttps://wa.me/message/YOUR_CONTACT_LINK";
  assert.ok(motivoDeBloqueo(texto));
});

test("bloquea cualquier marcador YOUR_ALGO sin rellenar", () => {
  assert.ok(motivoDeBloqueo("Escribile a YOUR_PHONE_NUMBER"));
});

test("bloquea PLACEHOLDER literal", () => {
  assert.ok(motivoDeBloqueo("Contacto: PLACEHOLDER"));
});

test("bloquea un [link] o [telefono] entre corchetes sin rellenar", () => {
  assert.ok(motivoDeBloqueo("Escribile por acá: [link de contacto]"));
  assert.ok(motivoDeBloqueo("Su número: [teléfono]"));
});

test("bloquea un wa.me con letras en vez del numero", () => {
  assert.ok(motivoDeBloqueo("Hablale por https://wa.me/numero-del-colega"));
});

test("un wa.me con un numero real de verdad NO se bloquea", () => {
  assert.strictEqual(motivoDeBloqueo("Hablale por https://wa.me/573001234567"), null);
});

test("un mensaje sin ningun link tampoco se bloquea — decir 'sin telefono' es la salida correcta", () => {
  assert.strictEqual(motivoDeBloqueo("Contacto: Liliana Giraldo, sin teléfono — respondele en el grupo"), null);
});

test("un mensaje normal sin nada raro pasa limpio", () => {
  assert.strictEqual(motivoDeBloqueo("Hola Catherine, te paso el resumen de hoy: 3 pedidos, 2 aprobados."), null);
});
