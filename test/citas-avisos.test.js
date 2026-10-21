// Citas a tiempo (brief citas-avisos, Juan 2026-10-21): las vencidas salen
// solas, recordatorio 1 h antes a la asesora de la rotacion, aviso repetido a
// los 15 min y el tiempo que le queda a cada cita en el CRM.
const { test, beforeEach, describe } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const cv = require("../src/lib/citas-vencidas");
const escalera = require("../src/scheduler/citas-escalera");
const reminders = require("../src/scheduler/reminders");
const tiempo = require("../crm/lib/cita-tiempo.ts");

const ORG = memory.organizations[0];
const H = { dias: [0, 1, 2, 3, 4, 5, 6], desde: "08:00", hasta: "18:00" };
const A1 = { id: "a1", org_id: ORG.id, name: "Daiana Zea", phone: "573011880668", alias_publico: "Asesor 1", activo: true, recibe_citas: true, orden_citas: 1, horario: H, auth_user_id: "u1" };
const A2 = { id: "a2", org_id: ORG.id, name: "Claudia Valencia", phone: "573000008113", alias_publico: "Asesor 2", activo: true, recibe_citas: true, orden_citas: 2, horario: H };

let advisorsOriginales;
let leadsOriginales;
beforeEach(() => {
  if (!advisorsOriginales) advisorsOriginales = [...memory.advisors];
  if (!leadsOriginales) leadsOriginales = [...memory.leads];
  memory.leads.length = 0;
  memory.advisors.length = 0;
  memory.advisors.push({ ...A1 }, { ...A2 });
});

