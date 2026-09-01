const { test } = require("node:test");
const assert = require("node:assert");
const { pareceConfirmacion, esFalloDeHerramienta, auditar } = require("../src/agent/sofi-comando-auditoria");

test("pareceConfirmacion: detecta el check verde", () => {
  assert.strictEqual(pareceConfirmacion("Guardado ✅\n\nMANDATO DE COMPRA #1"), true);
});

test("pareceConfirmacion: detecta 'guardé'/'guardado' en distintas formas", () => {
  assert.strictEqual(pareceConfirmacion("Listo, guardé el mandato de Sara A"), true);
  assert.strictEqual(pareceConfirmacion("Ya quedó guardado en el sistema"), true);
});

test("pareceConfirmacion: detecta envios ('envié', 'le mandé', 'ya le escribí')", () => {
  assert.strictEqual(pareceConfirmacion("Les envié el mensaje a las dos"), true);
  assert.strictEqual(pareceConfirmacion("Listo, le mandé el resumen a Natalia"), true);
  assert.strictEqual(pareceConfirmacion("Ya le escribí a Catherine"), true);
});

test("pareceConfirmacion: detecta 'registré'/'registrado'", () => {
  assert.strictEqual(pareceConfirmacion("Registré el resultado del pedido"), true);
});

test("pareceConfirmacion: un texto que no confirma nada da false", () => {
  assert.strictEqual(pareceConfirmacion("¿Me confirmás el nombre del cliente antes de guardarlo?"), false);
  assert.strictEqual(pareceConfirmacion("Hoy no tenés pendientes urgentes."), false);
});

test("esFalloDeHerramienta: 'No pude...' es un fallo real", () => {
  assert.strictEqual(esFalloDeHerramienta("No pude guardar el mandato — avisale a Juan, puede ser que falte correr una migración."), true);
});

test("esFalloDeHerramienta: el prefijo generico de excepcion tambien es un fallo real", () => {
  assert.strictEqual(esFalloDeHerramienta("Error ejecutando la herramienta: timeout"), true);
});

test("esFalloDeHerramienta: pedir mas informacion NO es un fallo", () => {
  assert.strictEqual(esFalloDeHerramienta("Falta el nombre del cliente. Preguntale de quién es el mandato antes de registrarlo."), false);
});

test("esFalloDeHerramienta: rechazar el uso NO es un fallo", () => {
  assert.strictEqual(esFalloDeHerramienta("Esto solo lo puede usar un admin."), false);
  assert.strictEqual(esFalloDeHerramienta("Esta herramienta es interna del equipo: solo un asesor de la casa puede registrar un mandato de compra."), false);
});

test("auditar: confirmacion sin ninguna tool mutante llamada -> sospecha", () => {
  const r = auditar({ textoFinal: "Guardado ✅ MANDATO DE COMPRA #1", llamadasMutantes: [] });
  assert.strictEqual(r.sinConfirmar, true);
  assert.deepStrictEqual(r.fallos, []);
  assert.strictEqual(r.notificar, true);
});

test("auditar: confirmacion CON una tool mutante exitosa -> no hay sospecha", () => {
  const r = auditar({
    textoFinal: "Listo, guardé el mandato de Sara A: · Compra lote hasta $600.000.000",
    llamadasMutantes: [{ nombre: "registrar_mandato_compra", resultado: "Listo, guardé el mandato de Sara A: · Compra lote hasta $600.000.000" }],
  });
  assert.strictEqual(r.sinConfirmar, false);
  assert.strictEqual(r.notificar, false);
});

test("auditar: tool mutante que fallo, pero el texto confirma de todas formas -> sospecha Y fallo", () => {
  const r = auditar({
    textoFinal: "Guardado ✅",
    llamadasMutantes: [{ nombre: "registrar_mandato_compra", resultado: "No pude guardar el mandato — avisale a Juan." }],
  });
  assert.strictEqual(r.sinConfirmar, true);
  assert.strictEqual(r.fallos.length, 1);
  assert.strictEqual(r.notificar, true);
});

test("auditar: tool mutante que fallo, texto honesto (sin lenguaje de confirmacion) -> fallo pero no sospecha", () => {
  const r = auditar({
    textoFinal: "No pude guardar el mandato, avisale a Juan por si falta una migración.",
    llamadasMutantes: [{ nombre: "registrar_mandato_compra", resultado: "No pude guardar el mandato — avisale a Juan." }],
  });
  assert.strictEqual(r.sinConfirmar, false);
  assert.strictEqual(r.fallos.length, 1);
  assert.strictEqual(r.notificar, true);
});

test("auditar: sin ninguna tool mutante y sin lenguaje de confirmacion -> todo tranquilo", () => {
  const r = auditar({ textoFinal: "Hoy no tenés pendientes urgentes.", llamadasMutantes: [] });
  assert.strictEqual(r.sinConfirmar, false);
  assert.strictEqual(r.fallos.length, 0);
  assert.strictEqual(r.notificar, false);
});
