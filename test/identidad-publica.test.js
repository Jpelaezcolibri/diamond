// Hacia afuera nadie ve el nombre real ni el celular de una asesora (Juan,
// 2026-10-07): se nombra "Asesor N" y quien inicia el contacto es ella.
const { test } = require("node:test");
const assert = require("node:assert");
// Juan (2026-11-09, caso Norha): hacia afuera nunca "Asesor N"; siempre "un asesor de nuestro equipo".
const { asesorPublico, aliasInterno, textoCitaConfirmada, instruccionTransferencia } = require("../src/lib/identidad-publica");

const ORG = { id: "org-1", name: "Diamond" };
const REAL = { id: "a1", name: "ZZNombreReal Apellido", phone: "573000000000", alias_publico: "Asesor 2" };
const SIN_ALIAS = { id: "a2", name: "ZZOtraReal", phone: "573111111111", alias_publico: null };

const sinFiltrar = (texto) => {
  assert.doesNotMatch(texto, /ZZNombreReal|ZZOtraReal/, "no lleva el nombre real");
  assert.doesNotMatch(texto, /573000000000|573111111111|300 000 0000/, "no lleva el celular");
};

test("hacia afuera siempre 'un asesor de nuestro equipo'; adentro el alias o el nombre", () => {
  assert.strictEqual(asesorPublico(), "un asesor de nuestro equipo");
  assert.strictEqual(aliasInterno(REAL), "Asesor 2");
  assert.strictEqual(aliasInterno(SIN_ALIAS), "ZZOtraReal");
});

test("la confirmación de visita no nombra al asesor ni da celular", () => {
  const t = textoCitaConfirmada({ cuando: "del jueves 9 de octubre a las 3:00 p. m.", ref: "10012722", advisor: REAL, org: ORG });
  assert.strictEqual(t, "Tu visita del jueves 9 de octubre a las 3:00 p. m. a la ref 10012722 quedó CONFIRMADA. Te recibe un asesor de nuestro equipo.");
  assert.doesNotMatch(t, /Asesor \d/);
  sinFiltrar(t);
});

test("la confirmación sin ref no deja un hueco", () => {
  const t = textoCitaConfirmada({ cuando: "acordada", ref: null, advisor: SIN_ALIAS, org: ORG });
  assert.strictEqual(t, "Tu visita acordada quedó CONFIRMADA. Te recibe un asesor de nuestro equipo.");
});

test("la transferencia no le da link ni celular al cliente: el asesor lo contacta", () => {
  const t = instruccionTransferencia({ especialidad: "venta", advisor: REAL, org: ORG });
  assert.doesNotMatch(t, /Asesor \d/);
  assert.match(t, /un asesor de nuestro equipo lo va a contactar/);
  assert.match(t, /NO le des ningún link ni número/);
  assert.doesNotMatch(t, /wa\.me/);
  sinFiltrar(t);
});

const fs = require("node:fs");
const path = require("node:path");
const fuenteTools = fs.readFileSync(path.join(__dirname, "..", "src", "agent", "tools.js"), "utf8");

test("tools.js arma la confirmación y la transferencia con identidad-publica", () => {
  // Desde 2026-10-07 la confirmacion vive en confirmar-cita.js (tool y boton).
  const fuenteConfirmar = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "confirmar-cita.js"), "utf8");
  assert.match(fuenteConfirmar, /textoCitaConfirmada\(/);
  assert.match(fuenteTools, /instruccionTransferencia\(/);
  assert.doesNotMatch(fuenteTools, /Te recibe \$\{ctx\.advisor\.name\}/, "el nombre real ya no va al cliente");
  assert.doesNotMatch(fuenteTools, /link EXACTO para que el cliente hable directo con el asesor/);
});

test("agendar_cita no le pasa a Sofi el celular de quien coordina", () => {
  assert.doesNotMatch(fuenteTools, /puede escribirle a \+\$\{coordinador\.phone\}/);
  assert.doesNotMatch(fuenteTools, /coordinador\?\.name \|\| "la asesora"/);
});
