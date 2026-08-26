// test/group-vivo-ofertas.test.js
//
// Las ofertas volvieron a la escucha en vivo (Juan, 2026-08-25), pero NO como
// estaban antes del 2026-08-20: entonces se persistian todas y saturaban
// group_signals (402 ofertas de 438 señales en 2 dias) sin aportar nada. Ahora
// se cruzan en memoria contra los mandatos y solo se persiste lo que cruza.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const mandatosData = require("../src/data/mandatos");
const ofertas = require("../src/groups/ofertas");
const avisar = require("../src/groups/avisar-mandato");
const command = require("../src/data/command");
const cruceLeads = require("../src/groups/cruce-leads");

let guardadas, cruces, crucesLeads, leadsCandidatos;

beforeEach(() => {
  mandatosData._reset();
  guardadas = [];
  cruces = [];
  crucesLeads = [];
  leadsCandidatos = [];
  ofertas.guardarOferta = async (org, o) => {
    guardadas.push(o);
    return { id: "ally-nueva" };
  };
  avisar.cruzarOfertaConMandatos = async (org, o, opts) => {
    cruces.push({ o, opts });
    return { resultado: "enviado", avisados: [{}], matches: 1 };
  };
  command.leadsParaPropiedad = async () => leadsCandidatos;
  cruceLeads.cruzarOfertaConLeads = async (org, allyProperty) => {
    crucesLeads.push({ org, allyProperty });
    const avisados = leadsCandidatos.map((l) => ({ leadId: l.lead_id, advisorPhone: "573000000000" }));
    return { resultado: avisados.length > 0 ? "avisados" : "sin_leads_esperando", avisados };
  };
});

test("sin mandatos activos ni leads esperando, una oferta no se persiste ni se cruza", async () => {
  const { manejarOferta } = require("../src/groups/vivo");
  const r = await manejarOferta({ id: "org-1" }, { clase: "oferta", tipo: "apartamento", zonas: ["El Poblado"], precio_max: 900000000 }, {});
  assert.strictEqual(r.resultado, "oferta_sin_match");
  assert.strictEqual(guardadas.length, 0, "sin nadie esperando, guardarla es la saturacion que Juan apago");
  assert.strictEqual(cruces.length, 0);
  assert.strictEqual(crucesLeads.length, 0);
});

test("una oferta que no le sirve a ningun mandato no se persiste", async () => {
  await mandatosData.crear("org-1", {
    cliente_nombre: "Marcela", operacion: "venta", tipo: "apartamento",
    zonas: ["El Poblado"], precio_max: 2200000000, habitaciones: 4, area_min: 150,
  });
  const { manejarOferta } = require("../src/groups/vivo");
  const r = await manejarOferta(
    { id: "org-1" },
    { clase: "oferta", operacion: "arriendo", tipo: "apartamento", zonas: ["Bello"], precio_max: 3000000 },
    {}
  );
  assert.strictEqual(r.resultado, "oferta_sin_match");
  assert.strictEqual(guardadas.length, 0);
});

test("una oferta que cruza SI se persiste y se avisa", async () => {
  await mandatosData.crear("org-1", {
    cliente_nombre: "Marcela", advisor_id: "adv-nat", operacion: "venta", tipo: "apartamento",
    zonas: ["El Poblado"], precio_max: 2200000000, habitaciones: 4, area_min: 150,
  });
  const { manejarOferta } = require("../src/groups/vivo");
  const r = await manejarOferta(
    { id: "org-1" },
    {
      clase: "oferta", operacion: "venta", tipo: "apartamento", zonas: ["El Poblado"],
      precio_max: 1580000000, habitaciones: 4, area_min: 246,
      mensaje: { autor: "Glovi", autorTelefono: "129781211373754", texto: "Dúplex Loma del Tesoro" },
    },
    { id: "grupo-123", nombre: "SOLO VIVIENDA >$1000 MLLS" },
    { advisorId: "adv-puente-1" }
  );
  assert.strictEqual(r.resultado, "oferta_cruzada");
  assert.strictEqual(guardadas.length, 1, "una oferta que le sirve a alguien SI vale persistirla");
  assert.strictEqual(cruces.length, 1);
  assert.strictEqual(cruces[0].opts.allyPropertyId, "ally-nueva");
  assert.strictEqual(cruces[0].opts.grupo, "SOLO VIVIENDA >$1000 MLLS");
});

// IMPORTANT: manejarOferta ya recibe grupo y advisorId, pero no los cableaba
// hacia adentro de c.mensaje — ofertas.js lee m.groupId y m.advisorId para
// guardar group_id y puente_advisor_id en ally_properties. Sin esto, toda
// oferta que entra por el radar en vivo pierde su grupo de origen y su
// asesor puente.
test("la oferta guardada trae groupId del grupo y advisorId del puente", async () => {
  await mandatosData.crear("org-1", {
    cliente_nombre: "Marcela", advisor_id: "adv-nat", operacion: "venta", tipo: "apartamento",
    zonas: ["El Poblado"], precio_max: 2200000000, habitaciones: 4, area_min: 150,
  });
  const { manejarOferta } = require("../src/groups/vivo");
  await manejarOferta(
    { id: "org-1" },
    {
      clase: "oferta", operacion: "venta", tipo: "apartamento", zonas: ["El Poblado"],
      precio_max: 1580000000, habitaciones: 4, area_min: 246,
      mensaje: { autor: "Glovi", autorTelefono: "129781211373754", texto: "Dúplex Loma del Tesoro" },
    },
    { id: "grupo-123", nombre: "SOLO VIVIENDA >$1000 MLLS" },
    { advisorId: "adv-puente-1" }
  );
  assert.strictEqual(guardadas.length, 1);
  assert.strictEqual(guardadas[0].mensaje.groupId, "grupo-123");
  assert.strictEqual(guardadas[0].mensaje.advisorId, "adv-puente-1");
});

