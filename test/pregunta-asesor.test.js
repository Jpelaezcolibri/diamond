// Orquestacion de preguntas al asesor (spec 2026-10-25 §5).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const pa = require("../src/lib/pregunta-asesor");

const ORG = { id: "org-1", name: "Diamond" };
const A1 = { id: "a1", name: "Daiana Zea", phone: "573011880668", alias_publico: "Asesor 1", activo: true };
const A2 = { id: "a2", name: "Claudia Valencia", phone: "573000008113", alias_publico: "Asesor 2", activo: true };
const LEAD = { id: "l1", org_id: "org-1", phone: "573125550000", nombre: "Andrea Strauch", source: "colega" };

let envios;
const deps = (over = {}) => ({
  ciclo: async () => [A1, A2],
  avisarAsesor: async (a) => { envios.push({ campana: a.motivo, a: a.advisor.id, titulo: a.titulo, cuerpo: a.cuerpo, whatsapp: a.whatsapp }); return { ok: true }; },
  mensaje: async (_o, to, texto, opts) => { envios.push({ wa: to, texto, opts }); return { ok: true, wamid: "wamid.A" }; },
  texto: async (_o, to, texto) => { envios.push({ colega: to, texto }); return { ok: true, wamid: "wamid.C" }; },
  plantilla: async (_o, to, o) => { envios.push({ plantilla: o.name, to, params: o.bodyParams }); return { ok: true }; },
  notificar: async (n) => { envios.push({ nota: n.titulo, a: n.advisor.id }); return { ok: true }; },
  soloLlamada: async () => false,
  lead: async () => ({ ...LEAD }),
  actualizarLead: async (id, patch) => { envios.push({ leadPatch: patch }); return {}; },
  ...over,
});

beforeEach(() => {
  envios = [];
  memory.preguntasAsesor.length = 0;
  delete process.env.SOFI_PREGUNTA_ASESOR_PLANTILLA;
  delete process.env.SOFI_RESPUESTA_LISTA_PLANTILLA;
});

const ctx = () => ({ org: ORG, lead: { ...LEAD }, colega: { nombre: "Andrea" } });
const input = { pregunta: "¿Precio final de la ref 10013037?", ref: "10013037", tipo: "precio" };

test("registrar crea la pregunta, avisa por la campana y por WhatsApp sin datos del colega", async () => {
  const out = await pa.registrar({ ctx: ctx(), input, deps: deps() });
  assert.match(out, /Pregunta registrada/);
  assert.match(out, /No prometas hora/);
  const p = memory.preguntasAsesor[0];
  assert.strictEqual(p.asesor_id, "a1");
  assert.strictEqual(p.wamid_aviso, "wamid.A");
  assert.ok(envios.some((e) => e.campana === "pregunta" && e.a === "a1"));
  const wa = envios.find((e) => e.wa);
  assert.strictEqual(wa.wa, A1.phone);
  assert.match(wa.texto, /Ref 10013037: ¿Precio final de la ref 10013037\?/);
  assert.doesNotMatch(wa.texto, /Andrea|573125550000/);
  assert.strictEqual(envios.find((e) => e.campana).whatsapp, false, "la pregunta ya llego por WhatsApp: avisarAsesor no manda el suyo");
});

test("registrar no duplica ni vuelve a avisar", async () => {
  await pa.registrar({ ctx: ctx(), input, deps: deps() });
  envios = [];
  const out = await pa.registrar({ ctx: ctx(), input, deps: deps() });
  assert.match(out, /ya está con el asesor/);
  assert.strictEqual(envios.length, 0);
});

