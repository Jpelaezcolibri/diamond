// Juan, 2026-11-07 (capturas de Catherine): el Excel sale UNA vez al dia, una
// persona que ya salio no vuelve a salir si no hay nada nuevo, y el texto dice
// cuantas personas y por que (sin "1 personas").
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const sched = require("../src/scheduler/excel-pendientes");
const ritmo = require("../src/lib/ritmo-avisos");

const A1 = { id: "a1", name: "Daiana", phone: "573011880668" };
const A2 = { id: "a2", name: "Claudia", phone: "573003418113" };
const VIE_8AM = new Date("2026-10-30T13:05:00Z");
const VIE_2PM = new Date("2026-10-30T19:05:00Z");
let log, filas;
const deps = (over = {}) => ({
  orgs: async () => [{ id: "o1", name: "Diamond" }],
  activo: () => true,
  abiertos: async () => filas,
  ciclo: async () => [A1, A2],
  conVentana: async () => [A1],
  armarCaso: async ({ pendiente, lead }) => ({ codigo: pendiente.codigo, nombre: lead.nombre || "x", tipo: "colega", porQue: "no le contestó a Sofi", motivo: pendiente.motivo }),
  lead: async (_o, id) => ({ id, phone: "57300", nombre: id === "l-C-1" ? "Andrea Strauch" : null }),
  mensajes: async () => [],
  armarLibro: async ({ casos }) => Buffer.from(`xlsx:${casos.length}`),
  subir: async () => "media-1",
  documento: async (_o, tel, _m, filename) => { log.push({ doc: tel, filename }); return "wamid-1"; },
  plantilla: async (_o, tel, args) => { log.push({ plantilla: tel, params: args.bodyParams }); return { ok: true }; },
  texto: async (_o, tel, t) => { log.push({ texto: tel, t }); return { ok: true }; },
  marcarEnviados: async (ids, o) => { log.push({ marcados: ids, ...o }); },
  campana: async (a) => { log.push({ campana: a.advisor.id, titulo: a.titulo }); },
  nombrePlantilla: null,
  ...over,
});
const fila = (codigo, asesor, over = {}) => ({ id: codigo, codigo, lead_id: `l-${codigo}`, asesor_id: asesor, estado: "pendiente", motivo: "no_contesto", enviado_at: null, ...over });

beforeEach(() => { log = []; filas = []; ritmo._reset(); sched._reset(); });

test("una sola vez al día: a las 8 a. m.; a las 2 p. m., de noche o el domingo no manda nada", async () => {
  filas = [fila("C-1", "a1")];
  assert.strictEqual(sched.turnoDe(VIE_8AM), "8am");
  assert.strictEqual(sched.turnoDe(VIE_2PM), null);
  assert.strictEqual(sched.turnoDe(new Date("2026-10-30T15:00:00Z")), null);
  assert.strictEqual(sched.turnoDe(new Date("2026-11-01T13:05:00Z")), null); // domingo
  for (const ahora of [VIE_2PM, new Date("2026-10-30T15:00:00Z")]) {
    const r = await sched.runOnce({ ahora, deps: deps() });
    assert.strictEqual(r.enviados, 0);
  }
  assert.strictEqual(log.length, 0);
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
  assert.match(log.find((x) => x.doc).filename, /^Pendientes Diamond - Daiana - 30 oct\.xlsx$/);
  const m = log.find((x) => x.marcados);
  assert.deepStrictEqual([m.marcados.sort(), m.asesorId, m.loteId], [["C-1", "C-2", "C-3"], "a1", "L-2026-10-30-a1"]);
});

test("con plantilla, a la de ventana cerrada le llega por plantilla, con el número en palabras", async () => {
  filas = [fila("C-1", "a1"), fila("C-2", "a2")];
  const r = await sched.runOnce({ ahora: VIE_8AM, deps: deps({ nombrePlantilla: "pendientes_contacto" }) });
  assert.deepStrictEqual([r.enviados, r.porPlantilla], [2, 1]);
  const p = log.find((x) => x.plantilla);
  assert.deepStrictEqual([p.plantilla, p.params], ["573003418113", ["1 persona"]]);
});

