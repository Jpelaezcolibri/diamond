// Juan (2026-11-11): "hay lugares donde no se puede poner dirección o lugares
// o datos específicos, para esto necesito que Sofi le copie inmediatamente a
// Claudia la pregunta por la inquietud y que Sofi misma le responda al colega".
const { test, afterEach } = require("node:test");
const assert = require("node:assert");
const pa = require("../src/lib/pregunta-asesor");
const { buildSystemPrompt } = require("../src/agent/prompts");

const DAIANA = { id: "a1", name: "Daiana Zea", alias_publico: "Asesor 1", phone: "573011880668", activo: true };
const CLAUDIA = { id: "a2", name: "Claudia Valencia", alias_publico: "Asesor 2", phone: "573003418113", activo: true };
const CATHERINE = { id: "a3", name: "Catherine Uribe", alias_publico: "Asesor 3", phone: "573028536489", activo: true };
const CICLO = [DAIANA, CLAUDIA, CATHERINE];

afterEach(() => { delete process.env.PREGUNTAS_ASESORA; delete process.env.SOFI_PREGUNTA_ASESOR; });

test("con PREGUNTAS_ASESORA=Claudia la pregunta va primero a Claudia; sin ella, como antes", () => {
  process.env.PREGUNTAS_ASESORA = "Claudia";
  assert.strictEqual(pa.asesoraDePreguntas(CICLO), CLAUDIA);
  process.env.PREGUNTAS_ASESORA = "asesor 2";
  assert.strictEqual(pa.asesoraDePreguntas(CICLO), CLAUDIA, "también por el alias interno");
  process.env.PREGUNTAS_ASESORA = "Nadie";
  assert.strictEqual(pa.asesoraDePreguntas(CICLO), DAIANA, "si no la encuentra, la primera del ciclo");
  delete process.env.PREGUNTAS_ASESORA;
  assert.strictEqual(pa.asesoraDePreguntas(CICLO), DAIANA);
});

test("registrar le copia la pregunta a Claudia de inmediato, con quién pregunta", async () => {
  process.env.PREGUNTAS_ASESORA = "Claudia";
  const enviados = [];
  const creadas = [];
  const deps = {
    ciclo: async () => CICLO,
    datos: {
      crear: async (f) => { creadas.push(f); return { nueva: true, pregunta: { id: "p1-abcdefgh", ref: f.ref, pregunta: f.pregunta, estado: "pendiente" } }; },
      agregarWamid: async () => {},
    },
    actualizarLead: async () => {},
    mensaje: async (_o, tel, texto) => { enviados.push({ tel, texto }); return { ok: true, wamid: "w1" }; },
    avisarAsesor: async () => ({ ok: true }),
  };
  const ctx = { org: { id: "org-1" }, lead: { id: "l1", nombre: "NORHA VELEZ M", phone: "CO.1", source: "colega" } };
  const out = await pa.registrar({ ctx, input: { pregunta: "¿En qué parte de María Auxiliadora queda?", ref: "10505674", tipo: "otro" }, deps });
  assert.strictEqual(creadas[0].asesorId, "a2");
  assert.strictEqual(enviados[0].tel, CLAUDIA.phone);
  assert.match(enviados[0].texto, /NORHA VELEZ M/);
  assert.match(enviados[0].texto, /Ref 10505674/);
  assert.match(enviados[0].texto, /En qué parte de María Auxiliadora queda/);
  assert.match(out, /Pregunta registrada/);
});

test("el prompt manda a preguntar ubicación, dirección y datos sensibles en vez de darlos", () => {
  process.env.SOFI_PREGUNTA_ASESOR = "true";
  const texto = buildSystemPrompt({
    org: { id: "o", name: "Diamond" }, lead: { id: "l", phone: "573000000000" }, qualified: false,
    now: { legible: "martes", iso: "2026-11-11T10:00:00-05:00" }, colega: { nombre: "Ana" },
  }).map((b) => b.text).join("\n");
  assert.match(texto, /dirección|ubicación exacta/i);
  assert.match(texto, /aunque aparezcan? en la descripción/i);
  assert.match(texto, /de inmediato/i);
});
