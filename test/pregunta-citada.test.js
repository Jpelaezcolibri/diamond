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
  memory.preguntasAsesor.push({ id: "p1", estado: "pendiente", wamids_aviso: ["wamid.A"] });
  process.env.SOFI_PREGUNTA_ASESOR = "false";
  assert.strictEqual(await pa.preguntaCitada("wamid.A"), null);
});

test("encendido y pendiente: devuelve id y estado", async () => {
  memory.preguntasAsesor.push({ id: "p1", estado: "pendiente", wamids_aviso: ["wamid.A"] });
  const c = await pa.preguntaCitada("wamid.A");
  assert.strictEqual(c.id, "p1");
  assert.strictEqual(c.estado, "pendiente");
});

test("ya respondida o descartada: se devuelve con su estado, nunca null", async () => {
  memory.preguntasAsesor.push({ id: "p1", estado: "respondida", respondida_por: "Claudia", wamids_aviso: ["wamid.A"] });
  memory.preguntasAsesor.push({ id: "p2", estado: "descartada", wamids_aviso: ["wamid.B"] });
  const a = await pa.preguntaCitada("wamid.A");
  assert.deepStrictEqual({ id: a.id, estado: a.estado, por: a.respondida_por }, { id: "p1", estado: "respondida", por: "Claudia" });
  assert.strictEqual((await pa.preguntaCitada("wamid.B")).estado, "descartada");
});

test("cita al PRIMER aviso despues de un reaviso o una rotacion: sigue resolviendo", async () => {
  memory.preguntasAsesor.push({ id: "p1", estado: "pendiente", wamids_aviso: ["wamid.1", "wamid.2", "wamid.3"] });
  assert.strictEqual((await pa.preguntaCitada("wamid.1")).id, "p1");
  assert.strictEqual((await pa.preguntaCitada("wamid.3")).id, "p1");
});

test("wamid desconocido o vacio: null", async () => {
  assert.strictEqual(await pa.preguntaCitada("wamid.X"), null);
  assert.strictEqual(await pa.preguntaCitada(null), null);
});