// ---------- 1. Vencidas ----------
describe("vencidas", () => {
  const nueva = { estado: "propuesta", fecha_hora: "2026-10-22T15:00:00Z", asesor_id: "a1" };
  const vieja = { estado: "solicitada", fecha_hora: "2026-09-23T20:00:00Z", ref: "10031500" };

  test("una cita nueva cuya hora paso es vencida", () => {
    assert.strictEqual(cv.esVencida(nueva, { ahora: new Date("2026-10-22T15:00:00Z"), antiguas: false }), true);
    assert.strictEqual(cv.esVencida(nueva, { ahora: new Date("2026-10-22T14:59:00Z"), antiguas: false }), false);
  });

  test("solicitada, propuesta y por_confirmar cuentan; confirmada/cancelada/vencida no", () => {
    const ahora = new Date("2026-10-23T00:00:00Z");
    for (const estado of ["solicitada", "propuesta", "por_confirmar"]) assert.strictEqual(cv.esVencida({ ...nueva, estado }, { ahora, antiguas: false }), true, estado);
    for (const estado of ["confirmada", "cancelada", "vencida", "reprogramada", undefined]) assert.strictEqual(cv.esVencida({ ...nueva, estado }, { ahora, antiguas: false }), false, String(estado));
  });

  test("las antiguas (antes del 21-oct, hora Bogota) quedan bloqueadas sin el interruptor", () => {
    const ahora = new Date("2026-10-21T15:00:00Z");
    assert.strictEqual(cv.esVencida(vieja, { ahora, antiguas: false }), false);
    assert.strictEqual(cv.esVencida(vieja, { ahora, antiguas: true }), true);
    // 20-oct 11:59 p. m. en Bogota todavia es antigua; 21-oct 00:00 ya no.
    assert.strictEqual(cv.esAntigua({ fecha_hora: "2026-10-21T04:59:00Z" }), true);
    assert.strictEqual(cv.esAntigua({ fecha_hora: "2026-10-21T05:00:00Z" }), false);
  });

  test("el interruptor se lee de CITAS_VENCER_ANTIGUAS", () => {
    const antes = process.env.CITAS_VENCER_ANTIGUAS;
    try {
      delete process.env.CITAS_VENCER_ANTIGUAS;
      assert.strictEqual(cv.esVencida(vieja, { ahora: new Date("2026-10-21T15:00:00Z") }), false);
      process.env.CITAS_VENCER_ANTIGUAS = "true";
      assert.strictEqual(cv.esVencida(vieja, { ahora: new Date("2026-10-21T15:00:00Z") }), true);
    } finally {
      if (antes === undefined) delete process.env.CITAS_VENCER_ANTIGUAS;
      else process.env.CITAS_VENCER_ANTIGUAS = antes;
    }
  });

  test("patchVencida no borra nada y limpia el pendiente de visita", () => {
    const lead = { id: "l1", atencion_pendiente: "visita", cita: { ...nueva, ref: "9" } };
    const p = cv.patchVencida(lead, { ahora: new Date("2026-10-22T16:00:00Z") });
    assert.strictEqual(p.cita.estado, "vencida");
    assert.strictEqual(p.cita.estado_anterior, "propuesta");
    assert.strictEqual(p.cita.vencida_at, "2026-10-22T16:00:00.000Z");
    assert.strictEqual(p.cita.ref, "9");
    assert.strictEqual(p.cita.asesor_id, "a1");
    assert.strictEqual(p.atencion_pendiente, null);
    const otro = cv.patchVencida({ id: "l2", atencion_pendiente: "pide_asesor", cita: nueva });
    assert.ok(!("atencion_pendiente" in otro), "otro pendiente no se toca");
  });

  test("la escalera marca la vencida nueva, no la antigua, y no le escribe a nadie", async () => {
    const enviados = [];
    memory.leads.push(
      { id: "nueva", org_id: ORG.id, phone: "573100000001", atencion_pendiente: "visita", cita: { estado: "propuesta", fecha_hora: "2026-10-22T15:00:00Z", origen: "linea_dm" } },
      { id: "vieja", org_id: ORG.id, phone: "573100000002", source: "colega", atencion_pendiente: "visita", cita: { ...vieja } },
      { id: "futura", org_id: ORG.id, phone: "573100000003", cita: { estado: "propuesta", fecha_hora: "2026-10-25T15:00:00Z" } }
    );
    const antes = process.env.CITAS_VENCER_ANTIGUAS;
    delete process.env.CITAS_VENCER_ANTIGUAS;
    try {
      const r = await escalera.runOnce({
        ahora: new Date("2026-10-22T16:00:00Z"),
        deps: {
          aviso: async () => { enviados.push("aviso"); return { ok: true }; },
          texto: async () => { enviados.push("texto"); return { ok: true }; },
          plantilla: async () => { enviados.push("plantilla"); return { ok: true }; },
          org: async () => ORG,
          notificar: async () => { enviados.push("nota"); return { ok: true }; },
          reaviso: async () => { enviados.push("reaviso"); return { ok: true }; },
        },
      });
      assert.strictEqual(r.vencidas, 1);
    } finally {
      if (antes !== undefined) process.env.CITAS_VENCER_ANTIGUAS = antes;
    }
    const porId = (id) => memory.leads.find((l) => l.id === id);
    assert.strictEqual(porId("nueva").cita.estado, "vencida");
    assert.strictEqual(porId("nueva").atencion_pendiente, null);
    assert.strictEqual(porId("vieja").cita.estado, "solicitada", "la antigua espera el OK de Juan");
    assert.strictEqual(porId("vieja").atencion_pendiente, "visita");
    assert.strictEqual(porId("futura").cita.estado, "propuesta");
    assert.deepStrictEqual(enviados, [], "nada al cliente ni a la asesora");
  });

  test("marcarVencidas es idempotente", async () => {
    memory.leads.push({ id: "n", org_id: ORG.id, phone: "1", cita: { estado: "propuesta", fecha_hora: "2026-10-22T15:00:00Z" } });
    const ahora = new Date("2026-10-22T16:00:00Z");
    assert.strictEqual((await cv.marcarVencidas({ ahora, deps: { antiguas: false } })).vencidas, 1);
    const marca = memory.leads[0].cita.vencida_at;
    assert.strictEqual((await cv.marcarVencidas({ ahora: new Date("2026-10-22T17:00:00Z"), deps: { antiguas: false } })).vencidas, 0);
    assert.strictEqual(memory.leads[0].cita.vencida_at, marca);
  });
});

