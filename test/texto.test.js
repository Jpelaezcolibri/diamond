// `plano()` es la base de todo el prefiltro: el léxico, los marcadores y las
// zonas se comparan contra esta forma.
//
// El rango de diacríticos estaba escrito con los caracteres combinantes
// LITERALES en el fuente. Son invisibles en el editor y se pierden en cualquier
// conversión de encoding o en un bundler — que es exactamente lo que la
// extensión de Chrome va a hacer con este archivo.
//
// Cuando eso pasa, nada explota: `plano()` sigue devolviendo texto en
// minúsculas, solo deja de quitar los acentos. El prefiltro sigue corriendo y
// silenciosamente deja de reconocer "Belén", "Robledo Aures" o "Itagüí". Un
// falso negativo invisible, que es el fallo más caro del sistema según el
// propio encabezado de prefilter.js.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { plano } = require("../src/groups/texto");

test("plano quita acentos y baja a minúsculas", () => {
  assert.strictEqual(plano("Belén Envigado"), "belen envigado");
  assert.strictEqual(plano("Itagüí"), "itagui");
  assert.strictEqual(plano("BOGOTÁ"), "bogota");
  assert.strictEqual(plano("Medellín, Antioquia"), "medellin, antioquia");
});

test("plano tolera null, undefined y números sin reventar", () => {
  assert.strictEqual(plano(null), "");
  assert.strictEqual(plano(undefined), "");
  assert.strictEqual(plano(123), "123");
});

test("la ñ también se normaliza a n — NFD la descompone", () => {
  // No es un descuido: el léxico está escrito sin ñ ni acentos ("itagui",
  // "belen"), así que `plano()` tiene que normalizar igual para que un mensaje
  // con "Cañasgordas" matchee la entrada "canasgordas".
  assert.strictEqual(plano("Cañasgordas"), "canasgordas");
  assert.strictEqual(plano("Itagüí"), "itagui");
});

test("EL INVARIANTE: el léxico está normalizado igual que plano()", () => {
  // Este es el test que importa de verdad. El día que alguien agregue "Belén"
  // con tilde al léxico, ese término deja de matchear PARA SIEMPRE y en
  // silencio: `plano()` convierte el mensaje a "belen" y nunca encuentra
  // "belén". Nada falla, solo se pierden oportunidades que nadie ve.
  const lexico = require("../src/groups/lexico");
  const sinNormalizar = lexico.TODAS.filter((t) => plano(t) !== t);

  assert.deepStrictEqual(
    sinNormalizar,
    [],
    `Estos términos del léxico tienen acentos o mayúsculas y nunca van a ` +
    `matchear: ${sinNormalizar.join(", ")}. Escribilos como los devuelve plano().`
  );
});

test("el rango de diacríticos está escrito con escapes, no con invisibles", () => {
  // Este es el test que protege el arreglo. Un carácter combinante literal en
  // el fuente sobrevive en Node pero no un viaje por un bundler o un editor con
  // otra normalización.
  const fuente = fs.readFileSync(path.join(__dirname, "../src/groups/texto.js"), "utf8");
  const linea = fuente.split("\n").find((l) => l.includes("const DIACRITICOS"));

  assert.ok(linea, "no se encontró la definición de DIACRITICOS");
  assert.match(linea, /\\u0300/, "el rango tiene que usar escapes \\uXXXX");
  assert.strictEqual(
    [...linea].filter((c) => c.codePointAt(0) > 126).length,
    0,
    `la línea tiene caracteres no-ASCII invisibles: ${JSON.stringify(linea)}`
  );
});
