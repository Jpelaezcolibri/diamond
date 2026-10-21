// TRANSFERENCIAS SIN HUECOS Y AVISOS SOLO POR EL CRM (Juan, 2026-10-21):
// "corrige: número de Natalia, Sofi en pausa al transferir, alerta si no hay
// asesora, avisos por la campana del CRM y notas viejas".
const { test } = require("node:test");
const assert = require("node:assert");

const advisors = require("../src/data/advisors");
const memory = require("../src/data/memory");
const leads = require("../src/data/leads");
const mensajeAsesor = require("../src/lib/mensaje-asesor");
const { entregarConRespaldo } = require("../src/lib/entrega-asesor");
const { instruccionTransferencia } = require("../src/lib/identidad-publica");
const { cerrarTransferencia } = require("../src/lib/transferencia");
const { avisarAsesor, avisarPorCampana } = require("../src/notifications/avisar-asesor");
const { executeTool } = require("../src/agent/tools");

const ORG = { id: "org-th", name: "Diamond" };
// Las filas reales de produccion (2026-10-21), con telefonos de prueba.
const NATALIA = { id: "a-natalia", org_id: ORG.id, name: "Natalia Velez", phone: "573001878024", activo: false, recibe_transferencias: false, auth_user_id: "u-nat", especialidad: "venta" };
const DAIANA_2 = { id: "z-daiana-2", org_id: ORG.id, name: "Daiana Zea (línea 2)", phone: "573001878024", activo: true, recibe_transferencias: false, alias_publico: "Asesor 1", especialidad: "venta" };
const DAIANA = { id: "b-daiana", org_id: ORG.id, name: "Daiana", phone: "573011880668", activo: true, recibe_transferencias: true, auth_user_id: "u-dai", alias_publico: "Asesor 1", especialidad: "venta" };

// ── 1. El 8024 es de Daiana línea 2, nunca de Natalia ─────────────────────

test("el 8024 resuelve a Daiana línea 2 sin importar el orden de las filas", () => {
  for (const lista of [[NATALIA, DAIANA_2], [DAIANA_2, NATALIA]]) {
    assert.strictEqual(advisors.buscarEnLista(lista, "573001878024").id, DAIANA_2.id);
    assert.strictEqual(advisors.destinatarioEnLista(lista, "+57 300 187 8024").id, DAIANA_2.id);
  }
});

test("un telefono que solo es de una fila inactiva se reconoce, pero no es destinatario", () => {
  assert.strictEqual(advisors.buscarEnLista([NATALIA], "573001878024").id, NATALIA.id, "sigue sin ser un cliente");
  assert.strictEqual(advisors.destinatarioEnLista([NATALIA], "573001878024"), null);
});

test("findDestinatarioByPhone descarta la fila inactiva", async (t) => {
  t.mock.method(advisors, "findByPhone", async () => NATALIA);
  assert.strictEqual(await advisors.findDestinatarioByPhone(ORG.id, "573001878024"), null);
});

test("findAsesorPrincipalRadar nunca devuelve una asesora dada de baja", async (t) => {
  const previo = process.env.RADAR_REVISOR_PHONE;
  process.env.RADAR_REVISOR_PHONE = "573001878024";
  memory.advisors.push(NATALIA, DAIANA);
  t.after(() => {
    for (const a of [NATALIA, DAIANA]) memory.advisors.splice(memory.advisors.indexOf(a), 1);
    if (previo === undefined) delete process.env.RADAR_REVISOR_PHONE;
    else process.env.RADAR_REVISOR_PHONE = previo;
  });
  const principal = await advisors.findAsesorPrincipalRadar(ORG);
  assert.notStrictEqual(principal.id, NATALIA.id);
  assert.strictEqual(principal.id, DAIANA.id, "cae a la rotacion");
});

