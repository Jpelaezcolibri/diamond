const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const sched = require("../src/scheduler/excel-pendientes");

const A1 = { id: "a1", name: "Daiana", phone: "573011880668" };
const A2 = { id: "a2", name: "Claudia", phone: "573003418113" };
const VIE_8AM = new Date("2026-10-30T13:05:00Z");
let log, filas;
const deps = (over = {}) => ({
  orgs: async () => [{ id: "o1", name: "Diamond" }],
  activo: () => true,
  abiertos: async () => filas,
  ciclo: async () => [A1, A2],
  conVentana: async () => [A1],
  armarCaso: async ({ pendiente }) => ({ codigo: pendiente.codigo, nombre: "x" }),
  lead: async (_o, id) => ({ id, phone: "57300" }),
  mensajes: async () => [],
  armarLibro: async ({ casos }) => Buffer.from(`xlsx:${casos.length}`),
  subir: async () => "media-1",
  documento: async (_o, tel) => { log.push({ doc: tel }); return "wamid-1"; },
  plantilla: async (_o, tel) => { log.push({ plantilla: tel }); return { ok: true }; },
  texto: async (_o, tel, t) => { log.push({ texto: tel, t }); return { ok: true }; },
  marcarEnviados: async (ids, o) => { log.push({ marcados: ids, ...o }); },
  campana: async (a) => { log.push({ campana: a.advisor.id }); },
  nombrePlantilla: null,
  ...over,
});
const fila = (codigo, asesor, over = {}) => ({ id: codigo, codigo, lead_id: `l-${codigo}`, asesor_id: asesor, estado: "pendiente", enviado_at: null, ...over });

beforeEach(() => { log = []; filas = []; });

test("fuera de las 8 a. m. y las 2 p. m., o domingo, no manda nada", async () => {
  filas = [fila("C-1", "a1")];
  assert.strictEqual(sched.turnoDe(new Date("2026-10-30T15:00:00Z")), null);
  assert.strictEqual(sched.turnoDe(new Date("2026-11-01T13:05:00Z")), null); // domingo
  assert.strictEqual(sched.turnoDe(VIE_8AM), "8am");
  assert.strictEqual(sched.turnoDe(new Date("2026-10-30T19:10:00Z")), "2pm");
  const r = await sched.runOnce({ ahora: new Date("2026-10-30T15:00:00Z"), deps: deps() });
  assert.strictEqual(r.enviados, 0);
});

test("sin pendientes no manda nada", async () => {
  const r = await sched.runOnce({ ahora: VIE_8AM, deps: deps() });
  assert.strictEqual(r.enviados, 0);
  assert.strictEqual(log.length, 0);
});

test("cada una lo suyo; la de ventana cerrada sin plantilla pasa a la que la tiene abierta", async () => {
  filas = [fila("C-1", "a1"), fila("C-2", "a2"), fila("C-3", "a1")];
  const r = await sched.runOnce({ ahora: VIE_8AM, deps: deps() });
  assert.deepStrictEqual([r.enviados, r.filas, r.reasignados], [1, 3, 1]);
  assert.deepStrictEqual(log.filter((x) => x.doc).map((x) => x.doc), ["573011880668"]);
  const m = log.find((x) => x.marcados);
  assert.deepStrictEqual([m.marcados.sort(), m.asesorId], [["C-1", "C-2", "C-3"], "a1"]);
  assert.match(log.find((x) => x.texto).t, /Daiana, tienes 3 personas por contactar/);
});

test("con plantilla, a la de ventana cerrada le llega por plantilla", async () => {
  filas = [fila("C-1", "a1"), fila("C-2", "a2")];
  const r = await sched.runOnce({ ahora: VIE_8AM, deps: deps({ nombrePlantilla: "pendientes_contacto" }) });
  assert.deepStrictEqual([r.enviados, r.porPlantilla], [2, 1]);
  assert.deepStrictEqual(log.filter((x) => x.plantilla).map((x) => x.plantilla), ["573003418113"]);
});

test("no repite el Excel del mismo turno si ya salió (reinicio del servidor)", async () => {
  filas = [fila("C-1", "a1", { estado: "enviado", enviado_at: "2026-10-30T13:01:00Z" })];
  const r = await sched.runOnce({ ahora: VIE_8AM, deps: deps() });
  assert.strictEqual(r.enviados, 0);
});

test("lo del Excel de la mañana que no volvió sale otra vez a las 2 p. m.", async () => {
  filas = [fila("C-1", "a1", { estado: "enviado", enviado_at: "2026-10-30T13:01:00Z" })];
  const r = await sched.runOnce({ ahora: new Date("2026-10-30T19:05:00Z"), deps: deps() });
  assert.strictEqual(r.enviados, 1);
});

test("si nadie tiene la ventana abierta ni hay plantilla, va por la campana", async () => {
  filas = [fila("C-1", "a1")];
  const r = await sched.runOnce({ ahora: VIE_8AM, deps: deps({ conVentana: async () => [] }) });
  assert.strictEqual(r.enviados, 0);
  assert.deepStrictEqual(log.filter((x) => x.campana).map((x) => x.campana), ["a1"]);
});
