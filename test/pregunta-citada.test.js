// La respuesta citada al aviso se reconoce (spec 2026-10-25 §5.5).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const pa = require("../src/lib/pregunta-asesor");

beforeEach(() => {
  memory.preguntasAsesor.length = 0;
  process.env.SOFI_PREGUNTA_ASESOR = "true";
});

test("interruptor apagado: null aunque exista el wamid", async () => {
  memory.preguntasAsesor.push({ id: "p1", estado: "pendiente", wamid_aviso: "wamid.A" });
  process.env.SOFI_PREGUNTA_ASESOR = "false";
  assert.strictEqual(await pa.preguntaCitada("wamid.A"), null);
});

test("encendido y pendiente: devuelve el id", async () => {
  memory.preguntasAsesor.push({ id: "p1", estado: "pendiente", wamid_aviso: "wamid.A" });
  assert.strictEqual(await pa.preguntaCitada("wamid.A"), "p1");
});

test("ya respondida: null", async () => {
  memory.preguntasAsesor.push({ id: "p1", estado: "respondida", wamid_aviso: "wamid.A" });
  assert.strictEqual(await pa.preguntaCitada("wamid.A"), null);
});

test("wamid desconocido o vacio: null", async () => {
  assert.strictEqual(await pa.preguntaCitada("wamid.X"), null);
  assert.strictEqual(await pa.preguntaCitada(null), null);
});