test("respaldo de entrega: el 8024 llega a Daiana línea 2; un numero solo de una inactiva no recibe nada", async (t) => {
  const CERRADA = "(#131047) Message failed to send because more than 24 hours have passed";
  const previo = process.env.RADAR_ESCALADO_PHONE;
  process.env.RADAR_ESCALADO_PHONE = "573001878024";
  t.after(() => {
    if (previo === undefined) delete process.env.RADAR_ESCALADO_PHONE;
    else process.env.RADAR_ESCALADO_PHONE = previo;
  });
  t.mock.method(advisors, "listElegibles", async () => []);
  const enviados = [];
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, tel) => {
    enviados.push(tel);
    return tel === DAIANA.phone ? { ok: false, error: CERRADA } : { ok: true };
  });

  let filas = [NATALIA, DAIANA_2];
  t.mock.method(advisors, "findByPhone", async (orgId, tel) => advisors.buscarEnLista(filas, tel));
  const r = await entregarConRespaldo(ORG, DAIANA, "aviso");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.advisor.id, DAIANA_2.id);

  enviados.length = 0;
  filas = [NATALIA];
  const r2 = await entregarConRespaldo(ORG, DAIANA, "aviso");
  assert.strictEqual(r2.ok, false);
  assert.deepStrictEqual(enviados, [DAIANA.phone], "a la inactiva no se le intenta");
});

test("avisarAsesor no le avisa a un asesor dado de baja", async () => {
  const llamadas = [];
  const d = {
    actualizarLead: async () => llamadas.push("lead"),
    conversacion: async () => "c1",
    notificar: async () => llamadas.push("campana"),
    plantilla: async () => llamadas.push("plantilla"),
    texto: async () => llamadas.push("texto"),
  };
  const r = await avisarAsesor({ org: ORG, advisor: NATALIA, motivo: "aviso", lead: { id: "l1" }, titulo: "x" }, d);
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(llamadas, []);
});

// ── 2 y 3. Pausa al transferir / alerta si no hay asesora ─────────────────

function depsCierre(avisoOk = true) {
  const log = { avisos: [], modos: [], notas: [], leads: [], alertas: [] };
  return {
    log,
    d: {
      avisarAsesor: async (a) => {
        log.avisos.push(a);
        return avisoOk ? { ok: true } : { ok: false, error: "falló" };
      },
      setModo: async (id, modo) => log.modos.push({ id, modo }),
      nota: async (id, role, texto) => log.notas.push({ id, role, texto }),
      actualizarLead: async (id, patch) => log.leads.push({ id, patch }),
      alertaTecnica: async (resumen, detalle) => log.alertas.push(`${resumen} ${detalle}`),
    },
  };
}
const LEAD = { id: "lead-7", nombre: "Laura", phone: "573125550000" };

test("transferencia con asesora: campana con el resumen y Sofi en pausa (modo humano)", async () => {
  const { log, d } = depsCierre();
  const transfer = { advisor: DAIANA, motivo: "calificado", especialidad: "venta", advisorAlert: "Nuevo lead … Numero: +573125550000", conversationId: "conv-1" };
  const r = await cerrarTransferencia({ org: ORG, transfer, lead: LEAD, telefonoCliente: LEAD.phone }, d);
  assert.deepStrictEqual(r, { ok: true, pausada: true, error: null });
  assert.strictEqual(log.avisos[0].motivo, "transferido");
  assert.match(log.avisos[0].cuerpo, /Nuevo lead/, "el resumen va en la campana");
  assert.deepStrictEqual(log.modos, [{ id: "conv-1", modo: "humano" }]);
  assert.match(log.notas[0].texto, /pausa/);
  assert.strictEqual(log.alertas.length, 0);
});

test("transferencia sin asesora (respaldo de la org sin id): alerta a Juan sin telefono, Para atender, Sofi sigue", async () => {
  const { log, d } = depsCierre();
  const transfer = { advisor: { name: "Asesor", phone: "573000000000", especialidad: "general" }, motivo: "pide asesor", especialidad: "venta", conversationId: "conv-2" };
  const r = await cerrarTransferencia({ org: ORG, transfer, lead: LEAD, telefonoCliente: LEAD.phone }, d);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(log.avisos.length, 0, "no hay a quien avisarle por la campana");
  assert.strictEqual(log.modos.length, 0, "sin nadie que lo atienda, Sofi no se pausa");
  assert.strictEqual(log.leads[0].patch.atencion_pendiente, "transferido");
  assert.strictEqual(log.alertas.length, 1);
  assert.match(log.alertas[0], /Transferencia sin asesora: lead lead-7/);
  assert.doesNotMatch(log.alertas[0], /3125550000|Laura/);
});

