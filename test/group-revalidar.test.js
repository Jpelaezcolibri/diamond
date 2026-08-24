// El veredicto de Sofi sobre las candidatas del motor (src/groups/revalidar.js).
//
// Caso real que motiva este archivo (Juan, 2026-08-24): de 13 pedidos
// descartados en produccion, 10 eran incompatibles de verdad (otra zona, otro
// edificio) pero 3 se perdieron solo porque el inventario no registra un dato
// que el pedido menciona (terraza, antiguedad). El esquema y el prompt ahora
// distinguen INCOMPATIBLE (no sirve) de INCOMPLETO (sirve, con un hueco que
// se declara en 'sin_confirmar') -- esto prueba esa distincion sin pagar un
// llamado real a Claude (se inyecta el cliente mock, mismo patron que
// group-dm.test.js).

const { test } = require("node:test");
const assert = require("node:assert");
const { _setClientForTests } = require("../src/lib/anthropic");
const revalidar = require("../src/groups/revalidar");

function mockRespuesta(t, veredicto) {
  _setClientForTests({
    messages: {
      create: async () => ({ content: [{ type: "text", text: JSON.stringify(veredicto) }], usage: { costoUsd: 0 } }),
    },
  });
  t.after(() => _setClientForTests(null));
}

function clasificado(extra = {}) {
  return {
    operacion: "venta", tipo: "apartamento", zona: "envigado", ciudad: "medellin",
    precio_max: 500000000, habitaciones: 3, area_min: 0, notas: "",
    mensaje: { texto: "Busco apto en Envigado con terraza, piso bajo y maximo 6 años, para cliente" },
    ...extra,
  };
}

function match(extra = {}) {
  return {
    ref: "REF1", operacion: "Venta", zona: "Envigado", precio: "$480.000.000",
    area: "90m2", habitaciones: 3, puntaje: 83, titulo: "Apartamento en Envigado",
    razones: ["Zona: Envigado"], ...extra,
  };
}

test("el esquema exige 'sin_confirmar' -- no es un campo opcional que Sofi pueda omitir", () => {
  assert.ok(revalidar.ESQUEMA.required.includes("sin_confirmar"));
  assert.strictEqual(revalidar.ESQUEMA.properties.sin_confirmar.type, "array");
});

test("un pedido INCOMPLETO (calza pero falta un dato que el inventario no tiene) sirve, con la salvedad", async (t) => {
  // Caso real: 3 propiedades con match del 100% en zona/alcobas/precio,
  // descartadas solo porque el inventario no registra terraza ni antiguedad.
  mockRespuesta(t, {
    es_pedido_real: true, sirve_alguna: true, refs_utiles: ["REF1"],
    por_que: "Calza en zona, alcobas y precio. No tengo confirmado terraza ni antigüedad.",
    confianza: 0.85, desacuerdo_con_puntaje: "",
    sin_confirmar: ["terraza", "antigüedad"],
  });

  const { veredicto } = await revalidar.revalidar(clasificado(), [match()]);

  assert.strictEqual(veredicto.sirve_alguna, true);
  assert.deepStrictEqual(veredicto.refs_utiles, ["REF1"]);
  assert.deepStrictEqual(veredicto.sin_confirmar, ["terraza", "antigüedad"]);
  assert.strictEqual(revalidar.apruebaAviso(veredicto), true);
});

test("un pedido INCOMPATIBLE (otra zona, otro tipo) sigue sin servir -- sin_confirmar no lo salva", async (t) => {
  mockRespuesta(t, {
    es_pedido_real: true, sirve_alguna: false, refs_utiles: [],
    por_que: "Pide finca en Llano Grande; lo que tenemos son apartamentos urbanos.",
    confianza: 0.9, desacuerdo_con_puntaje: "",
    sin_confirmar: [],
  });

  const { veredicto } = await revalidar.revalidar(clasificado(), [match()]);

  assert.strictEqual(veredicto.sirve_alguna, false);
  assert.strictEqual(revalidar.apruebaAviso(veredicto), false);
});

test("sin datos faltantes, 'sin_confirmar' sale vacio -- no se inventa una salvedad de la nada", async (t) => {
  mockRespuesta(t, {
    es_pedido_real: true, sirve_alguna: true, refs_utiles: ["REF1"],
    por_que: "Calza en todo lo que se pidio.", confianza: 0.95, desacuerdo_con_puntaje: "",
    sin_confirmar: [],
  });

  const { veredicto } = await revalidar.revalidar(clasificado(), [match()]);
  assert.deepStrictEqual(veredicto.sin_confirmar, []);
});

