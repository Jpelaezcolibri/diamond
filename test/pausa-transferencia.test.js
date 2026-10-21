// La pausa por transferencia tiene salida (revision 2026-10-21): aviso repetido
// a los 30 min habiles, vuelta a Sofi a las 2 h habiles, relojes que solo
// cuentan 8:00-20:00 Bogota y marca que se borra cuando la asesora escribe.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const p = require("../src/lib/pausa-transferencia");

const MIN = 60 * 1000;
const ORG = { id: "org-1", name: "Diamond" };
const DAIANA = { id: "adv-1", name: "Daiana Zea", phone: "573011880668", alias_publico: "Asesor 1", activo: true };
// 2026-10-21 15:00 Bogota = 20:00 UTC
const T0 = new Date("2026-10-21T20:00:00Z");
const mas = (min, base = T0) => new Date(base.getTime() + min * MIN);

// ── Relojes habiles ───────────────────────────────────────────────────────

test("msHabiles: de dia cuenta todo, de noche nada", () => {
  assert.equal(p.msHabiles(T0, mas(30)), 30 * MIN);
  // 21:00 a 23:00 Bogota (02:00-04:00 UTC)
  assert.equal(p.msHabiles("2026-10-22T02:00:00Z", "2026-10-22T04:00:00Z"), 0);
  assert.equal(p.msHabiles(mas(10), T0), 0, "al reves da cero");
});

test("msHabiles: transferido a las 7:50 p. m., a las 8:20 a. m. lleva 30 min habiles", () => {
  const siete50 = new Date("2026-10-22T00:50:00Z"); // 19:50 Bogota del 21
  const ocho20 = new Date("2026-10-22T13:20:00Z"); // 08:20 Bogota del 22
  assert.equal(p.msHabiles(siete50, ocho20), 30 * MIN);
  assert.equal(p.msHabiles(siete50, new Date("2026-10-22T13:10:00Z")), 20 * MIN);
});

// ── Que toca ─────────────────────────────────────────────────────────────

test("pasoPausa: nada antes de 30 min, reaviso a los 30, una sola vez, devolver a las 2 h", () => {
  const marca = { at: T0.toISOString() };
  assert.equal(p.pasoPausa({ marca, modo: "humano", ahora: mas(29) }), "nada");
  assert.equal(p.pasoPausa({ marca, modo: "humano", ahora: mas(30) }), "reaviso");
  assert.equal(p.pasoPausa({ marca: { ...marca, reaviso_at: mas(30).toISOString() }, modo: "humano", ahora: mas(60) }), "nada");
  assert.equal(p.pasoPausa({ marca: { ...marca, reaviso_at: mas(30).toISOString() }, modo: "humano", ahora: mas(120) }), "devolver");
});

test("pasoPausa: si la asesora escribio despues de la transferencia o ya no esta en humano, se limpia", () => {
  const marca = { at: T0.toISOString() };
  assert.equal(p.pasoPausa({ marca, modo: "humano", ultimoAsistente: { created_at: mas(5).toISOString() }, ahora: mas(200) }), "limpiar");
  assert.equal(p.pasoPausa({ marca, modo: "bot", ahora: mas(200) }), "limpiar");
  // La despedida de Sofi es anterior a la marca: no cuenta como la asesora.
  assert.equal(p.pasoPausa({ marca, modo: "humano", ultimoAsistente: { created_at: mas(-1).toISOString() }, ahora: mas(31) }), "reaviso");
  assert.equal(p.pasoPausa({ marca: null, modo: "humano", ahora: mas(500) }), "nada");
});

test("pasoPausa: transferido a las 7:50 p. m., el reaviso no sale de noche sino a las ~8:20 a. m.", () => {
  const marca = { at: "2026-10-22T00:50:00Z" };
  assert.equal(p.pasoPausa({ marca, modo: "humano", ahora: new Date("2026-10-22T12:00:00Z") }), "nada"); // 7:00 a. m.
  assert.equal(p.pasoPausa({ marca, modo: "humano", ahora: new Date("2026-10-22T13:20:00Z") }), "reaviso");
});

