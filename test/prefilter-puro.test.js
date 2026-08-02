// El prefiltro tiene que poder correr DENTRO del navegador del asesor.
//
// La extensión de Chrome lo empaqueta y lo ejecuta en el content script: ahí no
// hay `process.env`, ni Supabase, ni sistema de archivos. Si alguien agrega un
// `require` sucio a cualquier archivo de la cadena, nada falla en el servidor —
// falla el build de la extensión, o peor, se descubre en el navegador de una
// persona.
//
// Este test recorre el cierre de dependencias completo y lo dice antes.
//
// Es también lo que hace que el desacople de `src/lib/zonas.js` permanezca
// hecho: sin él, el próximo `require("../data/properties")` se cuela y nadie se
// entera hasta que el prefiltro local empiece a discrepar del servidor.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");
const ENTRADA = path.join(RAIZ, "src/groups/prefilter.js");
const ENTRADA_EPE = path.join(RAIZ, "epe/core/index.js");

// Lo que NO puede aparecer en la cadena, y por qué.
const PROHIBIDOS = [
  { patron: /require\(["']node:/, motivo: "módulo de Node — no existe en el navegador" },
  { patron: /require\(["']@supabase/, motivo: "cliente de Supabase" },
  { patron: /require\(["'].*\/supabase["']\)/, motivo: "cliente de Supabase" },
  { patron: /require\(["'].*\/config["']\)/, motivo: "config con process.env" },
  { patron: /require\(["'](fs|path|crypto|os|http|https)["']\)/, motivo: "módulo de Node sin prefijo" },
  { patron: /process\.env/, motivo: "variable de entorno" },
  { patron: /\bchrome\./, motivo: "API de extensión — el núcleo no conoce a su host" },
  { patron: /\bdocument\./, motivo: "DOM — el núcleo no lee la pantalla, recibe mensajes ya extraídos" },
  { patron: /\bfetch\(/, motivo: "red — el núcleo nunca habla con nadie" },
];

// Sigue los require relativos desde un archivo y devuelve todo lo alcanzable.
function cierreDeDependencias(entrada) {
  const vistos = new Set();
  const pendientes = [entrada];

  while (pendientes.length > 0) {
    const archivo = pendientes.pop();
    if (vistos.has(archivo)) continue;
    vistos.add(archivo);

    const fuente = fs.readFileSync(archivo, "utf8");
    for (const m of fuente.matchAll(/require\(["'](\.[^"']+)["']\)/g)) {
      let destino = path.resolve(path.dirname(archivo), m[1]);
      if (!destino.endsWith(".js")) destino += ".js";
      if (fs.existsSync(destino)) pendientes.push(destino);
    }
  }
  return [...vistos];
}

test("el prefiltro y todo lo que arrastra son puros — corren en un navegador", () => {
  const cadena = cierreDeDependencias(ENTRADA);
  const problemas = [];

  for (const archivo of cadena) {
    const fuente = fs.readFileSync(archivo, "utf8");
    // Las líneas de comentario no cuentan: este mismo archivo nombra las cosas
    // prohibidas para explicarlas.
    const codigo = fuente
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");

    for (const { patron, motivo } of PROHIBIDOS) {
      if (patron.test(codigo)) {
        problemas.push(`${path.relative(RAIZ, archivo)} → ${motivo}`);
      }
    }
  }

  assert.deepStrictEqual(
    problemas,
    [],
    `El prefiltro dejó de ser portable al navegador:\n  ${problemas.join("\n  ")}\n` +
    `Cadena revisada: ${cadena.map((a) => path.relative(RAIZ, a)).join(", ")}`
  );
});

test("la cadena es la esperada — si crece, es una decisión, no un accidente", () => {
  const cadena = cierreDeDependencias(ENTRADA)
    .map((a) => path.relative(RAIZ, a).replace(/\\/g, "/"))
    .sort();

  assert.deepStrictEqual(cadena, [
    "src/groups/lexico.js",
    "src/groups/prefilter.js",
    "src/groups/texto.js",
    "src/lib/zonas.js",
  ]);
});

test("TODO el núcleo del EPE es puro — es lo que permite que corra en el navegador", () => {
  // La cadena completa desde la entrada pública, no solo el prefiltro. Es el
  // criterio de aceptación del Sprint 1: si esto falla, el EPE no puede
  // empaquetarse y el ~85% de descarte local deja de existir.
  const cadena = cierreDeDependencias(ENTRADA_EPE);
  const problemas = [];

  for (const archivo of cadena) {
    const codigo = fs.readFileSync(archivo, "utf8")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");

    for (const { patron, motivo } of PROHIBIDOS) {
      if (patron.test(codigo)) problemas.push(`${path.relative(RAIZ, archivo)} → ${motivo}`);
    }
  }

  assert.deepStrictEqual(problemas, [], `El núcleo del EPE dejó de ser portable:\n  ${problemas.join("\n  ")}`);
});

test("la cadena del EPE es la esperada — si crece, es una decisión", () => {
  const cadena = cierreDeDependencias(ENTRADA_EPE)
    .map((a) => path.relative(RAIZ, a).replace(/\\/g, "/"))
    .sort();

  assert.deepStrictEqual(cadena, [
    "epe/core/hash.js",
    "epe/core/index.js",
    "src/groups/lexico.js",
    "src/groups/prefilter.js",
    "src/groups/texto.js",
    "src/lib/zonas.js",
  ]);
});

test("zonaTokens sigue re-exportado desde properties — match.js lo usa como namespace", () => {
  // `src/groups/match.js` hace `properties.zonaTokens(...)`. Si alguien limpia
  // el re-export "porque ahora vive en lib/zonas", no falla al cargar: falla al
  // primer cruce real, en producción. Un TypeError diferido.
  const properties = require("../src/data/properties");
  const zonas = require("../src/lib/zonas");

  assert.strictEqual(typeof properties.zonaTokens, "function");
  assert.strictEqual(typeof properties.distinctiveTokens, "function");
  assert.strictEqual(properties.zonaTokens, zonas.zonaTokens, "tiene que ser la MISMA función, no una copia");
  assert.strictEqual(properties.distinctiveTokens, zonas.distinctiveTokens);
});