test("lo que ya salió en un Excel no vuelve a salir aunque no haya vuelto", async () => {
  filas = [fila("C-1", "a1", { estado: "enviado", enviado_at: "2026-10-29T13:01:00Z", lote_id: "L-2026-10-29-a1" })];
  const r = await sched.runOnce({ ahora: VIE_8AM, deps: deps() });
  assert.strictEqual(r.enviados, 0);
  assert.strictEqual(log.length, 0);
});

test("lo que volvió a pendiente (No contesta) o es nuevo sí sale, junto en un solo Excel", async () => {
  filas = [
    fila("C-1", "a1", { estado: "enviado", enviado_at: "2026-10-29T13:01:00Z" }), // ya salió ayer: no
    fila("C-2", "a1", { estado: "pendiente", enviado_at: "2026-10-29T13:01:00Z", intentos: 1 }), // No contesta: sí
    fila("C-3", "a1"), // nuevo: sí
  ];
  const r = await sched.runOnce({ ahora: VIE_8AM, deps: deps() });
  assert.deepStrictEqual([r.enviados, r.filas], [1, 2]);
  assert.deepStrictEqual(log.find((x) => x.marcados).marcados.sort(), ["C-2", "C-3"]);
});

test("un tick después dentro de la misma media hora no repite (ya quedaron en enviado)", async () => {
  filas = [fila("C-1", "a1")];
  const d = deps({ marcarEnviados: async (ids) => { for (const f of filas) if (ids.includes(f.id)) { f.estado = "enviado"; f.enviado_at = VIE_8AM.toISOString(); } } });
  assert.strictEqual((await sched.runOnce({ ahora: VIE_8AM, deps: d })).enviados, 1);
  assert.strictEqual((await sched.runOnce({ ahora: new Date(VIE_8AM.getTime() + 10 * 60 * 1000), deps: d })).enviados, 0);
  assert.strictEqual(log.filter((x) => x.doc).length, 1);
});

test("el texto dice cuántas personas y por qué: singular con nombre, plural con el conteo por motivo", async () => {
  filas = [fila("C-1", "a1", { motivo: "sin_seguimiento" })];
  await sched.runOnce({ ahora: VIE_8AM, deps: deps() });
  const uno = log.find((x) => x.texto).t;
  assert.match(uno, /^Daiana, tienes 1 persona por contactar: Andrea Strauch \(colega\), que no le contestó a Sofi y ella ya no alcanza a escribirle\./);
  assert.doesNotMatch(uno, /1 personas/);
  assert.match(uno, /Resultado/);
  assert.match(uno, /devuélveme el Excel por este chat/);

  log = [];
  filas = [fila("C-1", "a1"), fila("C-2", "a1", { motivo: "pide_asesor" }), fila("C-3", "a1"), fila("C-4", "a1", { motivo: "nota_de_voz" })];
  await sched.runOnce({ ahora: VIE_8AM, deps: deps() });
  const varios = log.find((x) => x.texto).t;
  assert.match(varios, /^Daiana, tienes 4 personas por contactar: 2 no le contestaron a Sofi, 1 pidió hablar con un asesor y 1 mandó una nota de voz que Sofi no puede escuchar\./);
  assert.doesNotMatch(varios, /vos\b|tenés|escribile/);
});

test("si nadie tiene la ventana abierta ni hay plantilla, va por la campana una sola vez al día", async () => {
  filas = [fila("C-1", "a1")];
  const d = deps({ conVentana: async () => [] });
  const r = await sched.runOnce({ ahora: VIE_8AM, deps: d });
  assert.strictEqual(r.enviados, 0);
  await sched.runOnce({ ahora: new Date(VIE_8AM.getTime() + 10 * 60 * 1000), deps: d });
  await sched.runOnce({ ahora: new Date(VIE_8AM.getTime() + 20 * 60 * 1000), deps: d });
  const campanas = log.filter((x) => x.campana);
  assert.deepStrictEqual(campanas.map((x) => x.campana), ["a1"]);
  assert.match(campanas[0].titulo, /Tienes 1 persona por contactar/);
});
