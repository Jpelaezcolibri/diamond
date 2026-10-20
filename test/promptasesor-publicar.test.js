const { test, afterEach } = require("node:test");
const assert = require("node:assert");
const { buildSystemPrompt } = require("../src/agent/prompts");

const ORG = { id: "org-1", name: "Diamond Inmobiliaria" };
const ADVISOR = { name: "Daiana Zea" };
const texto = () => buildSystemPrompt({ org: ORG, advisor: ADVISOR, now: null }).map((b) => b.text).join("\n");
const previo = process.env.SOFI_PUBLICA_ASESOR;
afterEach(() => { if (previo === undefined) delete process.env.SOFI_PUBLICA_ASESOR; else process.env.SOFI_PUBLICA_ASESOR = previo; });

test("encendido: explica el flujo de publicar", () => {
  process.env.SOFI_PUBLICA_ASESOR = "true";
  const t = texto();
  assert.match(t, /CUANDO QUIERE PUBLICAR UNA PROPIEDAD/);
  assert.match(t, /preparar_publicacion/);
  assert.match(t, /confirmar_publicacion/);
  assert.match(t, /actualizar_vigencia/);
  assert.match(t, /sí explícito/);
});

test("apagado: no ofrece publicar", () => {
  process.env.SOFI_PUBLICA_ASESOR = "false";
  assert.doesNotMatch(texto(), /preparar_publicacion/);
});

test("sigue sin publicar respuestas a pedidos del radar en grupos", () => {
  process.env.SOFI_PUBLICA_ASESOR = "true";
  assert.match(texto(), /pedidos? del radar/i);
  assert.match(texto(), /confirmar_cita/);
});