// ── Acciones ─────────────────────────────────────────────────────────────

function mundo({ seguimiento, asesora = DAIANA, envioOk = true } = {}) {
  const lead = { id: "lead-1", nombre: "Laura", phone: "573125550000", transferido_advisor_id: DAIANA.id, seguimiento };
  const log = { updates: [], avisos: [], modos: [], mensajes: [], envios: [], alertas: [], entregas: [] };
  const deps = {
    leerLead: async () => ({ ...lead, seguimiento: lead.seguimiento }),
    actualizarLead: async (id, patch) => {
      log.updates.push({ id, patch });
      if (patch.seguimiento) lead.seguimiento = patch.seguimiento;
    },
    asesor: async () => asesora,
    avisarAsesor: async (a) => (log.avisos.push(a), { ok: true, campana: true, push: 0, whatsapp: true }),
    setModo: async (id, modo) => log.modos.push({ id, modo }),
    guardarMensaje: async (id, role, content, extras) => (log.mensajes.push({ id, role, content, extras }), { id: `m${log.mensajes.length}` }),
    setDelivery: async (id, estado) => log.entregas.push({ id, estado }),
    enviar: async (org, tel, texto) => (log.envios.push({ tel, texto }), envioOk ? { ok: true, wamid: "wamid.S" } : { ok: false, error: "fuera de ventana" }),
    alertaTecnica: async (r, d) => log.alertas.push(`${r} ${d}`),
  };
  return { lead, log, deps };
}
const cand = (lead, extra = {}) => ({ id: "conv-1", modo: "humano", whatsapp_phone_id: "PID", lead, ultimoCliente: { created_at: mas(-1).toISOString() }, ultimoAsistente: { created_at: mas(-0.5).toISOString() }, ...extra });

test("a los 30 min: aviso repetido a la duena (campana + aviso_app) una sola vez", async () => {
  const { lead, log, deps } = mundo({ seguimiento: { t24_sent_at: "x", pausa_transferencia: { at: T0.toISOString(), advisor_id: DAIANA.id } } });
  const c = cand(lead);
  assert.equal(await p.atenderPausa({ org: ORG, c, ahora: mas(31) }, deps), "reaviso");
  assert.equal(log.avisos.length, 1);
  assert.equal(log.avisos[0].advisor, DAIANA);
  assert.equal(log.avisos[0].motivo, "transferido");
  assert.ok(lead.seguimiento.pausa_transferencia.reaviso_at, "queda marcado");
  assert.equal(lead.seguimiento.t24_sent_at, "x", "no pisa el resto del seguimiento");
  assert.equal(await p.atenderPausa({ org: ORG, c, ahora: mas(60) }, deps), "nada");
  assert.equal(log.avisos.length, 1);
  assert.equal(log.modos.length, 0);
});

test("a las 2 h: vuelve a Sofi, le escribe al cliente con el alias, lo guarda y alerta a Juan una vez", async () => {
  const { lead, log, deps } = mundo({ seguimiento: { pausa_transferencia: { at: T0.toISOString(), advisor_id: DAIANA.id, reaviso_at: mas(30).toISOString() } } });
  const c = cand(lead);
  assert.equal(await p.atenderPausa({ org: ORG, c, ahora: mas(121) }, deps), "devuelta");
  assert.deepEqual(log.modos, [{ id: "conv-1", modo: "bot" }]);
  assert.equal(log.envios.length, 1);
  assert.equal(log.envios[0].tel, lead.phone);
  assert.equal(log.envios[0].texto, "Sigo pendiente de ti mientras Asesor 1 se desocupa. ¿En qué te puedo ayudar mientras tanto?");
  const guardado = log.mensajes.find((m) => m.role === "assistant");
  assert.equal(guardado.content, log.envios[0].texto);
  assert.equal(guardado.extras.wa_message_id, "wamid.S");
  assert.deepEqual(log.entregas, [{ id: "m1", estado: "sent" }]);
  assert.equal(log.alertas.length, 1);
  assert.match(log.alertas[0], /Transferencia sin respuesta: lead lead-1/);
  assert.doesNotMatch(log.alertas[0], /3125550000|Laura/, "sin datos del cliente");
  assert.equal(lead.seguimiento.pausa_transferencia, undefined, "la marca se borra: no se repite");
  assert.equal(await p.atenderPausa({ org: ORG, c, ahora: mas(200) }, deps), "nada");
  assert.equal(log.alertas.length, 1);
});

