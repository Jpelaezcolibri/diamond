const { test } = require("node:test");
const assert = require("node:assert");
const { esPublicable, explicarMotivos, MOTIVOS_LEGIBLES } = require("../src/groups/publicable");

// Match que pasa TODO lo que ya existia, para aislar la variable nueva.
const base = {
  fuente: "diamond", ref: "10319436", titulo: "Apartamento Amoblado en Arriendo en El Poblado",
  precio: "$7.900.000", operacion: "Arriendo", zona: "Los Gonzáles", area: "90m2",
  link: "https://diamondinmobiliaria.com/propiedades/apto-10319436",
  linkWasi: "https://info.wasi.co/apartamento-alquiler-los-gonzales-medellin/10319436",
  puntaje: 90, ubicacion: "exacta",
  amoblado: true, amoblado_sin_confirmar: false, periodo_no_soportado: false,
};

test("el match base sigue siendo publicable", () => {
  assert.deepStrictEqual(esPublicable(base), { ok: true, motivos: [] });
});

test("amoblado sin confirmar no es publicable", () => {
  const r = esPublicable({ ...base, amoblado: null, amoblado_sin_confirmar: true });
  assert.strictEqual(r.ok, false);
  assert.ok(r.motivos.includes("amoblado_sin_confirmar"), `motivos: ${r.motivos}`);
});

test("un pedido por dias o semanas no es publicable", () => {
  const r = esPublicable({ ...base, periodo_no_soportado: true });
  assert.strictEqual(r.ok, false);
  assert.ok(r.motivos.includes("periodo_no_soportado"), `motivos: ${r.motivos}`);
});

test("los dos motivos se traducen al castellano", () => {
  // Lección del 2026-09-06: un motivo que no se traduce es un motivo que quien
  // lo lea va a reemplazar por una explicacion inventada. Sofi le dijo a Juan
  // que el colega "no tiene telefono registrado" cuando la razon real era
  // ref_bloqueada.
  for (const m of ["amoblado_sin_confirmar", "periodo_no_soportado"]) {
    assert.ok(MOTIVOS_LEGIBLES[m], `falta la traduccion de ${m}`);
    assert.ok(!explicarMotivos([m]).includes(m), `${m} salio crudo hacia una persona`);
  }
});