// ---------- 2. Recordatorio 1 h antes, rotacion ----------
describe("recordatorio a la asesora de la rotacion", () => {
  const NOW = Date.parse("2026-10-22T14:00:00Z"); // 9:00 a. m. Bogota
  const citaRot = (over = {}) => ({
    estado: "confirmada", tipo: "visita", fecha_hora: new Date(NOW + 45 * 60000).toISOString(), ref: "10031500",
    asesor_id: "a2", advisor_id: null, confirmada_por: "Claudia Valencia", ...over,
  });
  function deps(log) {
    return {
      notificar: async (n) => { log.push({ nota: n.tipo, a: n.advisor.id, titulo: n.titulo }); return { ok: true }; },
      plantilla: async (_o, to, opts) => { log.push({ to, plantilla: opts.name, params: opts.bodyParams }); return { ok: true }; },
    };
  }

  test("sale una sola vez, por campana y por recordatorio_cita, a la asesora sin usuario del CRM", async () => {
    const log = [];
    memory.leads.push({ id: "r1", org_id: ORG.id, source: "colega", phone: "573100000009", nombre: null, cita: citaRot() });
    await reminders.runOnce({ deps: deps(log), nowMs: NOW });
    await reminders.runOnce({ deps: deps(log), nowMs: NOW + 10 * 60000 });
    const notas = log.filter((x) => x.nota);
    const plantillas = log.filter((x) => x.plantilla);
    assert.strictEqual(notas.length, 1);
    assert.strictEqual(notas[0].a, "a2");
    assert.match(notas[0].titulo, /un colega/);
    assert.strictEqual(plantillas.length, 1);
    assert.strictEqual(plantillas[0].to, "573000008113");
    assert.strictEqual(plantillas[0].plantilla, "recordatorio_cita");
    assert.strictEqual(plantillas[0].params[0], "Claudia Valencia");
    assert.strictEqual(plantillas[0].params[2], "un colega");
    assert.ok(!plantillas[0].params.some((p) => String(p).includes("573100000009")), "sin el telefono del cliente");
    assert.ok(memory.leads[0].cita.recordatorio_asesor_at);
  });

  test("una propuesta de la rotacion no se recuerda, ni fuera de la ventana", async () => {
    const log = [];
    memory.leads.push(
      { id: "p", org_id: ORG.id, phone: "1", cita: citaRot({ estado: "propuesta" }) },
      { id: "lejos", org_id: ORG.id, phone: "2", cita: citaRot({ fecha_hora: new Date(NOW + 3 * 3600e3).toISOString() }) }
    );
    await reminders.runOnce({ deps: deps(log), nowMs: NOW });
    assert.deepStrictEqual(log, []);
  });

  test("la rotacion confirmada por quien tiene usuario no sale dos veces (camino viejo + nuevo)", async () => {
    const log = [];
    memory.leads.push({ id: "r2", org_id: ORG.id, phone: "3", nombre: "Laura", cita: citaRot({ asesor_id: "a1", advisor_id: "u1" }) });
    await reminders.runOnce({ deps: deps(log), nowMs: NOW });
    assert.strictEqual(log.filter((x) => x.plantilla).length, 1);
    assert.strictEqual(log.filter((x) => x.plantilla)[0].params[2], "Laura");
  });

  test("una asesora dada de baja no recibe el recordatorio", async () => {
    const log = [];
    memory.advisors.find((a) => a.id === "a2").activo = false;
    memory.leads.push({ id: "r3", org_id: ORG.id, phone: "4", cita: citaRot() });
    await reminders.runOnce({ deps: deps(log), nowMs: NOW });
    assert.deepStrictEqual(log, []);
  });
});

