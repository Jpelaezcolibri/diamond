// Recordatorio 2 h antes y pregunta 3 h despues de una visita confirmada
// (spec 2026-10-21 sofi-super-agente §2.3). Reloj falso, dependencias inyectadas.

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const vc = require("../src/scheduler/visita-cliente");

const H = 3600e3;
const VISITA = new Date("2026-10-22T20:00:00Z"); // 3 p. m. Bogota
const ENV = ["SOFI_RECORDATORIO_VISITA", "SOFI_POSTVISITA", "SOFI_RECORDATORIO_PLANTILLA", "SOFI_POSTVISITA_PLANTILLA"];
let guardado;
beforeEach(() => {
  guardado = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  process.env.SOFI_RECORDATORIO_VISITA = "true";
  process.env.SOFI_POSTVISITA = "true";
  delete process.env.SOFI_RECORDATORIO_PLANTILLA;
  delete process.env.SOFI_POSTVISITA_PLANTILLA;
  vc._reset();
});
afterEach(() => {
  for (const k of ENV) guardado[k] === undefined ? delete process.env[k] : (process.env[k] = guardado[k]);
});

const cita = (extra = {}) => ({ estado: "confirmada", tipo: "visita", fecha_hora: VISITA.toISOString(), ref: "10414675", asesor_id: "a1", ...extra });
const lead = (extra = {}, citaExtra = {}) => ({ id: "l1", org_id: "o1", nombre: "Ana Pérez", phone: "573001112233", source: "whatsapp", cita: cita(citaExtra), ...extra });

function armar(leads, { ultimo, soloLlamada = false, envio = { ok: true } } = {}) {
  const log = { texto: [], plantilla: [], registrado: [], marcas: [] };
  const deps = {
    orgs: async () => [{ id: "o1", name: "Diamond" }],
    candidatos: async () => leads,
    soloLlamada: async () => soloLlamada,
    asesor: async () => ({ alias_publico: "Asesor 2" }),
    zona: async () => "Laureles",
    conversacion: async () => ({ id: "c1", whatsapp_phone_id: "pid" }),
    ultimoDelCliente: async () => ultimo,
    enviarTexto: async (o, t, texto) => (log.texto.push({ t, texto }), envio),
    enviarPlantilla: async (o, t, p) => (log.plantilla.push({ t, p }), envio),
    registrar: async (c, texto) => log.registrado.push({ c, texto }),
    marcar: async (l, llave, valor) => {
      if (valor && l.cita[llave]) return false;
      l.cita = { ...l.cita, [llave]: valor };
      log.marcas.push([llave, valor]);
      return true;
    },
  };
  return { deps, log };
}

const ANTES = new Date(VISITA.getTime() - 1.5 * H); // 1:30 p. m.
const DESPUES = new Date(VISITA.getTime() + 3.5 * H); // 6:30 p. m.

test("2 h antes sale el recordatorio por texto, con hora, ref, zona y alias, y queda en la conversacion", async () => {
  const l = lead();
  const { deps, log } = armar([l], { ultimo: new Date(ANTES.getTime() - H).toISOString() });
  const r = await vc.runOnce({ ahora: ANTES, deps });
  assert.strictEqual(r.enviados, 1);
  assert.strictEqual(log.texto.length, 1);
  assert.match(log.texto[0].texto, /^Hola Ana, te recuerdo tu visita de hoy a las 3:00.*p\. ?m\. a la Ref 10414675 en Laureles\. Te recibe Asesor 2\./);
  assert.match(log.texto[0].texto, /reagendamos\.$/);
  assert.strictEqual(log.registrado.length, 1);
  assert.ok(l.cita.recordatorio_cliente_at);
});

test("una segunda corrida no repite el recordatorio", async () => {
  const l = lead();
  const { deps, log } = armar([l], { ultimo: new Date(ANTES.getTime() - H).toISOString() });
  await vc.runOnce({ ahora: ANTES, deps });
  vc._reset();
  await vc.runOnce({ ahora: new Date(ANTES.getTime() + 10 * 60e3), deps });
  assert.strictEqual(log.texto.length, 1);
});

test("antes de las 2 h todavia no sale", async () => {
  const { deps, log } = armar([lead()], { ultimo: new Date(VISITA - 5 * H).toISOString() });
  await vc.runOnce({ ahora: new Date(VISITA.getTime() - 2.5 * H), deps });
  assert.strictEqual(log.texto.length, 0);
});

