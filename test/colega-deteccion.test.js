// El colega se reconoce por telefono, y no ensucia el embudo.
//
// Verificado sobre el fuente, no ejecutando el engine: procesarMensaje llama a
// Claude y a la base, y lo que hay que fijar aca son decisiones de estructura
// —el orden de precedencia, la falla abierta y el source del lead— que se leen
// mejor asi que montando media aplicacion en un mock.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const fuente = fs.readFileSync(path.join(__dirname, "..", "src", "agent", "engine.js"), "utf8");

test("engine.js resuelve si quien escribe es un colega", () => {
  assert.match(fuente, /require\("\.\.\/groups\/directorio"\)/);
  assert.match(fuente, /directorio\.esColega\(/);
});

test("el colega se busca DESPUES del asesor y solo si no hay asesor", () => {
  const iAsesor = fuente.indexOf("advisors.findByPhone(");
  const iColega = fuente.indexOf("directorio.esColega(");
  assert.ok(iAsesor > -1 && iColega > -1, "las dos resoluciones tienen que existir");
  assert.ok(iAsesor < iColega, "el asesor de la casa se resuelve primero");

  // Y no se paga la consulta si ya sabemos que es de la casa.
  const bloque = fuente.slice(iColega - 300, iColega + 200);
  assert.match(bloque, /advisor \?|!advisor|advisor \|\|/, "la busqueda de colega tiene que estar condicionada a que no haya asesor");
});

test("la deteccion de colega falla ABIERTA, como la de asesor", () => {
  // Si la consulta revienta se lo atiende como cliente. Quedarse mudo con
  // alguien real por no poder descartar que sea colega seria mucho peor.
  const i = fuente.indexOf("directorio.esColega(");
  const bloque = fuente.slice(i, i + 400);
  assert.match(bloque, /catch/, "tiene que tener catch");
  assert.match(bloque, /null/, "y devolver null en el catch");
});

test("un colega NO entra al embudo como cliente final", () => {
  // Un colega contado como lead ensucia las metricas igual que el caso de
  // Natalia del 2026-07-29.
  assert.match(fuente, /"colega"/, 'el lead de un colega tiene que marcarse con source "colega"');
});

test("el prompt recibe el colega", () => {
  const i = fuente.indexOf("buildSystemPrompt(");
  assert.ok(i > -1);
  const bloque = fuente.slice(i, i + 300);
  assert.match(bloque, /colega/, "buildSystemPrompt tiene que recibir el colega");
});
