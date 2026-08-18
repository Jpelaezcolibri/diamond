// Numero marcable vs @lid (identificador interno de WhatsApp). Compartido
// entre alerta-asesor.js y radar-trazabilidad.js para que no diverjan sobre
// que cuenta como "se puede contactar" — bug real encontrado 2026-08-18:
// alerta-asesor.js armaba el link con CUALQUIER telefono, sin filtrar los
// @lid, mientras que radar-trazabilidad.js si los filtraba pero nunca
// exponia el numero (solo un booleano) — Sofi no tenia de donde sacar el
// link para el mensaje que le pidio Juan.

const { test } = require("node:test");
const assert = require("node:assert");
const { esMarcable, linkWhatsapp } = require("../src/lib/contacto");

test("un colombiano real (12 digitos con 57) es marcable", () => {
  assert.strictEqual(esMarcable("573001234567"), true);
  assert.strictEqual(linkWhatsapp("573001234567"), "https://wa.me/573001234567");
});

test("un @lid (14-15 digitos) NO es marcable — no arma un link roto", () => {
  assert.strictEqual(esMarcable("141746805670125"), false);
  assert.strictEqual(linkWhatsapp("141746805670125"), null);
});

test("sin telefono, ninguna de las dos truena", () => {
  assert.strictEqual(esMarcable(null), false);
  assert.strictEqual(esMarcable(undefined), false);
  assert.strictEqual(esMarcable(""), false);
  assert.strictEqual(linkWhatsapp(null), null);
});

test("limpia simbolos antes de armar el link (+, espacios, guiones)", () => {
  assert.strictEqual(linkWhatsapp("+57 300 123 4567"), "https://wa.me/573001234567");
});
