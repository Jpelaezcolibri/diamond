// Juan (2026-11-11): "internamente ponemos asesor 1, asesor 2, asesor 3, pero
// para el cliente o el colega son Claudia, Catherine y Daiana; damos el nombre
// cuando tengamos claro que una de ellas será quien lo llame, de resto decimos
// que un asesor se contactará". Reemplaza la regla del 2026-11-09.
const { test } = require("node:test");
const assert = require("node:assert");
const ip = require("../src/lib/identidad-publica");
const { buildSystemPrompt } = require("../src/agent/prompts");

const CATHERINE = { id: "a3", name: "Catherine Uribe", alias_publico: "Asesor 3", phone: "573028536489" };
const DAIANA_2 = { id: "a1b", name: "Daiana Zea (línea 2)", alias_publico: "Asesor 1" };
const ORG = { id: "o", name: "Diamond" };

test("con asesora conocida, su nombre de pila; sin asesora, 'un asesor de nuestro equipo'", () => {
  assert.strictEqual(ip.asesorPublico(CATHERINE), "Catherine");
  assert.strictEqual(ip.asesorPublico(DAIANA_2), "Daiana");
  assert.strictEqual(ip.asesorPublico(), "un asesor de nuestro equipo");
  assert.strictEqual(ip.asesorPublico({ name: "" }), "un asesor de nuestro equipo");
});

test("la confirmación de la visita dice quién la recibe, sin 'Asesor N' ni celular", () => {
  const t = ip.textoCitaConfirmada({ cuando: "del martes 10 de noviembre a las 10:00 a. m.", ref: "10505674", advisor: CATHERINE });
  assert.strictEqual(t, "Tu visita del martes 10 de noviembre a las 10:00 a. m. a la ref 10505674 quedó CONFIRMADA. Te recibe Catherine.");
  assert.doesNotMatch(t, /Asesor \d|573028536489|Uribe/);
});

test("la transferencia nombra a quien lo va a contactar", () => {
  const t = ip.instruccionTransferencia({ especialidad: "venta", advisor: CATHERINE, org: ORG });
  assert.match(t, /Catherine lo va a contactar/);
  assert.doesNotMatch(t, /Asesor \d|573028536489/);
});

test("el prompt: nombre solo cuando se sabe quién llama; la visita confirmada dice quién la recibe", () => {
  const texto = buildSystemPrompt({
    org: ORG, lead: { id: "l", phone: "573000000000", cita: { tipo: "visita", ref: "10505674", estado: "confirmada", fecha_hora: "2026-11-12T10:00:00-05:00", confirmada_por: "Catherine Uribe" } }, qualified: false,
    now: { legible: "martes", iso: "2026-11-11T10:00:00-05:00" }, colega: { nombre: "Ana" },
  }).map((b) => b.text).join("\n");
  assert.match(texto, /lo recibe Catherine/);
  assert.match(texto, /Claudia, Catherine o Daiana|nombre de pila/i);
  assert.doesNotMatch(texto, /Asesor\s*\d/);
});

test("una visita confirmada por el colega en la línea no inventa un nombre", () => {
  const texto = buildSystemPrompt({
    org: ORG, lead: { id: "l", phone: "573000000000", cita: { tipo: "visita", ref: "1", estado: "confirmada", fecha_hora: "2026-11-12T10:00:00-05:00", confirmada_por: "colega, en la linea" } }, qualified: false,
    now: { legible: "martes", iso: "2026-11-11T10:00:00-05:00" }, colega: { nombre: "Ana" },
  }).map((b) => b.text).join("\n");
  assert.match(texto, /lo recibe un asesor de nuestro equipo/);
});