// Reconectado 2026-08-25 (Juan): el cruce contra los leads propios del embudo
// es una poblacion distinta de los mandatos curados por un asesor -- una
// oferta puede no servirle a ningun mandato y SI servirle a un lead que ya
// esta en el CRM esperando exactamente eso.
test("una oferta que NO sirve a ningun mandato pero SI a un lead propio se persiste y se cruza", async () => {
  // Sin mandatos activos en este caso.
  leadsCandidatos = [{ lead_id: "lead-1", owner_id: null }];
  const { manejarOferta } = require("../src/groups/vivo");
  const r = await manejarOferta(
    { id: "org-1" },
    { clase: "oferta", operacion: "arriendo", tipo: "apartamento", zonas: ["Bello"], precio_max: 3000000 },
    {}
  );
  assert.strictEqual(r.resultado, "oferta_cruzada");
  assert.strictEqual(guardadas.length, 1);
  assert.strictEqual(crucesLeads.length, 1, "se debe cruzar contra los leads");
  assert.strictEqual(crucesLeads[0].allyProperty.id, "ally-nueva", "se cruza con la fila ya persistida");
  assert.strictEqual(cruces.length, 0, "sin mandatos activos, no hay nada que avisarle a un mandato");
});

// Important (review sobre f78b9b6): cruzarOfertaConLeads es la unica llamada
// de manejarOferta sin proteccion -- listarActivos, leadsParaPropiedad y
// guardarOferta ya degradan solos. Si esta rechaza (RLS, red, problema en
// ally_property_alerts), toda la funcion no puede reventar: el cruce de
// mandatos que ya corrio bien se perderia con ella.
test("si el cruce contra leads falla, manejarOferta no revienta y el cruce de mandatos se conserva", async () => {
  await mandatosData.crear("org-1", {
    cliente_nombre: "Marcela", advisor_id: "adv-nat", operacion: "venta", tipo: "apartamento",
    zonas: ["El Poblado"], precio_max: 2200000000, habitaciones: 4, area_min: 150,
  });
  cruceLeads.cruzarOfertaConLeads = () => Promise.reject(new Error("boom"));
  const { manejarOferta } = require("../src/groups/vivo");
  const r = await manejarOferta(
    { id: "org-1" },
    {
      clase: "oferta", operacion: "venta", tipo: "apartamento", zonas: ["El Poblado"],
      precio_max: 1580000000, habitaciones: 4, area_min: 246,
      mensaje: { autor: "Glovi", autorTelefono: "129781211373754", texto: "Dúplex Loma del Tesoro" },
    },
    { id: "grupo-123", nombre: "SOLO VIVIENDA >$1000 MLLS" },
    { advisorId: "adv-puente-1" }
  );
  assert.strictEqual(r.resultado, "oferta_cruzada");
  assert.strictEqual(r.leadsAvisados, 0);
  assert.ok(r.matches > 0, "el cruce de mandatos se conserva aunque el de leads reviente");
});

test("una oferta que sirve a un mandato Y a un lead cruza las dos cosas", async () => {
  await mandatosData.crear("org-1", {
    cliente_nombre: "Marcela", advisor_id: "adv-nat", operacion: "venta", tipo: "apartamento",
    zonas: ["El Poblado"], precio_max: 2200000000, habitaciones: 4, area_min: 150,
  });
  leadsCandidatos = [{ lead_id: "lead-1", owner_id: null }];
  const { manejarOferta } = require("../src/groups/vivo");
  const r = await manejarOferta(
    { id: "org-1" },
    {
      clase: "oferta", operacion: "venta", tipo: "apartamento", zonas: ["El Poblado"],
      precio_max: 1580000000, habitaciones: 4, area_min: 246,
      mensaje: { autor: "Glovi", autorTelefono: "129781211373754", texto: "Dúplex Loma del Tesoro" },
    },
    { id: "grupo-123", nombre: "SOLO VIVIENDA >$1000 MLLS" },
    { advisorId: "adv-puente-1" }
  );
  assert.strictEqual(r.resultado, "oferta_cruzada");
  assert.strictEqual(cruces.length, 1, "se cruzo contra los mandatos");
  assert.strictEqual(crucesLeads.length, 1, "se cruzo contra los leads");
  assert.ok(r.matches > 0, "matches del cruce con mandatos");
  assert.ok(r.leadsAvisados > 0, "leadsAvisados del cruce con leads");
});
