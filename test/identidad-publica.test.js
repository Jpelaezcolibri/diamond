// Hacia afuera nadie ve el nombre real ni el celular de una asesora (Juan,
// 2026-10-07): se nombra "Asesor N" y quien inicia el contacto es ella.
const { test } = require("node:test");
const assert = require("node:assert");
const { aliasPublico, textoCitaConfirmada, instruccionTransferencia } = require("../src/lib/identidad-publica");

const ORG = { id: "org-1", name: "Diamond" };
const REAL = { id: "a1", name: "ZZNombreReal Apellido", phone: "573000000000", alias_publico: "Asesor 2" };
const SIN_ALIAS = { id: "a2", name: "ZZOtraReal", phone: "573111111111", alias_publico: null };

const sinFiltrar = (texto) => {
  assert.doesNotMatch(texto, /ZZNombreReal|ZZOtraReal/, "no lleva el nombre real");
  assert.doesNotMatch(texto, /573000000000|573111111111|300 000 0000/, "no lleva el celular");
};

test("aliasPublico usa el alias y, sin alias, un genérico con el nombre de la org", () => {
  assert.strictEqual(aliasPublico(REAL, ORG), "Asesor 2");
  assert.strictEqual(aliasPublico(SIN_ALIAS, ORG), "un asesor de Diamond");
  assert.strictEqual(aliasPublico(null, ORG), "un asesor de Diamond");
});

test("la confirmación de visita nombra al alias y no da celular", () => {
  const t = textoCitaConfirmada({ cuando: "del jueves 9 de octubre a las 3:00 p. m.", ref: "10012722", advisor: REAL, org: ORG });
  assert.strictEqual(t, "Tu visita del jueves 9 de octubre a las 3:00 p. m. a la ref 10012722 quedó CONFIRMADA. Te recibe Asesor 2.");
  sinFiltrar(t);
});

test("la confirmación sin ref no deja un hueco", () => {
  const t = textoCitaConfirmada({ cuando: "acordada", ref: null, advisor: SIN_ALIAS, org: ORG });
  assert.strictEqual(t, "Tu visita acordada quedó CONFIRMADA. Te recibe un asesor de Diamond.");
});

test("la transferencia no le da link ni celular al cliente: el asesor lo contacta", () => {
  const t = instruccionTransferencia({ especialidad: "venta", advisor: REAL, org: ORG });
  assert.match(t, /Asesor 2/);
  assert.match(t, /te va a contactar|lo va a contactar/);
  assert.match(t, /NO le des ningún link ni número/);
  assert.doesNotMatch(t, /wa\.me/);
  sinFiltrar(t);
});

const fs = require("node:fs");
const path = require("node:path");
const fuenteTools = fs.readFileSync(path.join(__dirname, "..", "src", "agent", "tools.js"), "utf8");

test("tools.js arma la confirmación y la transferencia con identidad-publica", () => {
  assert.match(fuenteTools, /textoCitaConfirmada\(/);
  assert.match(fuenteTools, /instruccionTransferencia\(/);
  assert.doesNotMatch(fuenteTools, /Te recibe \$\{ctx\.advisor\.name\}/, "el nombre real ya no va al cliente");
  assert.doesNotMatch(fuenteTools, /link EXACTO para que el cliente hable directo con el asesor/);
});
