// Que dice el colega de lo automatico (2026-10-21). Casos reales de la linea.
const { test } = require("node:test");
const assert = require("node:assert");
const { pidePersona, esAutorespuesta } = require("../src/groups/rechaza-bot");

test("rechaza el bot o pide una persona", () => {
  for (const t of [
    "Su sistema de IA Está fallando Exitos",
    "Me gusta comunicarme con un asesor, no con asistente virtual",
    "Enviame los link Sin explicación automáticas",
    "Buen día no entiendo está maquina la verdad, si de pronto un asesor se comunica mil gracias",
    "esto lo hace la inteligencia artificial?",
  ]) assert.strictEqual(pidePersona(t), true, t);
});

test("no confunde 'ia' dentro de una palabra ni una pregunta normal", () => {
  for (const t of ["La vía principal queda cerca", "Ubicación de Fontanar", "¿tiene parqueadero cubierto?", "Valor administración de la opción 2 .. Cuál es ?"]) {
    assert.strictEqual(pidePersona(t), false, t);
  }
});

test("reconoce la respuesta automatica de otra inmobiliaria", () => {
  assert.strictEqual(esAutorespuesta("Gracias por tu mensaje. En este momento no podemos responderte"), true);
  assert.strictEqual(esAutorespuesta("Enviame los link Sin explicación automáticas"), false);
});

test("quien se presenta como asesora no esta pidiendo una", () => {
  assert.strictEqual(pidePersona("Te habla Victoria Rios asesora inmobiliaria"), false);
  assert.strictEqual(pidePersona("Soy Marta, asesora de Fincas, escríbeme si tienes algo"), false);
  // Pero si ademas rechaza el bot, cuenta.
  assert.strictEqual(pidePersona("Soy asesora y no quiero hablar con un robot"), true);
});

test("contestadores con horario o 'pasado a nuestro equipo' son respuesta automatica", () => {
  assert.strictEqual(esAutorespuesta("He pasado este mensaje a nuestro equipo para que puedan revisarlo. Alguien se pondrá en contacto pronto si es necesario."), true);
  assert.strictEqual(esAutorespuesta("*BIENVENID@* --- JC10AUTOS Y PROPIEDADES --- Lunes a Viernes 9 am - 5 pm Sábados 9 am - 3 pm"), true);
});

// Caso elizabeth muriel (2026-10-28): el bot de otra inmobiliaria contesto en
// la linea y su "quedamos atentos ... para coordinar la visita" quedo como cita.
test("el asistente de otra inmobiliaria que remite al equipo o al catalogo", () => {
  assert.strictEqual(esAutorespuesta("He conectado tu mensaje con nuestro equipo para que lo revisen."), true);
  assert.strictEqual(esAutorespuesta("¡Hola! Es un gusto saludarte.\nTe recomiendo que accedas a nuestro catálogo aquí en WhatsApp para ver algunas de las opciones"), true);
  assert.strictEqual(esAutorespuesta("Te mando el catálogo de opciones que tengo"), false);
});

test("hiloAutomatico: un solo mensaje automatico marca todo el hilo", () => {
  const { hiloAutomatico } = require("../src/groups/rechaza-bot");
  assert.strictEqual(hiloAutomatico(["He conectado tu mensaje con nuestro equipo para que lo revisen.", "Perfecto Diamond, quedamos atentos para coordinar la visita"]), true);
  assert.strictEqual(hiloAutomatico(["el cliente puede el lunes a las 4", null]), false);
});