test("a las 2 h fuera de la ventana de 24 h: no le escribe al cliente, solo vuelve a Sofi y alerta", async () => {
  const { lead, log, deps } = mundo({ seguimiento: { pausa_transferencia: { at: T0.toISOString(), advisor_id: DAIANA.id } } });
  const c = cand(lead, { ultimoCliente: { created_at: mas(-25 * 60).toISOString() } });
  assert.equal(await p.atenderPausa({ org: ORG, c, ahora: mas(121) }, deps), "devuelta");
  assert.equal(log.envios.length, 0);
  assert.equal(log.mensajes.filter((m) => m.role === "assistant").length, 0);
  assert.deepEqual(log.modos, [{ id: "conv-1", modo: "bot" }]);
  assert.equal(log.alertas.length, 1);
  assert.match(log.alertas[0], /fuera de la ventana de 24 h/);
});

test("si no se puede volver a modo bot, la marca queda para reintentar y no se alerta", async () => {
  const { lead, log, deps } = mundo({ seguimiento: { pausa_transferencia: { at: T0.toISOString() } } });
  deps.setModo = async () => { throw new Error("db"); };
  await assert.rejects(p.atenderPausa({ org: ORG, c: cand(lead), ahora: mas(121) }, deps));
  assert.ok(lead.seguimiento.pausa_transferencia);
  assert.equal(log.alertas.length, 0);
  assert.equal(log.envios.length, 0);
});

test("si la asesora ya escribio (mensaje posterior a la marca), se limpia y no pasa nada mas", async () => {
  const { lead, log, deps } = mundo({ seguimiento: { pausa_transferencia: { at: T0.toISOString() } } });
  const c = cand(lead, { ultimoAsistente: { created_at: mas(10).toISOString() } });
  assert.equal(await p.atenderPausa({ org: ORG, c, ahora: mas(200) }, deps), "limpiada");
  assert.equal(lead.seguimiento.pausa_transferencia, undefined);
  assert.equal(log.avisos.length + log.modos.length + log.alertas.length, 0);
});

test("marcar y limpiar: leen el lead fresco y limpiar no escribe si no hay marca", async () => {
  const { lead, log, deps } = mundo({ seguimiento: { espera_alertada_msg_id: "m9" } });
  assert.equal(await p.marcar({ orgId: ORG.id, leadId: lead.id, convId: "conv-1", advisorId: DAIANA.id, ahora: T0 }, deps), true);
  assert.deepEqual(lead.seguimiento, { espera_alertada_msg_id: "m9", pausa_transferencia: { at: T0.toISOString(), conversation_id: "conv-1", advisor_id: DAIANA.id } });
  assert.equal(await p.limpiar({ orgId: ORG.id, leadId: lead.id }, deps), true);
  assert.deepEqual(lead.seguimiento, { espera_alertada_msg_id: "m9" });
  const antes = log.updates.length;
  assert.equal(await p.limpiar({ orgId: ORG.id, leadId: lead.id }, deps), false);
  assert.equal(log.updates.length, antes, "sin marca no escribe");
});

test("limpiar nunca lanza", async () => {
  const r = await p.limpiar({ orgId: ORG.id, leadId: "x" }, { leerLead: async () => { throw new Error("db"); } });
  assert.equal(r, false);
});
