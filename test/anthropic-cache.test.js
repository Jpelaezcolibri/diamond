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
