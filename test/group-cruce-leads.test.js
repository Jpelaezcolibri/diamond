// El cruce proactivo oferta -> leads propios. Aprobado por Juan 2026-08-18
// ("armalo") despues de explicarle que la red de aliados ya se consulta sola
// cuando un cliente pregunta (buscar_propiedades, src/agent/tools.js) — lo
// que faltaba era la direccion inversa: la oferta entra primero y avisa antes
// de que nadie pregunte. Cero tokens: es un cruce de base de datos, igual que
// el reactivo.

const { test } = require("node:test");
const assert = require("node:assert");
const command = require("../src/data/command");
const allyProperties = require("../src/data/ally-properties");
const advisors = require("../src/data/advisors");
const canalWhatsapp = require("../src/channels/whatsapp");
const { cruzarOfertaConLeads } = require("../src/groups/cruce-leads");

const ORG = { id: "org-1" };

const ALLY_PROPERTY = {
  id: "ally-1",
  tipo: "Apartamento",
  zona: "El Poblado",
  precio: "$650.000.000",
  contacto_nombre: "Andres Ruiz",
  contacto_telefono: "573009998877",
  inmobiliaria_origen: "Inmobiliaria XYZ",
  puente_advisor_id: "adv-puente",
};

const LEAD_MATCH = {
  lead_id: "lead-1",
  owner_id: "auth-katherine",
  nombre: "Marta",
  phone: "573001112233",
  coincide_en: ["zona", "presupuesto"],
};

test("sin oferta persistida (guardarOferta no devolvio nada), no hace nada", async () => {
  const r = await cruzarOfertaConLeads(ORG, null);
  assert.strictEqual(r.resultado, "sin_oferta");
  assert.deepStrictEqual(r.avisados, []);
});

test("sin leads activos esperando algo asi, no avisa a nadie", async (t) => {
  t.mock.method(command, "leadsParaPropiedad", async () => []);
  const r = await cruzarOfertaConLeads(ORG, ALLY_PROPERTY);
  assert.strictEqual(r.resultado, "sin_leads_esperando");
});

test("avisa al DUENO del lead cuando hay match nuevo", async (t) => {
  t.mock.method(command, "leadsParaPropiedad", async (scope, propiedad) => {
    assert.strictEqual(scope.isAdmin, true, "el cruce lo dispara el radar, ve toda la org");
    assert.strictEqual(propiedad.id, "ally-1");
    return [LEAD_MATCH];
  });
  t.mock.method(allyProperties, "registerAlert", async (orgId, allyId, leadId) => {
    assert.strictEqual(allyId, "ally-1");
    assert.strictEqual(leadId, "lead-1");
    return true;
  });
  t.mock.method(advisors, "findByAuthUserId", async (orgId, authUserId) => {
    assert.strictEqual(authUserId, "auth-katherine");
    return { id: "adv-katherine", phone: "573020001111" };
  });
  let enviado = null;
  t.mock.method(canalWhatsapp, "sendWhatsApp", async (org, to, texto) => {
    enviado = { to, texto };
    return { ok: true, wamid: "w1" };
  });

  const r = await cruzarOfertaConLeads(ORG, ALLY_PROPERTY);

  assert.strictEqual(r.resultado, "avisados");
  assert.deepStrictEqual(r.avisados, [{ leadId: "lead-1", advisorPhone: "573020001111" }]);
  assert.strictEqual(enviado.to, "573020001111");
  assert.match(enviado.texto, /Andres Ruiz/);
  assert.match(enviado.texto, /Marta/);
  assert.match(enviado.texto, /comision se comparte/);
});

test("dedup: un lead que ya recibio aviso de esta propiedad (por cualquiera de las dos vias) no se repite", async (t) => {
  t.mock.method(command, "leadsParaPropiedad", async () => [LEAD_MATCH]);
  t.mock.method(allyProperties, "registerAlert", async () => false);
  let llamadoAdvisor = false;
  t.mock.method(advisors, "findByAuthUserId", async () => {
    llamadoAdvisor = true;
    return null;
  });
  let envios = 0;
  t.mock.method(canalWhatsapp, "sendWhatsApp", async () => {
    envios++;
    return { ok: true };
  });

  const r = await cruzarOfertaConLeads(ORG, ALLY_PROPERTY);

  assert.strictEqual(r.resultado, "sin_destinatario");
  assert.strictEqual(llamadoAdvisor, false, "si ya se aviso, ni siquiera hace falta resolver al asesor");
  assert.strictEqual(envios, 0);
});

test("sin dueno asignado, avisa al asesor puente que vio la oferta en el grupo", async (t) => {
  t.mock.method(command, "leadsParaPropiedad", async () => [{ ...LEAD_MATCH, owner_id: null }]);
  t.mock.method(allyProperties, "registerAlert", async () => true);
  t.mock.method(advisors, "findById", async (orgId, id) => {
    assert.strictEqual(id, "adv-puente");
    return { id: "adv-puente", phone: "573030002222" };
  });
  let enviado = null;
  t.mock.method(canalWhatsapp, "sendWhatsApp", async (org, to) => {
    enviado = to;
    return { ok: true };
  });

  const r = await cruzarOfertaConLeads(ORG, ALLY_PROPERTY);

  assert.strictEqual(r.resultado, "avisados");
  assert.strictEqual(enviado, "573030002222");
});

test("sin dueno ni puente, no hay a quien avisar y no truena", async (t) => {
  t.mock.method(command, "leadsParaPropiedad", async () => [{ ...LEAD_MATCH, owner_id: null }]);
  t.mock.method(allyProperties, "registerAlert", async () => true);

  const r = await cruzarOfertaConLeads(ORG, { ...ALLY_PROPERTY, puente_advisor_id: null });

  assert.strictEqual(r.resultado, "sin_destinatario");
  assert.deepStrictEqual(r.avisados, []);
});

test("si el envio falla, no queda marcado como avisado", async (t) => {
  t.mock.method(command, "leadsParaPropiedad", async () => [LEAD_MATCH]);
  t.mock.method(allyProperties, "registerAlert", async () => true);
  t.mock.method(advisors, "findByAuthUserId", async () => ({ id: "adv-katherine", phone: "573020001111" }));
  t.mock.method(canalWhatsapp, "sendWhatsApp", async () => ({ ok: false, error: "ventana cerrada" }));

  const r = await cruzarOfertaConLeads(ORG, ALLY_PROPERTY);

  assert.strictEqual(r.resultado, "sin_destinatario");
  assert.deepStrictEqual(r.avisados, []);
});
