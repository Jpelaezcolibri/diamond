// Lo que le llega a la asesora tiene que bastar para atender (Juan, 2026-11-09):
// "valida que siempre pueda ver la información tanto del colega que escribe como
// de la propiedad que estamos ofreciendo más los datos para contactar a dicho
// colega o cliente". Caso Norha Vélez: Catherine confirmó la visita con un
// WhatsApp que solo decía "tienes una visita por confirmar"; no supo quién era
// ni cómo contactarla, y Sofi después le dijo que la visita no existía.
const { test } = require("node:test");
const assert = require("node:assert");

const { textoVisitaAsesora } = require("../src/lib/ficha-visita");
const { avisarAsesor } = require("../src/notifications/avisar-asesor");
const { avisarCitaPorConfirmar } = require("../src/notifications/aviso-cita");
const { buildSystemPrompt } = require("../src/agent/prompts");
const { armarLibro, leerLibro } = require("../src/lib/pendientes-excel");

const ORG = { id: "org-1", name: "Diamond" };
const CATHERINE = { id: "a3", name: "Catherine Uribe", phone: "573028536489", alias_publico: "Asesor 3" };
const PROPIEDAD = {
  ref: "10505674", titulo: "APARTAMENTO EN VENTA, SABANETA", tipo: "Apartamento", operacion: "Venta", zona: "Maria Auxiliadora",
  precio: "$315.000.000", area: "55m2", habitaciones: 3, banos: 2, garaje: 1, estrato: 4,
  linkWasi: "https://info.wasi.co/apartamento-venta-sabaneta-medellin/10505674?shared=whatsapp",
};
const CITA_CONF = { tipo: "visita", ref: "10505674", estado: "confirmada", asesor_id: "a3", fecha_hora: "2026-11-10T10:00:00-05:00", confirmada_por: "Catherine Uribe" };
const CITA_PROP = { ...CITA_CONF, estado: "propuesta", confirmada_por: undefined, corte_at: "2026-11-10T01:00:00Z" };
const NORHA = { id: "lead-norha", phone: "CO.1622610936270244", nombre: null, source: "colega", cita: CITA_CONF };
const ANDRES = { id: "lead-andres", phone: "573001234567", nombre: "Andrés Gómez", source: "whatsapp", cita: CITA_PROP };
const PEDIDO = { texto_original: "Busco para Cliente. Apartamento Área:55 metros Piso medio bajo Sabaneta Itagui Bernal Rodeó alto. Crédito aprobado Presupuesto 360 para negociar.", grupo: "BELÉN A CALDAS 7am 8 pm" };
const CHAT = "https://crm.diamondinmobiliaria.com/inbox/febee380";

// ── 1. La ficha de la visita ──────────────────────────────────────────────

test("la ficha trae cuándo, estado, propiedad con link, quién va, contacto, pedido, pendientes y el chat", () => {
  const t = textoVisitaAsesora({
    lead: NORHA, cita: CITA_CONF, propiedad: PROPIEDAD, pedido: PEDIDO, colega: { nombre: "NORHA VELEZ M" },
    preguntas: ["¿Queda por el sector de Las Lomas?"], chatUrl: CHAT,
  });
  assert.match(t, /CONFIRMADA/);
  assert.match(t, /martes.*10 de noviembre.*10:00/i);
  assert.match(t, /Ref 10505674/);
  assert.match(t, /Maria Auxiliadora/);
  assert.match(t, /\$315\.000\.000/);
  assert.match(t, /55m2|55 m²/);
  assert.match(t, /3 habitaciones · 2 baños · 1 parqueadero/);
  assert.match(t, /https:\/\/info\.wasi\.co\/apartamento-venta-sabaneta-medellin\/10505674\?shared=whatsapp/);
  assert.match(t, /NORHA VELEZ M/);
  assert.match(t, /colega de otra inmobiliaria/i);
  assert.match(t, /Sin celular visible/);
  assert.doesNotMatch(t, /CO\.1622|\+CO/);
  assert.match(t, /Crédito aprobado/);
  assert.match(t, /BELÉN A CALDAS/);
  assert.match(t, /Las Lomas/);
  assert.match(t, new RegExp(CHAT.replace(/[.]/g, "\\.")));
  assert.doesNotMatch(t, /\b(tenés|entrá|confirmala|escribile)\b/, "tuteo, no voseo");
});