test("con la ventana del asesor cerrada usa la plantilla si existe; si no, queda la campana", async () => {
  const cerrada = { mensaje: async () => ({ ok: false, error: "Re-engagement message (131047)" }) };
  process.env.SOFI_PREGUNTA_ASESOR_PLANTILLA = "pregunta_asesor";
  await pa.registrar({ ctx: ctx(), input, deps: deps(cerrada) });
  assert.ok(envios.some((e) => e.plantilla === "pregunta_asesor" && e.params[0] === "10013037"));
  assert.strictEqual(envios.find((e) => e.campana).whatsapp, false, "la plantilla de la pregunta llego: sin aviso_app");
  memory.preguntasAsesor.length = 0;
  envios = [];
  delete process.env.SOFI_PREGUNTA_ASESOR_PLANTILLA;
  await pa.registrar({ ctx: ctx(), input, deps: deps(cerrada) });
  assert.ok(!envios.some((e) => e.plantilla));
  assert.ok(envios.some((e) => e.campana === "pregunta"));
  assert.strictEqual(envios.find((e) => e.campana).whatsapp, true, "la pregunta no llego por WhatsApp: aviso_app avisa que mire el CRM");
});

test("sin asesores en el ciclo la pregunta queda sin asesor y Sofi igual dice que pregunta", async () => {
  const out = await pa.registrar({ ctx: ctx(), input, deps: deps({ ciclo: async () => [] }) });
  assert.match(out, /Pregunta registrada/);
  assert.strictEqual(memory.preguntasAsesor[0].asesor_id, null);
  assert.strictEqual(envios.filter((e) => !e.leadPatch).length, 0, "nadie recibe aviso; el chat queda marcado en Para atender");
});

test("responder cierra, entrega literal al colega y la segunda respuesta no pisa", async () => {
  await pa.registrar({ ctx: ctx(), input, deps: deps() });
  const id = memory.preguntasAsesor[0].id;
  envios = [];
  const r = await pa.responder({ org: ORG, preguntaId: id, respuesta: "450 es el precio final, negocian poco", advisor: A1, via: "crm", deps: deps({ lead: async () => ({ ...LEAD, atencion_pendiente: "pregunta" }) }) });
  assert.strictEqual(r.ok, true);
  const msg = envios.find((e) => e.colega);
  assert.strictEqual(msg.colega, LEAD.phone);
  assert.strictEqual(msg.texto, "Hola Andrea, ya tengo la respuesta sobre la Ref 10013037:\n450 es el precio final, negocian poco");
  assert.doesNotMatch(msg.texto, /Daiana|Asesor 1|573011880668/);
  assert.strictEqual(memory.preguntasAsesor[0].estado, "entregada");
  assert.ok(envios.some((e) => e.leadPatch && e.leadPatch.atencion_pendiente === null));
  const r2 = await pa.responder({ org: ORG, preguntaId: id, respuesta: "otra", advisor: A2, via: "whatsapp", deps: deps() });
  assert.deepStrictEqual([r2.ok, r2.codigo], [false, 409]);
});

test("responder valida la respuesta y la org", async () => {
  await pa.registrar({ ctx: ctx(), input, deps: deps() });
  const id = memory.preguntasAsesor[0].id;
  assert.strictEqual((await pa.responder({ org: ORG, preguntaId: id, respuesta: " ", advisor: A1, via: "crm", deps: deps() })).codigo, 400);
  assert.strictEqual((await pa.responder({ org: { id: "otra" }, preguntaId: id, respuesta: "450", advisor: A1, via: "crm", deps: deps() })).codigo, 404);
});

test("ventana del colega cerrada: plantilla respuesta_lista y queda esperando; sin plantilla, campana al asesor", async () => {
  await pa.registrar({ ctx: ctx(), input, deps: deps() });
  const id = memory.preguntasAsesor[0].id;
  const cerrada = { texto: async () => ({ ok: false, error: "more than 24 hours" }) };
  process.env.SOFI_RESPUESTA_LISTA_PLANTILLA = "respuesta_lista";
  envios = [];
  await pa.responder({ org: ORG, preguntaId: id, respuesta: "450", advisor: A1, via: "crm", deps: deps(cerrada) });
  assert.ok(envios.some((e) => e.plantilla === "respuesta_lista" && e.params[0] === "Andrea" && e.params[1] === "10013037"));
  assert.strictEqual(memory.preguntasAsesor[0].entrega_error, "esperando_ventana");

  memory.preguntasAsesor.length = 0;
  delete process.env.SOFI_RESPUESTA_LISTA_PLANTILLA;
  await pa.registrar({ ctx: ctx(), input, deps: deps() });
  envios = [];
  await pa.responder({ org: ORG, preguntaId: memory.preguntasAsesor[0].id, respuesta: "450", advisor: A1, via: "crm", deps: deps(cerrada) });
  assert.ok(envios.some((e) => e.nota && /No le pude pasar la respuesta/.test(e.nota)));
  assert.strictEqual(memory.preguntasAsesor[0].entrega_error, "ventana_cerrada");
});

