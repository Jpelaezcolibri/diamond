// Un .env local no puede pisar las variables que inyecta `railway run`.
//
// EL CASO (2026-09-05). src/config.js abría con
// `require("dotenv").config({ override: true })`. Bajo `railway run` —el
// patrón que usa este repo para probar contra producción sin copiar la
// clave— Railway inyecta las variables reales y ese override las pisaba con
// las del .env local, en silencio.
//
// Lo que costó: una prueba de la API "con la clave de producción" falló por
// saldo insuficiente, se diagnosticó una caída de Sofi que NO estaba pasando,
// y hubo que rastrearlo hasta esa línea. scripts/smoke-cache.js ya esquivaba
// la trampa a mano ("la clave se captura ANTES de requerir nada de src/"),
// prueba de que muerde a cualquiera que no la conozca.
const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const path = require("path");

// Se corre en un proceso aparte a propósito: config.js se cachea al requerirse
// y el orden de carga es justamente lo que se está probando.
function claveQueVeConfig(env) {
  const script =
    'const c = require(' + JSON.stringify(path.join(__dirname, "..", "src", "config.js")) + ');' +
    'process.stdout.write(String(c.anthropicApiKey || ""));';
  return execFileSync(process.execPath, ["-e", script], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

test("bajo railway run mandan las variables inyectadas, no el .env local", () => {
  const clave = claveQueVeConfig({
    RAILWAY_ENVIRONMENT: "production",
    ANTHROPIC_API_KEY: "sk-ant-INYECTADA-POR-RAILWAY",
  });
  assert.strictEqual(clave, "sk-ant-INYECTADA-POR-RAILWAY");
});

test("sin railway, el .env local sigue mandando como siempre", () => {
  // Sin RAILWAY_*, el override vuelve: es el comportamiento de toda la vida
  // para desarrollo local, y no se toca.
  const fs = require("fs");
  const hayEnvLocal = fs.existsSync(path.join(__dirname, "..", ".env"));
  if (!hayEnvLocal) return; // sin .env no hay nada que pisar
  const clave = claveQueVeConfig({
    RAILWAY_ENVIRONMENT: "",
    RAILWAY_SERVICE_ID: "",
    ANTHROPIC_API_KEY: "sk-ant-DEL-AMBIENTE",
  });
  assert.notStrictEqual(clave, "sk-ant-DEL-AMBIENTE", "el .env local dejó de tener prioridad en local");
});