test("con celular visible trae el número legible y el link de WhatsApp; por confirmar dice el plazo", () => {
  const t = textoVisitaAsesora({ lead: ANDRES, cita: CITA_PROP, propiedad: PROPIEDAD, chatUrl: CHAT });
  assert.match(t, /POR CONFIRMAR/);
  assert.match(t, /antes de/i);
  assert.match(t, /Andrés Gómez/);
  assert.match(t, /\+57 300 123 4567/);
  assert.match(t, /wa\.me\/573001234567/);
  assert.match(t, /cliente directo/i);
});

test("sin propiedad en la base no inventa: da la ref y lo dice", () => {
  const t = textoVisitaAsesora({ lead: ANDRES, cita: CITA_PROP, propiedad: null, chatUrl: null });
  assert.match(t, /Ref 10505674/);
  assert.match(t, /no encontré la ficha/i);
});

// ── 2. El WhatsApp a la asesora lleva la ficha completa ───────────────────

function depsAvisar({ textoOk = true } = {}) {
  const log = { textos: [], plantillas: [] };
  return {
    log,
    deps: {
      actualizarLead: async () => {},
      conversacion: async () => "conv-1",
      notificar: async () => ({ ok: true, push: 0 }),
      plantilla: async (_o, tel, p) => { log.plantillas.push({ tel, p }); return { ok: true }; },
      texto: async (_o, tel, t) => { log.textos.push({ tel, t }); return textoOk ? { ok: true } : { ok: false, error: "131047 Re-engagement message" }; },
    },
  };
}

test("con detalle, a la asesora le llega la ficha completa por WhatsApp (sin la plantilla corta)", async () => {
  const { log, deps } = depsAvisar();
  const r = await avisarAsesor({ org: ORG, advisor: CATHERINE, motivo: "visita", lead: NORHA, titulo: "Nueva visita por confirmar", detalle: "FICHA COMPLETA Ref 10505674" }, deps);
  assert.ok(r.ok);
  assert.strictEqual(log.textos.length, 1);
  assert.strictEqual(log.textos[0].t, "🔔 *Nueva visita por confirmar*\n\nFICHA COMPLETA Ref 10505674");
  assert.strictEqual(log.plantillas.length, 0);
});

test("con la ventana cerrada, cae a la plantilla corta y la ficha queda en el CRM", async () => {
  const { log, deps } = depsAvisar({ textoOk: false });
  const r = await avisarAsesor({ org: ORG, advisor: CATHERINE, motivo: "visita", lead: NORHA, titulo: "x", detalle: "FICHA" }, deps);
  assert.ok(r.ok);
  assert.strictEqual(log.plantillas.length, 1);
  assert.strictEqual(log.plantillas[0].p.name, "aviso_app");
});

test("el texto corto de respaldo va en tuteo", async () => {
  const { log, deps } = depsAvisar();
  deps.plantilla = async () => ({ ok: false, error: "x" });
  await avisarAsesor({ org: ORG, advisor: CATHERINE, motivo: "aviso", lead: null, titulo: "x" }, deps);
  assert.match(log.textos[0].t, /^Tienes un pendiente/);
  assert.doesNotMatch(log.textos[0].t, /Tenés|Entrá/);
});

test("el aviso de visita por confirmar le manda a la asesora la ficha completa", async () => {
  const llamadas = [];
  await avisarCitaPorConfirmar({
    org: ORG, advisor: CATHERINE, lead: NORHA, cita: CITA_PROP,
    deps: {
      avisar: async (a) => { llamadas.push(a); return { ok: true }; },
      ficha: async () => "FICHA DE NORHA Ref 10505674 Sin celular visible",
    },
  });
  assert.strictEqual(llamadas[0].detalle, "FICHA DE NORHA Ref 10505674 Sin celular visible");
});

