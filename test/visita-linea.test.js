// Interes o visita de un colega en la linea del radar (src/groups/visita-linea.js,
// Juan 2026-10-20): aviso por la campana del CRM y la visita queda como cita.
const { test } = require("node:test");
const assert = require("node:assert");
const visitaLinea = require("../src/groups/visita-linea");
const leads = require("../src/data/leads");
const advisors = require("../src/data/advisors");
const whatsappGroups = require("../src/data/whatsapp-groups");
const notif = require("../src/notifications/notificar");

const ORG = { id: "org-1", name: "Diamond" };
const DAIANA = { id: "adv-daiana", name: "Daiana Zea", auth_user_id: "auth-daiana", activo: true };
const datos = (tipo, extra = {}) => ({
  mensaje: { sesion: "DaianaDiamond", remitenteNombre: "Laura", remitenteTelefono: null, texto: "el cliente puede el lunes a las 4" },
  veredicto: { hay_avance: true, tipo, fecha_hora_iso: "2026-10-26T16:00:00-05:00", resumen: "El cliente puede el lunes a las 4 pm", confianza: 0.9 },
  señal: { id: "sig-1", respuesta_refs: ["10505566"] },
  identidad: { telefono: null, lid: "276467766300904@lid" },
  ...extra,
});

function escenario(t, { lead = { id: "lead-1", nombre: null } } = {}) {
  const log = { notif: [], updates: [], creados: [] };
  t.mock.method(whatsappGroups, "sesionPorNombre", async () => ({ nombre: "DaianaDiamond", advisor_id: "adv-daiana" }));
  t.mock.method(advisors, "findById", async () => DAIANA);
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => null);
  t.mock.method(leads, "findOrCreate", async (orgId, phone, source) => { log.creados.push({ phone, source }); return lead; });
  t.mock.method(leads, "update", async (id, patch) => { log.updates.push({ id, patch }); return { ...lead, ...patch }; });
  t.mock.method(notif, "notificar", async (n) => { log.notif.push(n); return { ok: true, push: 0 }; });
  return log;
}

test("'agendando' deja una cita propuesta de la linea y avisa a Daiana en la campana", async (t) => {
  const log = escenario(t);
  const r = await visitaLinea.avisar(ORG, datos("agendando"));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.leadId, "lead-1");
  assert.deepStrictEqual(log.creados, [{ phone: "276467766300904@lid", source: "colega" }]);
  const cita = log.updates[0].patch.cita;
  assert.strictEqual(cita.estado, "propuesta");
  assert.strictEqual(cita.origen, "linea_dm");
  assert.strictEqual(cita.asesor_id, "adv-daiana");
  assert.strictEqual(cita.ref, "10505566");
  assert.strictEqual(cita.fecha_hora, "2026-10-26T16:00:00-05:00");
  assert.strictEqual(log.updates[0].patch.nombre, "Laura");
  const n = log.notif[0];
  assert.strictEqual(n.advisor, DAIANA);
  assert.strictEqual(n.tipo, "visita_colega");
  assert.strictEqual(n.link, "/pendientes");
  assert.strictEqual(n.leadId, "lead-1");
  assert.match(n.cuerpo, /Laura/);
  assert.match(n.cuerpo, /ref 10505566/);
});

test("'cita_confirmada' queda confirmada", async (t) => {
  const log = escenario(t);
  await visitaLinea.avisar(ORG, datos("cita_confirmada"));
  assert.strictEqual(log.updates[0].patch.cita.estado, "confirmada");
  assert.ok(log.updates[0].patch.cita.confirmada_at);
});

test("'interes_avanzado' avisa pero no crea cita", async (t) => {
  const log = escenario(t);
  const r = await visitaLinea.avisar(ORG, datos("interes_avanzado"));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(log.updates.length, 0);
  assert.strictEqual(log.notif[0].tipo, "interes_colega");
  assert.strictEqual(log.notif[0].link, "/grupos");
});

test("sin dueña de la linea cae a la asesora principal del radar; sin ninguna, no avisa", async (t) => {
  const log = escenario(t);
  t.mock.method(whatsappGroups, "sesionPorNombre", async () => null);
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => DAIANA);
  assert.strictEqual((await visitaLinea.avisar(ORG, datos("interes_avanzado"))).ok, true);
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => null);
  assert.deepStrictEqual(await visitaLinea.avisar(ORG, datos("interes_avanzado")), { ok: false, motivo: "sin_asesora" });
  assert.strictEqual(log.notif.length, 1);
});

test("un lead que ya tiene nombre no se pisa", async (t) => {
  const log = escenario(t, { lead: { id: "lead-2", nombre: "Laura Gómez" } });
  await visitaLinea.avisar(ORG, datos("agendando"));
  assert.ok(!("nombre" in log.updates[0].patch));
});

test("la escalera de rotacion no toma las visitas de la linea", async () => {
  const memory = require("../src/data/memory");
  const antes = memory.leads.length;
  memory.leads.push(
    { id: "l-linea", org_id: "org-1", cita: { asesor_id: "a", estado: "propuesta", origen: "linea_dm" } },
    { id: "l-sofi", org_id: "org-1", cita: { asesor_id: "a", estado: "propuesta" } }
  );
  try {
    const ids = (await leads.listCitasPropuestasEnRotacion()).map((l) => l.id);
    assert.ok(ids.includes("l-sofi"));
    assert.ok(!ids.includes("l-linea"));
  } finally {
    memory.leads.splice(antes);
  }
});
