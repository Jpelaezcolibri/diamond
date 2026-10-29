// Tick de la escalera de preguntas (spec 2026-10-25 §5.3).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const datos = require("../src/data/preguntas-asesor");
const sched = require("../src/scheduler/preguntas-escalera");

const A1 = { id: "a1", name: "Daiana", phone: "1" };
const A2 = { id: "a2", name: "Claudia", phone: "2" };
let log;
const deps = (over = {}) => ({
  datos,
  org: async () => ({ id: "org-1", name: "Diamond" }),
  ciclo: async () => [A1, A2],
  lead: async () => ({ id: "l1", phone: "57300", nombre: "Andrea", source: "colega" }),
  avisar: async ({ advisor, reaviso, sinTexto }) => { log.push({ avisar: advisor.id, reaviso: Boolean(reaviso), ...(sinTexto ? { sinTexto: true } : {}) }); return { ok: true }; },
  ventanaAbierta: async () => true,
  notificar: async (n) => { log.push({ nota: n.advisor.id, titulo: n.titulo }); return { ok: true }; },
  ...over,
});

beforeEach(() => { log = []; memory.preguntasAsesor.length = 0; });

const crear = async (over = {}) => {
  const { pregunta } = await datos.crear({ orgId: "org-1", leadId: "l1", ref: "1", tipo: "precio", pregunta: "¿precio?", asesorId: "a1" });
  Object.assign(pregunta, { asignada_at: "2026-10-08T14:00:00Z", ...over });
  return pregunta;
};

test("a la hora rota, avisa al nuevo y le cuenta al anterior por la campana", async () => {
  const p = await crear();
  const r = await sched.runOnce({ ahora: new Date("2026-10-08T15:00:00Z"), deps: deps() });
  assert.strictEqual(r.rotadas, 1);
  assert.strictEqual(p.asesor_id, "a2");
  assert.strictEqual(p.asignada_at, "2026-10-08T15:00:00.000Z");
  assert.strictEqual(p.reaviso_at, null);
  assert.deepStrictEqual(log.find((x) => x.avisar), { avisar: "a2", reaviso: false });
  assert.ok(log.some((x) => x.nota === "a1" && /pasó a Claudia/.test(x.titulo)));
});

test("a los 15 min repite el aviso al mismo asesor y marca reaviso_at", async () => {
  const p = await crear();
  const r = await sched.runOnce({ ahora: new Date("2026-10-08T14:20:00Z"), deps: deps() });
  assert.strictEqual(r.reavisadas, 1);
  assert.deepStrictEqual(log, [{ avisar: "a1", reaviso: true }]);
  assert.strictEqual(p.reaviso_at, "2026-10-08T14:20:00.000Z");
});

test("una sin asesor se asigna al primero", async () => {
  const p = await crear({ asesor_id: null });
  const r = await sched.runOnce({ ahora: new Date("2026-10-08T14:01:00Z"), deps: deps() });
  assert.strictEqual(r.asignadas, 1);
  assert.strictEqual(p.asesor_id, "a1");
});

test("rotar a sí mismo (ciclo de uno) no le manda la nota de reasignación", async () => {
  await crear();
  await sched.runOnce({ ahora: new Date("2026-10-08T15:00:00Z"), deps: deps({ ciclo: async () => [A1] }) });
  assert.ok(log.some((x) => x.avisar === "a1"));
  assert.ok(!log.some((x) => x.nota));
});

test("de noche no hace nada", async () => {
  await crear();
  const r = await sched.runOnce({ ahora: new Date("2026-10-09T03:00:00Z"), deps: deps() });
  assert.deepStrictEqual(r, { asignadas: 0, rotadas: 0, reavisadas: 0, agotadas: 0 });
});

test("M3: si el asesor responde a mitad del tick, no se rota ni se reavisa", async () => {
  const p = await crear();
  const racing = {
    ...datos,
    pendientes: async () => {
      const foto = (await datos.pendientes()).map((f) => ({ ...f }));
      await datos.marcarRespondida(p.id, { respuesta: "450", por: "Claudia", via: "crm" });
      return foto;
    },
  };
  const r = await sched.runOnce({ ahora: new Date("2026-10-08T15:00:00Z"), deps: deps({ datos: racing }) });
  assert.strictEqual(r.rotadas, 0);
  assert.deepStrictEqual(log, [], "no se avisa a nadie ni se notifica");
  assert.strictEqual(p.asesor_id, "a1");
  assert.strictEqual(p.estado, "respondida");
});

test("M3 + I2: rotar conserva los wamids de aviso", async () => {
  const p = await crear({ wamids_aviso: ["wamid.1"] });
  await sched.runOnce({ ahora: new Date("2026-10-08T15:00:00Z"), deps: deps() });
  assert.deepStrictEqual(p.wamids_aviso, ["wamid.1"]);
  assert.strictEqual(p.asesor_id, "a2");
});

test("el ultimo aviso del tope avisa por la campana a todo el ciclo y despues calla", async () => {
  const p = await crear({ wamids_aviso: ["w1", "w2", "w3", "w4", "w5"] });
  const r = await sched.runOnce({ ahora: new Date("2026-10-08T15:00:00Z"), deps: deps() });
  assert.strictEqual(r.agotadas, 1);
  const notas = log.filter((x) => x.nota && /no se va a repetir/.test(x.titulo)).map((x) => x.nota);
  assert.deepStrictEqual(notas.sort(), ["a1", "a2"]);
  p.wamids_aviso.push("w6");
  log = [];
  const r2 = await sched.runOnce({ ahora: new Date("2026-10-08T17:00:00Z"), deps: deps() });
  assert.deepStrictEqual([r2.rotadas, r2.reavisadas, log.length], [0, 0, 0]);
});

// Caso 2026-10-29: 2 de cada 3 avisos fallaban por la ventana cerrada.
test("rota solo entre las asesoras con la ventana abierta", async () => {
  await crear();
  const r = await sched.runOnce({ ahora: new Date("2026-10-08T15:00:00Z"), deps: deps({ ventanaAbierta: async (_o, a) => a.id === "a1" }) });
  // a2 tiene la ventana cerrada: la hora vuelve a caer en a1, la unica abierta.
  assert.strictEqual(r.rotadas, 1);
  assert.deepStrictEqual(log.filter((x) => x.avisar), [{ avisar: "a1", reaviso: false }]);
});

test("si nadie tiene la ventana abierta, avisa sin texto libre", async () => {
  await crear();
  await sched.runOnce({ ahora: new Date("2026-10-08T15:00:00Z"), deps: deps({ ventanaAbierta: async () => false }) });
  assert.deepStrictEqual(log.filter((x) => x.avisar), [{ avisar: "a2", reaviso: false, sinTexto: true }]);
});

test("los avisos que WhatsApp rechazó no cuentan para el tope", async () => {
  await crear({ wamids_aviso: ["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8"] });
  const r = await sched.runOnce({ ahora: new Date("2026-10-08T15:00:00Z"), deps: deps({ datos: { ...datos, avisosFallidos: async () => 5 } }) });
  assert.strictEqual(r.rotadas, 1);
  assert.strictEqual(r.agotadas, 0);
});
