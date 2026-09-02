// El interruptor del carril de COMPRA (Juan, 2026-09-02: "quiero tener la
// posibilidad de desactivar los mandatos... para enfocar todas las fuerzas en
// las propiedades que tenemos para la venta").
//
// Lo que se prueba no es "la bandera se lee". Es la promesa que se le hizo:
// apagado NO se cruza ni se avisa, y volver a prenderlo no perdio nada.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const mandatosData = require("../src/data/mandatos");
const organizations = require("../src/data/organizations");
const ofertas = require("../src/groups/ofertas");
const avisar = require("../src/groups/avisar-mandato");
const command = require("../src/data/command");
const cruceLeads = require("../src/groups/cruce-leads");

let guardadas, cruces, crucesLeads;

// La misma oferta en los dos escenarios: lo unico que cambia es el interruptor.
const OFERTA = {
  clase: "oferta", operacion: "venta", tipo: "apartamento",
  zonas: ["El Poblado"], precio_max: 900000000, habitaciones: 3,
};

async function conUnMandatoQueSirve() {
  await mandatosData.crear("org-1", {
    cliente_nombre: "Sara A", advisor_id: "adv-nat", operacion: "venta",
    tipo: "apartamento", zonas: ["El Poblado"], precio_max: 1200000000,
    habitaciones: 2,
  });
}

beforeEach(() => {
  mandatosData._reset();
  guardadas = [];
  cruces = [];
  crucesLeads = [];
  ofertas.guardarOferta = async (org, o) => {
    guardadas.push(o);
    return { id: "ally-nueva" };
  };
  avisar.cruzarOfertaConMandatos = async (org, o, opts) => {
    cruces.push({ o, opts });
    return { resultado: "enviado", avisados: [{}], matches: 1 };
  };
  command.leadsParaPropiedad = async () => [];
  cruceLeads.cruzarOfertaConLeads = async (org, allyProperty) => {
    crucesLeads.push({ org, allyProperty });
    return { resultado: "sin_leads_esperando", avisados: [] };
  };
});

test("sin la columna, el carril queda ENCENDIDO", () => {
  // La migracion puede no haber corrido. El comportamiento tiene que ser el de
  // antes de que el boton existiera: el carril nunca se apaga solo.
  assert.strictEqual(organizations.mandatosActivos({ id: "org-1" }), true);
  assert.strictEqual(organizations.mandatosActivos(null), true);
  assert.strictEqual(organizations.mandatosActivos({ mandatos_activos: null }), true);
});

test("solo se apaga con false explicito", () => {
  assert.strictEqual(organizations.mandatosActivos({ mandatos_activos: false }), false);
  assert.strictEqual(organizations.mandatosActivos({ mandatos_activos: true }), true);
});

test("PRENDIDO: la oferta cruza contra el mandato y se avisa", async () => {
  await conUnMandatoQueSirve();
  const { manejarOferta } = require("../src/groups/vivo");
  const r = await manejarOferta({ id: "org-1", mandatos_activos: true }, OFERTA, {});

  assert.notStrictEqual(r.resultado, "oferta_sin_match");
  assert.strictEqual(cruces.length, 1, "se cruzo contra el mandato");
  assert.strictEqual(guardadas.length, 1, "la oferta se persistio porque le sirve a alguien");
});

test("APAGADO: la MISMA oferta no cruza, no avisa y no se persiste", async () => {
  await conUnMandatoQueSirve();
  const { manejarOferta } = require("../src/groups/vivo");
  const r = await manejarOferta({ id: "org-1", mandatos_activos: false }, OFERTA, {});

  assert.strictEqual(r.resultado, "oferta_sin_match");
  assert.strictEqual(cruces.length, 0, "no salio ningun aviso de mandato");
  assert.strictEqual(guardadas.length, 0, "no se persistio la oferta");
});

test("APAGADO no borra nada: el mandato sigue vivo y prenderlo lo recupera", async () => {
  await conUnMandatoQueSirve();
  const { manejarOferta } = require("../src/groups/vivo");

  await manejarOferta({ id: "org-1", mandatos_activos: false }, OFERTA, {});
  const activos = await mandatosData.listarActivos("org-1");
  assert.strictEqual(activos.length, 1, "el mandato quedo guardado, no se toco");

  // Se prende de nuevo: mismo mandato, misma oferta, vuelve a cruzar.
  const r = await manejarOferta({ id: "org-1", mandatos_activos: true }, OFERTA, {});
  assert.notStrictEqual(r.resultado, "oferta_sin_match");
  assert.strictEqual(cruces.length, 1, "el carril volvio sin perder el mandato");
});