// ---------- 3. Aviso repetido a los 15 min ----------
describe("aviso repetido a los 15 min", () => {
  const cita = (over = {}) => ({
    estado: "propuesta", fecha_hora: "2026-10-24T20:00:00Z", corte_at: "2026-10-24T16:00:00Z", ref: "777",
    creada_at: "2026-10-22T14:00:00Z", asignada_at: "2026-10-22T14:00:00Z", asesor_id: "a1",
    historial: [{ asesor_id: "a1", desde: "2026-10-22T14:00:00Z" }], ...over,
  });
  const lead = (over = {}) => ({ id: "l1", org_id: ORG.id, nombre: "Laura", phone: "573125550000", source: "colega", cita: cita(over) });
  const t = (iso) => new Date(iso);

  test("a los 14 min no, a los 15 si", () => {
    assert.strictEqual(escalera.tocaReaviso({ lead: lead(), ahora: t("2026-10-22T14:14:00Z") }), false);
    assert.strictEqual(escalera.tocaReaviso({ lead: lead(), ahora: t("2026-10-22T14:15:00Z") }), true);
  });

  test("uno por asignacion: con reaviso_at posterior a la asignacion ya no", () => {
    assert.strictEqual(escalera.tocaReaviso({ lead: lead({ reaviso_at: "2026-10-22T14:15:00Z" }), ahora: t("2026-10-22T14:40:00Z") }), false);
  });

  test("si rota, el contador vuelve a empezar con la nueva asesora", () => {
    const l = lead({ asesor_id: "a2", asignada_at: "2026-10-22T15:00:00Z", reaviso_at: "2026-10-22T14:15:00Z" });
    assert.strictEqual(escalera.tocaReaviso({ lead: l, ahora: t("2026-10-22T15:10:00Z") }), false);
    assert.strictEqual(escalera.tocaReaviso({ lead: l, ahora: t("2026-10-22T15:15:00Z") }), true);
  });

  test("respeta la pausa de 8 p. m. a 8 a. m. (Bogota)", () => {
    const l = lead({ asignada_at: "2026-10-23T00:50:00Z" }); // 7:50 p. m.
    assert.strictEqual(escalera.tocaReaviso({ lead: l, ahora: t("2026-10-23T01:05:00Z") }), false, "8:05 p. m.");
    assert.strictEqual(escalera.tocaReaviso({ lead: l, ahora: t("2026-10-23T12:59:00Z") }), false, "7:59 a. m.");
    assert.strictEqual(escalera.tocaReaviso({ lead: l, ahora: t("2026-10-23T13:00:00Z") }), true, "8:00 a. m.");
  });

  test("no despues del corte ni en citas confirmadas", () => {
    assert.strictEqual(escalera.tocaReaviso({ lead: lead({ corte_at: "2026-10-22T14:10:00Z" }), ahora: t("2026-10-22T14:20:00Z") }), false);
    assert.strictEqual(escalera.tocaReaviso({ lead: lead({ estado: "confirmada" }), ahora: t("2026-10-22T14:20:00Z") }), false);
  });

  test("runOnce manda UN aviso repetido a la misma asesora y no rota", async () => {
    const avisos = [];
    memory.leads.push(lead());
    const deps = {
      aviso: async () => { avisos.push("aviso-nuevo"); return { ok: true }; },
      plantilla: async () => { avisos.push("plantilla"); return { ok: true }; },
      org: async () => ORG,
      notificar: async () => { avisos.push("nota"); return { ok: true }; },
      reaviso: async (a) => { avisos.push({ a: a.advisor.id, motivo: a.motivo, titulo: a.titulo }); return { ok: true }; },
    };
    await escalera.runOnce({ ahora: t("2026-10-22T14:16:00Z"), deps });
    await escalera.runOnce({ ahora: t("2026-10-22T14:21:00Z"), deps });
    assert.strictEqual(avisos.length, 1);
    assert.strictEqual(avisos[0].a, "a1");
    assert.strictEqual(avisos[0].motivo, "visita");
    assert.match(avisos[0].titulo, /^Sigue pendiente: visita por confirmar \(Ref 777, /);
    assert.strictEqual(memory.leads[0].cita.asesor_id, "a1", "el paso de 60 min no cambia");
    assert.strictEqual(memory.leads[0].cita.reaviso_at, "2026-10-22T14:16:00.000Z");
  });

  test("al rotar se borra reaviso_at", async () => {
    memory.leads.push(lead({ reaviso_at: "2026-10-22T14:15:00Z" }));
    const deps = { aviso: async () => ({ ok: true }), org: async () => ORG, notificar: async () => ({ ok: true }), reaviso: async () => ({ ok: true }) };
    await escalera.runOnce({ ahora: t("2026-10-22T15:01:00Z"), deps });
    assert.strictEqual(memory.leads[0].cita.asesor_id, "a2");
    assert.strictEqual(memory.leads[0].cita.reaviso_at, null);
  });
});

// ---------- 4. Tiempo restante (CRM, pura) ----------
describe("tiempo restante de la cita (crm/lib/cita-tiempo.ts)", () => {
  const ms = (iso) => Date.parse(iso);
  const base = { estado: "propuesta", fecha_hora: "2026-10-24T20:00:00Z", asignada_at: "2026-10-22T14:00:00Z", corte_at: "2026-10-24T16:00:00Z" };

  test("pasa a la siguiente asesora a la hora de asignada", () => {
    const r = tiempo.tiempoRestante(base, ms("2026-10-22T14:20:00Z"));
    assert.strictEqual(r.texto, "Pasa a la siguiente asesora en 40 min");
    assert.strictEqual(r.urgente, false);
  });

  test("menos de 15 min va urgente (rojo)", () => {
    const r = tiempo.tiempoRestante(base, ms("2026-10-22T14:46:00Z"));
    assert.strictEqual(r.texto, "Pasa a la siguiente asesora en 14 min");
    assert.strictEqual(r.urgente, true);
  });

  test("si el paso cae en la pausa nocturna, corre a las 8 a. m.", () => {
    const r = tiempo.tiempoRestante({ ...base, asignada_at: "2026-10-23T00:30:00Z" }, ms("2026-10-23T00:40:00Z")); // 7:30 p. m. -> 8:30 p. m.
    assert.strictEqual(r.evento, "rotar");
    // de 7:40 p. m. a 8:00 a. m. = 12 h 20 min
    assert.strictEqual(r.texto, "Pasa a la siguiente asesora en 12 h 20 min");
  });

  test("si el corte llega antes que el paso, se cancela", () => {
    const r = tiempo.tiempoRestante({ ...base, asignada_at: "2026-10-24T14:30:00Z" }, ms("2026-10-24T14:40:00Z"));
    assert.strictEqual(r.evento, "rotar");
    assert.strictEqual(r.texto, "Pasa a la siguiente asesora en 50 min");
    const c = { ...base, asignada_at: "2026-10-24T15:30:00Z" };
    const r2 = tiempo.tiempoRestante(c, ms("2026-10-24T15:40:00Z"));
    assert.strictEqual(r2.evento, "cortar");
    assert.strictEqual(r2.texto, "Se cancela en 20 min");
    assert.strictEqual(r2.urgente, false);
    const r3 = tiempo.tiempoRestante({ ...base, asignada_at: null }, ms("2026-10-24T13:00:00Z"));
    assert.strictEqual(r3.texto, "Se cancela en 3 h");
  });

  test("corte de noche: se cancela aunque la escalera este pausada", () => {
    const c = { ...base, asignada_at: "2026-10-24T00:30:00Z", corte_at: "2026-10-24T03:00:00Z" }; // corte 10 p. m.
    const r = tiempo.tiempoRestante(c, ms("2026-10-24T01:00:00Z"));
    assert.strictEqual(r.evento, "cortar");
    assert.strictEqual(r.texto, "Se cancela en 2 h");
  });

  test("las viejas (sin asignada_at ni corte_at), las vencidas y las confirmadas no muestran contador", () => {
    assert.strictEqual(tiempo.tiempoRestante({ estado: "propuesta", fecha_hora: "2026-10-24T20:00:00Z" }, ms("2026-10-22T14:00:00Z")), null);
    assert.strictEqual(tiempo.tiempoRestante(base, ms("2026-10-24T20:01:00Z")), null);
    assert.strictEqual(tiempo.tiempoRestante({ ...base, estado: "confirmada" }, ms("2026-10-22T14:20:00Z")), null);
  });

  test("vencidaSinConfirmar espeja al bot", () => {
    assert.strictEqual(tiempo.vencidaSinConfirmar({ estado: "solicitada", fecha_hora: "2026-09-23T20:00:00Z" }, ms("2026-10-21T12:00:00Z")), true);
    assert.strictEqual(tiempo.vencidaSinConfirmar({ estado: "confirmada", fecha_hora: "2026-09-23T20:00:00Z" }, ms("2026-10-21T12:00:00Z")), false);
    assert.strictEqual(tiempo.vencidaSinConfirmar({ estado: "propuesta", fecha_hora: "2026-10-23T20:00:00Z" }, ms("2026-10-21T12:00:00Z")), false);
    assert.deepStrictEqual(tiempo.ESTADOS_PENDIENTES, cv.ESTADOS_PENDIENTES);
  });
});

test("restaura la memoria compartida", () => {
  memory.leads.length = 0;
  memory.leads.push(...(leadsOriginales || []));
  memory.advisors.length = 0;
  memory.advisors.push(...(advisorsOriginales || []));
});
