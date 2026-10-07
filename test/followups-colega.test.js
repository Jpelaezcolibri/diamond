// El seguimiento de Sofi a un COLEGA (Juan, 2026-10-07): a las 3 h y en tono
// de colega (le pregunta si alguna opcion le sirvio a su cliente), no el
// mensaje de cliente a los 60 min.
const { test } = require("node:test");
const assert = require("node:assert");
const { buildFollowupSystemPrompt, colegaListoParaSeguimiento } = require("../src/scheduler/followups");

const ORG = { name: "Diamond" };
const AHORA = new Date("2026-10-08T15:00:00Z");
const hace = (min) => ({ role: "assistant", created_at: new Date(AHORA.getTime() - min * 60000).toISOString() });

test("el prompt de seguimiento de un colega es de colega", () => {
  const p = buildFollowupSystemPrompt(ORG, { source: "colega" });
  assert.match(p, /Es un COLEGA de otra inmobiliaria/);
  assert.match(p, /similares o agendar visita/);
  assert.doesNotMatch(buildFollowupSystemPrompt(ORG, { source: "whatsapp" }), /COLEGA/);
});

test("al colega se le escribe a las 3 h, no antes", () => {
  assert.strictEqual(colegaListoParaSeguimiento({ source: "colega" }, hace(90), AHORA), false);
  assert.strictEqual(colegaListoParaSeguimiento({ source: "colega" }, hace(200), AHORA), true);
});

test("un cliente no cambia: lo decide el worker como siempre", () => {
  assert.strictEqual(colegaListoParaSeguimiento({ source: "whatsapp" }, hace(61), AHORA), true);
});

test("con SOFI_SEGUIMIENTO_COLEGA=false los colegas se saltan", () => {
  const antes = process.env.SOFI_SEGUIMIENTO_COLEGA;
  process.env.SOFI_SEGUIMIENTO_COLEGA = "false";
  try {
    assert.strictEqual(colegaListoParaSeguimiento({ source: "colega" }, hace(500), AHORA), false);
  } finally {
    if (antes === undefined) delete process.env.SOFI_SEGUIMIENTO_COLEGA;
    else process.env.SOFI_SEGUIMIENTO_COLEGA = antes;
  }
});