test("colega solo llamada: no se le escribe y se le pide al asesor llamar", async () => {
  await pa.registrar({ ctx: ctx(), input, deps: deps() });
  envios = [];
  await pa.responder({ org: ORG, preguntaId: memory.preguntasAsesor[0].id, respuesta: "450", advisor: A1, via: "crm", deps: deps({ soloLlamada: async () => true }) });
  assert.ok(!envios.some((e) => e.colega));
  assert.ok(envios.some((e) => e.nota && /Llámalo/.test(e.nota)));
  assert.strictEqual(memory.preguntasAsesor[0].entrega_error, "solo_llamada");
});

test("entregarPendientesDe manda lo que esperaba la ventana", async () => {
  await pa.registrar({ ctx: ctx(), input, deps: deps() });
  const id = memory.preguntasAsesor[0].id;
  Object.assign(memory.preguntasAsesor[0], { estado: "respondida", respuesta: "450", entrega_error: "esperando_ventana" });
  envios = [];
  const n = await pa.entregarPendientesDe({ org: ORG, lead: { ...LEAD }, deps: deps() });
  assert.strictEqual(n, 1);
  assert.ok(envios.some((e) => e.colega && /450/.test(e.texto)));
  assert.strictEqual(memory.preguntasAsesor.find((p) => p.id === id).estado, "entregada");
});

test("textoRespuesta sin ref y sin nombre", () => {
  assert.strictEqual(pa.textoRespuesta({ lead: { phone: "57300" }, pregunta: { respuesta: "Sí, es unidad cerrada" } }), "Hola, ya tengo la respuesta sobre lo que me preguntaste:\nSí, es unidad cerrada");
});

test("descartar cierra sin escribirle a nadie", async () => {
  await pa.registrar({ ctx: ctx(), input, deps: deps() });
  envios = [];
  const r = await pa.descartar({ org: ORG, preguntaId: memory.preguntasAsesor[0].id, por: "Juan", deps: deps() });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(memory.preguntasAsesor[0].estado, "descartada");
  assert.ok(!envios.some((e) => e.colega || e.wa));
});

test("registrar marca el chat como pregunta solo si no hay otro pendiente", async () => {
  const conOtro = { ...ctx(), lead: { ...LEAD, atencion_pendiente: "pide_asesor" } };
  await pa.registrar({ ctx: conOtro, input, deps: deps() });
  assert.ok(!envios.some((e) => e.leadPatch), "no pisa pide_asesor");
  memory.preguntasAsesor.length = 0;
  envios = [];
  await pa.registrar({ ctx: ctx(), input, deps: deps() });
  const patch = envios.find((e) => e.leadPatch).leadPatch;
  assert.strictEqual(patch.atencion_pendiente, "pregunta");
  assert.ok(patch.atencion_desde);
});

test("el re-aviso no vuelve a marcar el chat", async () => {
  await pa.registrar({ ctx: ctx(), input, deps: deps() });
  envios = [];
  await pa.avisar({ org: ORG, pregunta: memory.preguntasAsesor[0], lead: { ...LEAD }, advisor: A1, reaviso: true, deps: deps() });
  assert.ok(!envios.some((e) => e.leadPatch));
});

test("responder no limpia un pendiente ajeno (pide_asesor)", async () => {
  await pa.registrar({ ctx: ctx(), input, deps: deps() });
  envios = [];
  await pa.responder({ org: ORG, preguntaId: memory.preguntasAsesor[0].id, respuesta: "450", advisor: A1, via: "crm", deps: deps({ lead: async () => ({ ...LEAD, atencion_pendiente: "pide_asesor" }) }) });
  assert.ok(!envios.some((e) => e.leadPatch));
});