test("si el aviso a la asesora falla, tambien hay alerta y no hay pausa", async () => {
  const { log, d } = depsCierre(false);
  const r = await cerrarTransferencia({ org: ORG, transfer: { advisor: DAIANA, conversationId: "c" }, lead: LEAD }, d);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(log.modos.length, 0);
  assert.strictEqual(log.alertas.length, 1);
});

test("sin asesora, Sofi no dice que ya alertaron a alguien", () => {
  const sin = instruccionTransferencia({ especialidad: "venta", advisor: { name: "Asesor", phone: "1" }, org: ORG });
  assert.doesNotMatch(sin, /ya fue alertado/i);
  assert.match(sin, /alguien del equipo/);
  const con = instruccionTransferencia({ especialidad: "venta", advisor: DAIANA, org: ORG });
  assert.match(con, /ya fue alertado/i);
  assert.match(con, /Asesor 1/);
});

test("transferir_a_asesor sin ningun asesor igual registra la transferencia, con texto neutral", async (t) => {
  t.mock.method(leads, "update", async (id, patch) => patch);
  t.mock.method(advisors, "findForTransfer", async () => null);
  const ctx = {
    org: { id: "org-1", name: "Diamond" },
    lead: { id: "lead-1", phone: "573001112233", categoria: "compra", estado: "calificado", score: 80 },
    propertyInteres: null, transfer: null, cita: null, allyMatch: null, allyAlert: null, captadorAlert: null,
    lastUserMessage: "quiero un asesor",
  };
  const texto = await executeTool("transferir_a_asesor", { motivo: "pide asesor" }, ctx);
  assert.ok(ctx.transfer, "queda registrada para que el lead quede en Para atender y salga la alerta");
  assert.strictEqual(ctx.transfer.advisor.id, null);
  assert.doesNotMatch(texto, /ya fue alertado/i);
});

// ── 4. Avisos por la campana ──────────────────────────────────────────────

test("avisarPorCampana: el detalle va en el cuerpo de la campana y la cita sin asesora alerta a Juan", async () => {
  const avisos = [];
  const alertas = [];
  const deps = {
    avisar: {
      actualizarLead: async () => {},
      conversacion: async () => "conv-9",
      notificar: async (n) => avisos.push(n),
      plantilla: async () => ({ ok: true }),
      texto: async () => ({ ok: true }),
    },
    alertaTecnica: async (r) => alertas.push(r),
  };
  const ok = await avisarPorCampana({ org: ORG, alerta: { advisor: DAIANA, advisorAlert: "Cliente Laura +573125550000 vio la 10207832" }, motivo: "aviso", lead: LEAD, titulo: "Un cliente se interesó en tu propiedad" }, deps);
  assert.strictEqual(ok.ok, true);
  assert.match(avisos[0].cuerpo, /10207832/);
  assert.strictEqual(avisos[0].link, "/inbox/conv-9", "con link al chat");

  const sin = await avisarPorCampana({ org: ORG, alerta: { advisorId: null, advisorAlert: "cita" }, motivo: "visita", lead: LEAD, titulo: "Visita", que: "cita", alertaTecnicaSiFalla: true }, deps);
  assert.strictEqual(sin.ok, false);
  assert.strictEqual(alertas.length, 1);
});

test("los avisos de captador, aliado y cita de colega llevan la fila del asesor para la campana", () => {
  const fuente = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "agent", "tools.js"), "utf8");
  assert.match(fuente, /ctx\.captadorAlert = \{ advisor, /);
  assert.match(fuente, /ctx\.allyAlert = \{ advisor, /);
  const i = fuente.indexOf("async function armarAvisoCitaColega");
  assert.match(fuente.slice(i, i + 900), /return \{ advisor, /);
});