test("3 h despues, el cliente recibe la pregunta de como le fue", async () => {
  const { deps, log } = armar([lead()], { ultimo: new Date(DESPUES.getTime() - H).toISOString() });
  await vc.runOnce({ ahora: DESPUES, deps });
  assert.strictEqual(log.texto[0].texto, "Hola Ana, ¿qué te pareció la Ref 10414675? Cuéntame qué te gustó y qué no, y te ayudo con el siguiente paso.");
});

test("al colega se le pregunta por su cliente", async () => {
  const { deps, log } = armar([lead({ source: "colega" })], { ultimo: new Date(DESPUES.getTime() - H).toISOString() });
  await vc.runOnce({ ahora: DESPUES, deps });
  assert.strictEqual(log.texto[0].texto, "Hola Ana, ¿qué le pareció la Ref 10414675 a tu cliente? Si quiere avanzar o ver otras opciones parecidas, aquí estoy.");
});

test("colega de solo llamada, cita de la linea del radar y cita no confirmada: nada", async () => {
  const u = new Date(ANTES.getTime() - H).toISOString();
  for (const [l, opt] of [
    [lead({ source: "colega" }), { soloLlamada: true }],
    [lead({ source: "colega" }), { soloLlamada: null }],
    [lead({}, { origen: "linea_dm" }), {}],
    [lead({}, { estado: "propuesta" }), {}],
    [lead({}, { tipo: "llamada" }), {}],
    [lead({ phone: null }), {}],
  ]) {
    const { deps, log } = armar([l], { ultimo: u, ...opt });
    await vc.runOnce({ ahora: ANTES, deps });
    assert.strictEqual(log.texto.length + log.plantilla.length, 0);
  }
});

test("ventana cerrada sin plantilla: no sale; con plantilla, sale la plantilla", async () => {
  const viejo = new Date(ANTES.getTime() - 30 * H).toISOString();
  let a = armar([lead()], { ultimo: viejo });
  await vc.runOnce({ ahora: ANTES, deps: a.deps });
  assert.strictEqual(a.log.texto.length + a.log.plantilla.length, 0);
  assert.strictEqual(a.log.marcas.length, 0);

  process.env.SOFI_RECORDATORIO_PLANTILLA = "recordatorio_visita";
  a = armar([lead()], { ultimo: viejo });
  await vc.runOnce({ ahora: ANTES, deps: a.deps });
  assert.strictEqual(a.log.texto.length, 0);
  assert.strictEqual(a.log.plantilla[0].p.name, "recordatorio_visita");
});

test("si el envio falla, la marca se suelta para reintentar", async () => {
  const l = lead();
  const { deps } = armar([l], { ultimo: new Date(ANTES.getTime() - H).toISOString(), envio: { ok: false, error: "x" } });
  const r = await vc.runOnce({ ahora: ANTES, deps });
  assert.strictEqual(r.enviados, 0);
  assert.strictEqual(l.cita.recordatorio_cliente_at, null);
});

test("interruptores apagados: nada; de noche: nada", async () => {
  const u = new Date(ANTES.getTime() - H).toISOString();
  process.env.SOFI_RECORDATORIO_VISITA = "false";
  process.env.SOFI_POSTVISITA = "false";
  let a = armar([lead()], { ultimo: u });
  await vc.runOnce({ ahora: ANTES, deps: a.deps });
  assert.strictEqual(a.log.texto.length, 0);

  process.env.SOFI_POSTVISITA = "true";
  a = armar([lead()], { ultimo: u });
  // 11 p. m. Bogota, 8 h despues de la visita
  await vc.runOnce({ ahora: new Date("2026-10-23T04:00:00Z"), deps: a.deps });
  assert.strictEqual(a.log.texto.length, 0);
});

test("postvisita no se manda dias despues, y el recordatorio no sale si la visita ya paso", () => {
  assert.strictEqual(vc.pasoPendiente(cita(), new Date(VISITA.getTime() + 30 * H)), null);
  assert.strictEqual(vc.pasoPendiente(cita(), new Date(VISITA.getTime() + 1 * H)), null);
});

test("los textos nuevos no tienen voseo", () => {
  const t = [vc.textoRecordatorio({ lead: { nombre: "Ana" }, hora: "3:00 p. m.", ref: "1", zona: "Z", alias: "Asesor 1" }), vc.textoPostvisita({ lead: { nombre: "Ana" }, ref: "1" }), vc.textoPostvisita({ lead: { source: "colega" }, ref: "1" })].join(" ");
  assert.doesNotMatch(t, /\b(contame|decime|tenés|querés|podés|avisame|respondé|sabés)\b/i);
});
