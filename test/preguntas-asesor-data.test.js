// Modulo de datos de preguntas_asesor (spec 2026-10-25), en modo memoria.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const datos = require("../src/data/preguntas-asesor");

beforeEach(() => { memory.preguntasAsesor.length = 0; });

const base = { orgId: "org-1", leadId: "l1", ref: "10013037", tipo: "precio", pregunta: "¿Precio final de la ref 10013037?", asesorId: "a1" };

test("crea una pregunta pendiente con su asesor", async () => {
  const { pregunta, nueva } = await datos.crear(base);
  assert.strictEqual(nueva, true);
  assert.strictEqual(pregunta.estado, "pendiente");
  assert.strictEqual(pregunta.asesor_id, "a1");
  assert.ok(pregunta.asignada_at);
});

test("no duplica la misma ref y tipo abierta en el mismo lead", async () => {
  const a = await datos.crear(base);
  const b = await datos.crear({ ...base, pregunta: "otra forma de decirlo" });
  assert.strictEqual(b.nueva, false);
  assert.strictEqual(b.pregunta.id, a.pregunta.id);
  const c = await datos.crear({ ...base, ref: "9944723" });
  assert.strictEqual(c.nueva, true);
});

test("marcarRespondida solo cierra una pendiente, y una sola vez", async () => {
  const { pregunta } = await datos.crear(base);
  const r1 = await datos.marcarRespondida(pregunta.id, { respuesta: "450 final", por: "Daiana", via: "crm" });
  assert.strictEqual(r1.estado, "respondida");
  assert.strictEqual(r1.respuesta, "450 final");
  const r2 = await datos.marcarRespondida(pregunta.id, { respuesta: "otra", por: "Claudia", via: "whatsapp" });
  assert.strictEqual(r2, null);
});

test("porWamid, abiertasDeLead y porEntregarDe", async () => {
  const { pregunta } = await datos.crear(base);
  await datos.actualizar(pregunta.id, { wamid_aviso: "wamid.X" });
  assert.strictEqual((await datos.porWamid("wamid.X")).id, pregunta.id);
  assert.strictEqual(await datos.abiertasDeLead("l1"), 1);
  await datos.marcarRespondida(pregunta.id, { respuesta: "450", por: "Daiana", via: "crm" });
  await datos.actualizar(pregunta.id, { entrega_error: "esperando_ventana" });
  assert.strictEqual(await datos.abiertasDeLead("l1"), 0);
  assert.strictEqual((await datos.porEntregarDe("l1")).length, 1);
});

test("esTablaAusente reconoce el error de Postgres y el de PostgREST", () => {
  assert.strictEqual(datos.esTablaAusente({ code: "42P01" }), true);
  assert.strictEqual(datos.esTablaAusente({ code: "PGRST205", message: "Could not find the table" }), true);
  assert.strictEqual(datos.esTablaAusente({ code: "23505" }), false);
});
