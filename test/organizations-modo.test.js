// El modo de respuesta del radar (sombra | asistido | auto) pasa de variable
// de entorno de Railway a columna en `organizations`, para que sea un toggle
// real desde el CRM y no un redeploy. Ver db/migrations/2026-08-18_grupos_respuesta_modo.sql.

const { test } = require("node:test");
const assert = require("node:assert");
const { modoDeRespuesta, MODOS_RESPUESTA } = require("../src/data/organizations");

test("con un modo valido en la org, ese es el que manda", () => {
  assert.strictEqual(modoDeRespuesta({ grupos_respuesta_modo: "auto" }), "auto");
  assert.strictEqual(modoDeRespuesta({ grupos_respuesta_modo: "asistido" }), "asistido");
  assert.strictEqual(modoDeRespuesta({ grupos_respuesta_modo: "sombra" }), "sombra");
});

test("sin columna (migracion sin correr) o valor invalido, cae a la variable de entorno", () => {
  const original = process.env.GRUPOS_RESPUESTA_MODO;
  process.env.GRUPOS_RESPUESTA_MODO = "asistido";

  assert.strictEqual(modoDeRespuesta({}), "asistido", "sin la columna");
  assert.strictEqual(modoDeRespuesta({ grupos_respuesta_modo: null }), "asistido", "columna en null");
  assert.strictEqual(modoDeRespuesta({ grupos_respuesta_modo: "cualquier-cosa" }), "asistido", "valor invalido");
  assert.strictEqual(modoDeRespuesta(null), "asistido", "sin org resuelta");

  if (original === undefined) delete process.env.GRUPOS_RESPUESTA_MODO;
  else process.env.GRUPOS_RESPUESTA_MODO = original;
});

test("sin columna NI variable de entorno, el default sigue siendo sombra — nunca auto por accidente", () => {
  const original = process.env.GRUPOS_RESPUESTA_MODO;
  delete process.env.GRUPOS_RESPUESTA_MODO;

  assert.strictEqual(modoDeRespuesta({}), "sombra");

  if (original !== undefined) process.env.GRUPOS_RESPUESTA_MODO = original;
});

test("MODOS_RESPUESTA es exactamente sombra/asistido/auto", () => {
  assert.deepStrictEqual(MODOS_RESPUESTA, ["sombra", "asistido", "auto"]);
});
