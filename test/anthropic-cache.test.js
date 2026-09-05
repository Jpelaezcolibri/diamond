// El prompt caching es la mitad de la factura de la API, y es invisible: si
// el marcador se cae o el TTL vuelve a 5 minutos, nada falla — solo se paga
// de mas, en silencio, hasta que alguien mire la consola de Anthropic. Estos
// tests son el unico lugar donde ese ahorro esta afirmado.
const test = require("node:test");
const assert = require("node:assert");

const { CACHE_ESTABLE } = require("../src/lib/anthropic");
const { buildSystemPrompt } = require("../src/agent/prompts");
const { buildCommandSystemPrompt } = require("../src/agent/sofi-comando-prompts");
const revalidar = require("../src/groups/revalidar");

const org = { id: "org-1", name: "Diamond Inmobiliaria" };
const lead = { id: "lead-1", nombre: "Ana", telefono: "573001112233" };
const now = { legible: "jueves 4 de septiembre de 2026, 3:00 p. m.", iso: "2026-09-04T20:00:00Z" };

test("el TTL por defecto es de 1 hora, no los 5 minutos del SDK", () => {
  assert.deepStrictEqual(CACHE_ESTABLE, { type: "ephemeral", ttl: "1h" });
});

test("CACHE_ESTABLE esta congelado: nadie puede mutarlo desde otro modulo", () => {
  assert.throws(() => {
    "use strict";
    CACHE_ESTABLE.ttl = "5m";
  }, TypeError);
});

// Los tres roles comparten el bloque estable pero lo arman en funciones
// distintas (promptCliente, promptAsesor, promptColega). Un rol nuevo que se
// olvide el marcador paga el prefijo entero en cada mensaje.
const roles = [
  ["cliente", { org, lead, qualified: false, now }],
  ["asesor", { org, lead, qualified: false, now, advisor: { name: "Natalia Perez" } }],
  ["colega", { org, lead, qualified: false, now, colega: { nombre: "Miguel Longas" } }],
];

for (const [rol, args] of roles) {
  test(`el prompt de ${rol} cachea su bloque estable con el TTL compartido`, () => {
    const bloques = buildSystemPrompt(args);
    assert.ok(Array.isArray(bloques), "el prompt tiene que venir en bloques para poder cachearse");
    assert.deepStrictEqual(bloques[0].cache_control, CACHE_ESTABLE);
  });

  test(`el prompt de ${rol} deja lo volatil FUERA del bloque cacheado`, () => {
    const bloques = buildSystemPrompt(args);
    // La fecha cambia cada dia: si cayera dentro del bloque marcado, el cache
    // se invalidaria entero cada vez y el marcador seria peor que no ponerlo.
    assert.ok(!bloques[0].text.includes(now.legible), "la fecha no puede vivir en el bloque estable");
    assert.ok(
      bloques.slice(1).some((b) => b.text.includes(now.legible)),
      "la fecha tiene que ir en un bloque posterior al marcador"
    );
    assert.ok(bloques.slice(1).every((b) => !b.cache_control), "despues del marcador no va otro cache_control");
  });
}

test("el Centro de Comando cachea su bloque estable y deja la fecha afuera", () => {
  const bloques = buildCommandSystemPrompt({ scope: { isAdmin: true }, userName: "Juan", now });
  assert.deepStrictEqual(bloques[0].cache_control, CACHE_ESTABLE);
  assert.ok(!bloques[0].text.includes(now.legible));
  assert.ok(bloques.slice(1).some((b) => b.text.includes(now.legible)));
});

test("el prompt de revalidar supera el minimo cacheable de Sonnet", () => {
  // Por debajo de 1.024 tokens la API ignora el marcador SIN avisar. La
  // estimacion es conservadora (~3,6 chars por token en español).
  const tokens = revalidar.SISTEMA.length / 3.6;
  assert.ok(tokens > 1024, `SISTEMA de revalidar quedo en ~${Math.round(tokens)} tokens: el cache no se aplicaria`);
});

// ── El medidor ────────────────────────────────────────────────────────────
//
// Es lo unico que va a decir si el cache pega en produccion. Si se rompe,
// volvemos a estar ciegos.
const { registrarUso } = require("../src/lib/anthropic");

function capturando(fn) {
  const original = console.log;
  const lineas = [];
  console.log = (...args) => lineas.push(args.join(" "));
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lineas;
}

test("el medidor reporta el porcentaje leido del cache", () => {
  const lineas = capturando(() =>
    registrarUso("engine", {
      cache_read_input_tokens: 9000,
      cache_creation_input_tokens: 0,
      input_tokens: 1000,
      output_tokens: 250,
    })
  );
  assert.strictEqual(lineas.length, 1);
  assert.match(lineas[0], /\[uso\] engine/);
  assert.match(lineas[0], /entrada=10000/);
  assert.match(lineas[0], /cache_read=9000 \(90%\)/);
});

test("el medidor nunca tumba una respuesta al cliente", () => {
  // Un usage ausente, vacio o con basura no puede lanzar: esto corre en el
  // camino de una respuesta real de WhatsApp.
  for (const basura of [null, undefined, {}, { input_tokens: "no soy un numero" }, 42]) {
    assert.doesNotThrow(() => registrarUso("engine", basura));
  }
});

test("el medidor no registra contenido, solo cuentas", () => {
  const lineas = capturando(() =>
    registrarUso("engine", { input_tokens: 100, output_tokens: 5, texto: "dato privado del cliente" })
  );
  assert.ok(!lineas.join("").includes("dato privado"), "el log no puede llevar contenido");
});
