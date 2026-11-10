// El celular que deja un colega o cliente queda guardado y se ve en todo
// (Juan, 2026-11-09): "si el colega ya dio el número telefónico que se
// actualice en la cita, busca la forma de que no se pierda la información".
// Caso Norha Vélez: WhatsApp le ocultaba el número (CO.1622…), lo escribió en
// el chat ("3105100165") y quedó solo en el texto de la conversación.
const { test } = require("node:test");
const assert = require("node:assert");

const cc = require("../src/lib/celular-contacto");
const { textoVisitaAsesora } = require("../src/lib/ficha-visita");
const { quienDe } = require("../src/lib/quien-lead");
const { buildSystemPrompt } = require("../src/agent/prompts");

const ORG = { id: "org-1", name: "Diamond" };
const CATHERINE = { id: "a3", name: "Catherine Uribe", phone: "573028536489" };
const CITA = { tipo: "visita", ref: "10505674", estado: "confirmada", asesor_id: "a3", fecha_hora: "2026-11-10T10:00:00-05:00" };
const NORHA = () => ({ id: "lead-norha", org_id: "org-1", phone: "CO.1622610936270244", nombre: null, source: "colega", cita: { ...CITA } });

// ── Reconocer el número ───────────────────────────────────────────────────

test("reconoce celulares colombianos con o sin +57, espacios o guiones", () => {
  assert.deepStrictEqual(cc.extraerCelulares("3105100165"), ["573105100165"]);
  assert.deepStrictEqual(cc.extraerCelulares("mi cel es 310 510 0165"), ["573105100165"]);
  assert.deepStrictEqual(cc.extraerCelulares("+57 310-510-0165 gracias"), ["573105100165"]);
  assert.deepStrictEqual(cc.extraerCelulares("Ref 10505674 a $315.000.000"), [], "una ref o un precio no son celulares");
  assert.deepStrictEqual(cc.extraerCelulares("presupuesto 360 millones"), []);
});

test("se guarda si la persona no tiene número visible, o si el mensaje es básicamente su número", () => {
  assert.strictEqual(cc.celularAGuardar(NORHA(), "Llámame al 3105100165 por favor"), "573105100165");
  const conTel = { id: "l", phone: "573001112233", nombre: "Ana", source: "whatsapp" };
  assert.strictEqual(cc.celularAGuardar(conTel, "mejor a este: 3105100165"), "573105100165", "mensaje corto con el número");
  assert.strictEqual(cc.celularAGuardar(conTel, "el propietario me dijo que lo llamara al 3105100165 para ver si le baja el precio al apartamento"), null, "texto largo: puede ser el número de otra persona");
  assert.strictEqual(cc.celularAGuardar(conTel, "300 111 2233"), null, "es el mismo número de su WhatsApp");
  assert.strictEqual(cc.celularAGuardar({ ...NORHA(), celular: "573105100165" }, "3105100165"), null, "ya lo teníamos");
  assert.strictEqual(cc.celularAGuardar(NORHA(), "3105100165 o 3001234567"), null, "dos números: no adivina");
});

// ── Guardarlo y avisar ────────────────────────────────────────────────────

function deps(over = {}) {
  const log = { updates: [], avisos: [] };
  return {
    log,
    d: {
      actualizar: async (id, patch) => { log.updates.push({ id, patch }); return patch; },
      asesor: async (_o, id) => (id === "a3" ? CATHERINE : null),
      avisar: async (a) => { log.avisos.push(a); return { ok: true }; },
      ficha: async () => "FICHA Ref 10505674",
      ...over,
    },
  };
}

test("lo guarda en el lead y en la cita, y le avisa a quien tiene la visita con la ficha", async () => {
  const lead = NORHA();
  const { log, d } = deps();
  const r = await cc.capturar({ org: ORG, lead, texto: "3105100165", deps: d });
  assert.strictEqual(r.celular, "573105100165");
  assert.strictEqual(log.updates.length, 1);
  assert.strictEqual(log.updates[0].patch.celular, "573105100165");
  assert.strictEqual(log.updates[0].patch.cita.celular_contacto, "573105100165");
  assert.strictEqual(lead.celular, "573105100165", "el lead en memoria ya lo trae para el resto del turno");
  assert.strictEqual(log.avisos.length, 1);
  assert.strictEqual(log.avisos[0].advisor, CATHERINE);
  assert.match(log.avisos[0].titulo, /dejó su celular/);
  assert.match(log.avisos[0].cuerpo, /\+57 310 510 0165/);
  assert.match(log.avisos[0].detalle, /^📞 \*Celular:\* \+57 310 510 0165 · wa\.me\/573105100165/);
  assert.match(log.avisos[0].detalle, /FICHA Ref 10505674/);
});