test("'quiere hablar con una persona' con visita viva le manda a la asesora la ficha de la visita", async (t) => {
  const tools = require("../src/agent/tools");
  const advisors = require("../src/data/advisors");
  const groupSignals = require("../src/data/group-signals");
  const avisarMod = require("../src/notifications/avisar-asesor");
  tools._resetPedidosContacto();
  const avisos = [];
  t.mock.method(advisors, "findById", async () => CATHERINE);
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => CATHERINE);
  t.mock.method(groupSignals, "buscarPorTelefono", async () => null);
  t.mock.method(avisarMod, "avisarAsesor", async (a) => { avisos.push(a); return { ok: true }; });
  await tools.executeTool("pedir_contacto_asesora", { motivo: "aclarar la visita" }, { org: ORG, lead: NORHA, colega: { nombre: "NORHA VELEZ M" } });
  assert.match(avisos[0].detalle || "", /Ref 10505674/);
  assert.match(avisos[0].detalle || "", /Sin celular visible/);
  assert.match(avisos[0].detalle || "", /Para qué: aclarar la visita/);
});

// ── 3. Sofi con la asesora: ve sus visitas confirmadas ────────────────────

test("el prompt del asesor trae sus próximas visitas confirmadas con el contacto", () => {
  const texto = buildSystemPrompt({
    org: ORG, advisor: CATHERINE, lead: { id: "lead-cat", phone: CATHERINE.phone }, qualified: false,
    now: { legible: "lunes 9 de noviembre de 2026, 8:17 a. m.", iso: "2026-11-09T08:17:00-05:00" },
    citasConfirmadas: [{ ...NORHA, nombre: "NORHA VELEZ M" }],
  }).map((b) => b.text).join("\n");
  assert.match(texto, /TUS PRÓXIMAS VISITAS CONFIRMADAS/);
  assert.match(texto, /NORHA VELEZ M \(colega\)/);
  assert.match(texto, /Ref 10505674/);
  assert.match(texto, /sin celular visible/i);
  assert.match(texto, /nunca le digas que no existe/i);
});

test("confirmar_cita sin propuestas pendientes le recuerda las ya confirmadas en vez de decir que no hay", async (t) => {
  const appointments = require("../src/data/appointments");
  const { executeTool } = require("../src/agent/tools");
  t.mock.method(appointments, "citasPendientesDeConfirmar", async () => []);
  t.mock.method(appointments, "citasConfirmadasDe", async () => [{ ...NORHA, nombre: "NORHA VELEZ M" }]);
  const r = await executeTool("confirmar_cita", {}, { org: ORG, advisor: CATHERINE, colega: null, lead: { id: "lead-cat", phone: CATHERINE.phone } });
  assert.match(r, /ya está confirmada/i);
  assert.match(r, /NORHA VELEZ M/);
  assert.match(r, /Ref 10505674/);
  assert.doesNotMatch(r, /no ten[eé]s ninguna/i);
});

// ── 4. El Excel se lee en el celular ──────────────────────────────────────

test("el Excel trae una hoja Fichas vertical (etiqueta | dato) y la devolución sigue leyendo Pendientes", async () => {
  const caso = {
    codigo: "C-0011", nombre: "Andrea Strauch", celular: "+57 313 788 4474", whatsapp: "wa.me/573137884474", tipo: "colega",
    porQue: "no le contestó a Sofi", desde: "6 nov", pidio: "Cesión de derechos en Itagüí", ofrecido: "Ref 10012722 · https://info.wasi.co/x",
    peticiones: "", ultimoSuyo: "5 nov: debe ser cesión", ultimoSofi: "5 nov: no tenemos", chatUrl: "https://crm/inbox/1",
  };
  const buf = await armarLibro({ loteId: "L-1", asesorId: "a3", casos: [caso] });
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const fichas = wb.getWorksheet("Fichas");
  assert.ok(fichas, "existe la hoja Fichas");
  const filas = [];
  fichas.eachRow((r) => filas.push(r.values.slice(1).map((v) => (v && v.text) || v)));
  const plano = filas.map((f) => f.join(" | ")).join("\n");
  assert.match(plano, /C-0011 · Andrea Strauch/);
  assert.match(plano, /Celular \| \+57 313 788 4474/);
  assert.match(plano, /Qué pidió \| Cesión de derechos en Itagüí/);
  assert.ok(fichas.columnCount <= 2, "dos columnas: se lee sin deslizar de lado");
  const leido = await leerLibro(buf);
  assert.ok(leido.ok, "la devolución sigue funcionando");
});
