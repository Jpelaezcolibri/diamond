// Reglas de preguntas al asesor en los prompts (spec 2026-10-25 §5.1, §5.4).
const { test, afterEach } = require("node:test");
const assert = require("node:assert");
const { buildSystemPrompt } = require("../src/agent/prompts");

const ORG = { id: "org-1", name: "Diamond" };
const texto = (bloques) => bloques.map((b) => b.text).join("\n");
const cliente = () => texto(buildSystemPrompt({ org: ORG, lead: { id: "l1" }, qualified: false }));
const colega = (extra = {}) => texto(buildSystemPrompt({ org: ORG, lead: { id: "l1" }, colega: { nombre: "Andrea" }, ...extra }));
const asesor = (preguntas) => texto(buildSystemPrompt({ org: ORG, lead: { id: "l1" }, advisor: { name: "Daiana Zea" }, preguntas }));
afterEach(() => { delete process.env.SOFI_PREGUNTA_ASESOR; });

test("apagado: ningún prompt habla de preguntar_al_asesor", () => {
  for (const p of [cliente(), colega(), asesor({ pendientes: [], citada: null })]) assert.doesNotMatch(p, /preguntar_al_asesor|responder_pregunta/);
});

test("encendido: colega y cliente tienen la regla, sin voseo", () => {
  process.env.SOFI_PREGUNTA_ASESOR = "true";
  for (const p of [cliente(), colega()]) {
    assert.match(p, /llama preguntar_al_asesor/);
    assert.match(p, /Le pregunto al asesor y apenas me responda te escribo/);
    assert.match(p, /Nunca prometas una hora/);
  }
});

test("colega con respuesta por entregar: se le avisa a Sofi", () => {
  process.env.SOFI_PREGUNTA_ASESOR = "true";
  assert.match(colega({ respuestaPorEntregar: true }), /RESPUESTA DEL ASESOR LISTA/);
  assert.doesNotMatch(colega(), /RESPUESTA DEL ASESOR LISTA/);
});

test("asesor: lista las pendientes con su id y marca la citada", () => {
  process.env.SOFI_PREGUNTA_ASESOR = "true";
  const p1 = { id: "11111111-aaaa", ref: "10013037", pregunta: "¿Precio final?" };
  const p2 = { id: "22222222-bbbb", ref: null, pregunta: "¿Es unidad cerrada?" };
  const sin = asesor({ pendientes: [p1, p2], citada: null });
  assert.match(sin, /PREGUNTAS PENDIENTES/);
  assert.match(sin, /11111111-aaaa · Ref 10013037 · ¿Precio final\?/);
  assert.match(sin, /responder_pregunta/);
  const con = asesor({ pendientes: [p1, p2], citada: p1 });
  assert.match(con, /EL ASESOR CITÓ LA PREGUNTA 11111111-aaaa/);
});