test("un veredicto VIEJO sin 'sin_confirmar' (guardado antes de este cambio) no rompe apruebaAviso", async (t) => {
  // Simula lo que ya esta guardado en group_signals.revalidacion de antes de
  // esta fecha: el campo simplemente no existe en el objeto.
  mockRespuesta(t, {
    es_pedido_real: true, sirve_alguna: true, refs_utiles: ["REF1"],
    por_que: "Calza en zona, alcobas y precio.", confianza: 0.9, desacuerdo_con_puntaje: "",
    // sin 'sin_confirmar' a proposito
  });

  const { veredicto } = await revalidar.revalidar(clasificado(), [match()]);
  assert.strictEqual(veredicto.sin_confirmar, undefined);
  assert.strictEqual(revalidar.apruebaAviso(veredicto), true, "el veredicto viejo sigue aprobando el aviso igual");
});

// LE_FALTA (Juan, 2026-08-24) — caso real Edwin Ramirez / grupo SOLO
// Envigado. Es OTRA cosa que sin_confirmar: aca el dato SI se conoce y la
// propiedad no cumple, pero es una sola cosa accesoria de un pedido largo.

test("una propiedad que cumple todo salvo una cosa accesoria entra a refs_utiles con su aclaracion", async (t) => {
  mockRespuesta(t, {
    es_pedido_real: true, sirve_alguna: true, refs_utiles: ["10077095"],
    por_que: "Cumple zona, precio, alcobas, area y baños; solo tiene un garaje.",
    confianza: 0.92, desacuerdo_con_puntaje: "", sin_confirmar: [],
    le_falta: [{ ref: "10077095", detalle: "tiene 1 garaje y pediste 2" }],
  });

  const { veredicto } = await revalidar.revalidar(clasificado(), [match({ ref: "10077095" })]);
  assert.strictEqual(revalidar.apruebaAviso(veredicto), true, "no se pierde por el garaje que falta");
  assert.deepStrictEqual(veredicto.le_falta, [{ ref: "10077095", detalle: "tiene 1 garaje y pediste 2" }]);
});

test("cuando todo lo conocido cumple, 'le_falta' sale vacio -- no se inventa una aclaracion", async (t) => {
  mockRespuesta(t, {
    es_pedido_real: true, sirve_alguna: true, refs_utiles: ["REF1"],
    por_que: "Calza en todo lo que se pidio.", confianza: 0.95, desacuerdo_con_puntaje: "",
    sin_confirmar: [], le_falta: [],
  });

  const { veredicto } = await revalidar.revalidar(clasificado(), [match()]);
  assert.deepStrictEqual(veredicto.le_falta, []);
});

test("un veredicto VIEJO sin 'le_falta' no rompe apruebaAviso", async (t) => {
  mockRespuesta(t, {
    es_pedido_real: true, sirve_alguna: true, refs_utiles: ["REF1"],
    por_que: "Calza en zona, alcobas y precio.", confianza: 0.9, desacuerdo_con_puntaje: "",
    // sin 'le_falta' ni 'sin_confirmar' a proposito: es lo que ya esta
    // guardado en group_signals.revalidacion de antes de esta fecha.
  });

  const { veredicto } = await revalidar.revalidar(clasificado(), [match()]);
  assert.strictEqual(veredicto.le_falta, undefined);
  assert.strictEqual(revalidar.apruebaAviso(veredicto), true);
});

// El esquema es el contrato con el modelo: si estos campos dejan de ser
// obligatorios, Sofi puede omitirlos y la aclaracion desaparece sin que nada
// falle -- exactamente el modo de falla silencioso que este cambio corrige.
test("el esquema exige los tres campos de honestidad, no solo los de veredicto", () => {
  for (const campo of ["sin_confirmar", "le_falta", "refs_utiles"]) {
    assert.ok(revalidar.ESQUEMA.required.includes(campo), `${campo} es obligatorio en el esquema`);
  }
  const item = revalidar.ESQUEMA.properties.le_falta.items;
  assert.deepStrictEqual(item.required, ["ref", "detalle"], "cada aclaracion dice de QUE propiedad habla");
});

// El prompt es el unico lugar donde vive la linea entre "accesorio" y "de
// fondo". Si se borra, Sofi vuelve a descartar el caso de El Portal y no lo
// notariamos: el sistema seguiria funcionando, solo callado.
test("el prompt distingue las tres situaciones y nombra los innegociables", () => {
  const s = revalidar.SISTEMA || "";
  for (const marca of ["INCOMPATIBLE", "INCOMPLETO", "CASI", "ACCESORIO", "de FONDO"]) {
    assert.ok(s.includes(marca), `el prompt nombra ${marca}`);
  }
  assert.ok(/DOS O MAS incumplimientos/.test(s), "dos huecos conocidos siguen siendo un NO");
});