test("sin la columna nueva (migración pendiente) no se pierde: queda en la cita", async () => {
  const lead = NORHA();
  const intentos = [];
  const { d } = deps({
    actualizar: async (id, patch) => {
      intentos.push(patch);
      if ("celular" in patch) { const e = new Error('column "celular" of relation "leads" does not exist'); e.code = "42703"; throw e; }
      return patch;
    },
  });
  const r = await cc.capturar({ org: ORG, lead, texto: "3105100165", deps: d });
  assert.strictEqual(r.celular, "573105100165");
  assert.strictEqual(intentos.length, 2);
  assert.deepStrictEqual(Object.keys(intentos[1]), ["cita"]);
  assert.strictEqual(lead.cita.celular_contacto, "573105100165");
});

test("sin visita ni pendiente no le avisa a nadie, pero igual lo guarda", async () => {
  const lead = { id: "l", phone: "CO.999", nombre: null, source: "whatsapp", cita: null };
  const { log, d } = deps();
  await cc.capturar({ org: ORG, lead, texto: "3105100165", deps: d });
  assert.strictEqual(log.updates[0].patch.celular, "573105100165");
  assert.strictEqual("cita" in log.updates[0].patch, false);
  assert.strictEqual(log.avisos.length, 0);
});

// ── Todo lo lee de ahí ────────────────────────────────────────────────────

test("celularDe: el guardado, el de la cita o el de su WhatsApp; nunca el CO.…", () => {
  assert.strictEqual(cc.celularDe({ phone: "CO.1", celular: "573105100165" }), "573105100165");
  assert.strictEqual(cc.celularDe({ phone: "CO.1", cita: { celular_contacto: "573105100165" } }), "573105100165");
  assert.strictEqual(cc.celularDe({ phone: "573001112233" }), "573001112233");
  assert.strictEqual(cc.celularDe({ phone: "CO.1" }), null);
});

test("la ficha de la visita usa el celular guardado en vez de 'sin celular visible'", () => {
  const t = textoVisitaAsesora({ lead: { ...NORHA(), celular: "573105100165" }, cita: CITA, propiedad: null, colega: { nombre: "NORHA VELEZ M" } });
  assert.match(t, /\+57 310 510 0165/);
  assert.match(t, /wa\.me\/573105100165/);
  assert.doesNotMatch(t, /Sin celular visible/);
});

test("los avisos internos nombran a la persona por su celular guardado si no hay nombre", () => {
  assert.strictEqual(quienDe({ nombre: null, phone: "CO.1", celular: "573105100165" }), "+57 310 510 0165");
});

test("Sofi sabe que ya tiene el número y no se lo vuelve a pedir", () => {
  const texto = buildSystemPrompt({
    org: ORG, lead: { ...NORHA(), celular: "573105100165" }, qualified: false,
    now: { legible: "lunes 9 de noviembre de 2026, 6:20 p. m.", iso: "2026-11-09T18:20:00-05:00" },
    colega: { nombre: "Norha Velez M" },
  }).map((b) => b.text).join("\n");
  assert.match(texto, /SU CELULAR DE CONTACTO: \+57 310 510 0165/);
  assert.match(texto, /no se lo vuelvas a pedir/i);
});

test("el Excel de pendientes usa el celular guardado", async () => {
  const { armarCaso } = require("../src/lib/caso-pendiente");
  const caso = await armarCaso({
    org: ORG,
    pendiente: { codigo: "C-0099", motivo: "pide_asesor", created_at: "2026-11-09T23:00:00Z", conversation_id: "c1" },
    lead: { ...NORHA(), celular: "573105100165" },
    mensajes: [],
    deps: { ficha: async () => null, soloLlamada: async () => false },
  }).catch((e) => ({ error: e.message }));
  assert.strictEqual(caso.celular, "+57 310 510 0165");
  assert.strictEqual(caso.whatsapp, "wa.me/573105100165");
});
