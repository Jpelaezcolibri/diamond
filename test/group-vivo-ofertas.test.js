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

let guardadas, cruces;

beforeEach(() => {
  mandatosData._reset();
  guardadas = [];
  cruces = [];
  ofertas.guardarOferta = async (org, o) => {
    guardadas.push(o);
    return { id: "ally-nueva" };
  };
  avisar.cruzarOfertaConMandatos = async (org, o, opts) => {
    cruces.push({ o, opts });
    return { resultado: "enviado", avisados: [{}], matches: 1 };
  };
});

test("sin mandatos activos, una oferta no se persiste ni se cruza", async () => {
  const { manejarOferta } = require("../src/groups/vivo");
  const r = await manejarOferta({ id: "org-1" }, { clase: "oferta", tipo: "apartamento", zonas: ["El Poblado"], precio_max: 900000000 }, {});
  assert.strictEqual(r.resultado, "oferta_sin_mandatos");
  assert.strictEqual(guardadas.length, 0, "sin nadie esperando, guardarla es la saturacion que Juan apago");
  assert.strictEqual(cruces.length, 0);
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
      mensaje: { autor: "Glovi", autorTelefono: "129781211373754", groupId: "g-1", texto: "Dúplex Loma del Tesoro" },
    },
    { nombre: "SOLO VIVIENDA >$1000 MLLS" }
  );
  assert.strictEqual(r.resultado, "oferta_cruzada");
  assert.strictEqual(guardadas.length, 1, "una oferta que le sirve a alguien SI vale persistirla");
  assert.strictEqual(cruces.length, 1);
  assert.strictEqual(cruces[0].opts.allyPropertyId, "ally-nueva");
  assert.strictEqual(cruces[0].opts.grupo, "SOLO VIVIENDA >$1000 MLLS");
});
