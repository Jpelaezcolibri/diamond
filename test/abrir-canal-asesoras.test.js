// Plantilla diaria para abrir la ventana de 24 h de las asesoras (Juan,
// 2026-11-15): Claudia y Catherine no tienen la ventana abierta y sus avisos
// fallaban con 131047.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const canal = require("../src/scheduler/abrir-canal-asesoras");
const boton = require("../src/lib/canal-asesora");

const ORG = { id: "org-1" };
const CLAUDIA = { id: "a-cla", name: "Claudia Valencia", phone: "573000000001" };
const DAIANA = { id: "a-dai", name: "Daiana Zea", phone: "573000000002" };
// Lunes 16-nov-2026 7:10 a. m. Bogotá = 12:10 UTC.
const LUNES_7 = new Date("2026-11-16T12:10:00Z");

function deps(abiertas = []) {
  const enviados = [];
  return {
    enviados,
    d: {
      orgs: async () => [ORG],
      ciclo: async () => [DAIANA, CLAUDIA],
      abierta: async (org, a) => abiertas.includes(a.id),
      enviar: async (org, tel, p) => { enviados.push({ tel, p }); return { ok: true }; },
    },
  };
}

beforeEach(() => { canal._reset(); process.env.CANAL_ASESORAS_PLANTILLA = "abrir_canal_asesora"; delete process.env.CANAL_ASESORAS_HORA; });

test("solo a la asesora con la ventana cerrada, con su nombre de pila y el botón", async () => {
  const { d, enviados } = deps([DAIANA.id]);
  const r = await canal.runOnce({ ahora: LUNES_7, deps: d });
  assert.strictEqual(r.enviadas, 1);
  assert.strictEqual(enviados[0].tel, CLAUDIA.phone);
  assert.deepStrictEqual(enviados[0].p, { name: "abrir_canal_asesora", bodyParams: ["Claudia"], buttonPayloads: [canal.PAYLOAD] });
});

test("una sola vez al día por asesora", async () => {
  const { d, enviados } = deps();
  await canal.runOnce({ ahora: LUNES_7, deps: d });
  await canal.runOnce({ ahora: new Date(LUNES_7.getTime() + 10 * 60000), deps: d });
  assert.strictEqual(enviados.length, 2); // Daiana y Claudia, una vez cada una
});

test("sin la variable, fuera de la hora o en domingo no sale nada", async () => {
  const { d, enviados } = deps();
  delete process.env.CANAL_ASESORAS_PLANTILLA;
  await canal.runOnce({ ahora: LUNES_7, deps: d });
  process.env.CANAL_ASESORAS_PLANTILLA = "abrir_canal_asesora";
  await canal.runOnce({ ahora: new Date("2026-11-16T15:00:00Z"), deps: d }); // 10 a. m.
  await canal.runOnce({ ahora: new Date("2026-11-15T12:10:00Z"), deps: d }); // domingo
  assert.strictEqual(enviados.length, 0);
});

test("el toque en Estoy disponible queda como mensaje de ella y se le contesta", async () => {
  const guardados = [];
  const enviados = [];
  const r = await boton.procesarBotonCanal(ORG, CLAUDIA.phone, {
    lead: async () => ({ id: "lead-cla" }),
    conv: async () => ({ id: "conv-cla" }),
    guardar: async (convId, rol, texto) => { guardados.push([rol, texto]); return { id: "m" }; },
    enviar: async (org, tel, texto) => { enviados.push(texto); return { ok: true, wamid: "w" }; },
  });
  assert.ok(r.ok);
  assert.deepStrictEqual(guardados[0], ["user", "Estoy disponible"]);
  assert.strictEqual(guardados[1][0], "assistant");
  assert.strictEqual(enviados[0], boton.TEXTO_RESPUESTA);
});
