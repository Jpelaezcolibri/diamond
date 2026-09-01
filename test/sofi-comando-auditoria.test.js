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

test("pareceConfirmacion: no confunde una sugerencia ('guardemos') ni una palabra no relacionada ('guardería') con una confirmacion", () => {
  assert.strictEqual(pareceConfirmacion("¿Guardemos el mandato de Sara?"), false);
  assert.strictEqual(pareceConfirmacion("Enviemos el resumen mañana"), false);
  assert.strictEqual(pareceConfirmacion("Registremos el resultado despues"), false);
  assert.strictEqual(pareceConfirmacion("hay una guarderia cerca"), false);
});

test("pareceConfirmacion: no confunde una sugerencia ('mandemos') ni un futuro ('escribiré'/'escribiremos') con una confirmacion", () => {
  assert.strictEqual(pareceConfirmacion("Listo, le mandemos el resumen a Natalia"), false);
  assert.strictEqual(pareceConfirmacion("Ya le escribiré en un momento"), false);
  assert.strictEqual(pareceConfirmacion("Ya le escribiremos mañana"), false);
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

test("pareceConfirmacion: no confunde el subjuntivo/imperativo sin tilde ('guarde', 'envie', 'registre', 'mande') con una confirmacion", () => {
  assert.strictEqual(pareceConfirmacion("¿Querés que lo guarde ahora?"), false);
});

test("pareceConfirmacion: sigue detectando 'guardé' acentuado (regression guard)", () => {
  assert.strictEqual(pareceConfirmacion("Listo, guardé el mandato de Sara A"), true);
});

test("pareceConfirmacion: no confunde una negacion ('aun no lo he guardado') con una confirmacion", () => {
  assert.strictEqual(pareceConfirmacion("Aún no lo he guardado, falta el nombre del cliente."), false);
});

test("pareceConfirmacion: no confunde una negacion con pronombre clitico ('no se lo envié todavía') con una confirmacion", () => {
  assert.strictEqual(pareceConfirmacion("No se lo envié todavía"), false);
});

test("esFalloDeHerramienta: 'No se pudo...' tambien es un fallo real (sinonimo de 'No pude...')", () => {
  assert.strictEqual(esFalloDeHerramienta("No se pudo aprobar (sesion_ambigua)."), true);
  assert.strictEqual(esFalloDeHerramienta("No se pudo enviar el mensaje."), true);
});

test("auditar: recuerdo honesto (solo lectura, cero mutantes, texto confirma) -> disclaimer si, WhatsApp no", () => {
  const r = auditar({
    textoFinal: "Ya le escribí a Catherine ayer sobre eso.",
    llamadasMutantes: [],
    huboLlamadaDeLectura: true,
  });
  assert.strictEqual(r.sinConfirmar, true);
  assert.strictEqual(r.notificar, false);
});

test("auditar: el mismo texto SIN ninguna llamada a herramienta -> sigue siendo el bug original (disclaimer y WhatsApp)", () => {
  const r = auditar({
    textoFinal: "Ya le escribí a Catherine ayer sobre eso.",
    llamadasMutantes: [],
    huboLlamadaDeLectura: false,
  });
  assert.strictEqual(r.sinConfirmar, true);
  assert.strictEqual(r.notificar, true);
});

test("auditar: exito mutante + fallo mutante en el mismo turno, texto confirma de mas -> sospecha, 1 fallo, notificar", () => {
  const r = auditar({
    textoFinal: "Listo, les envié a las tres ✅",
    llamadasMutantes: [
      { nombre: "enviar_whatsapp_equipo", resultado: "Mensaje enviado a Catherine." },
      { nombre: "enviar_whatsapp_equipo", resultado: "No pude enviar el mensaje a Natalia." },
    ],
  });
  assert.strictEqual(r.sinConfirmar, true);
  assert.strictEqual(r.fallos.length, 1);
  assert.strictEqual(r.notificar, true);
});
