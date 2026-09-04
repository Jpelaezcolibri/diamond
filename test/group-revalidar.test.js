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

// DUDOSA (Juan, 2026-09-01) — hasta ahora Sofi decidia siempre en binario
// (entra a refs_utiles o no entra a nada); esto le da una tercera salida
// para el caso genuinamente incierto, en vez de forzarlo a INCOMPATIBLE.

test("el esquema exige 'refs_dudosas' -- no es un campo opcional que Sofi pueda omitir", () => {
  assert.ok(revalidar.ESQUEMA.required.includes("refs_dudosas"));
  assert.strictEqual(revalidar.ESQUEMA.properties.refs_dudosas.type, "array");
});

test("una candidata DUDOSA no entra a refs_utiles pero si a refs_dudosas", async (t) => {
  mockRespuesta(t, {
    es_pedido_real: true, sirve_alguna: true, refs_utiles: [],
    por_que: "Ninguna calza del todo, pero REF1 esta cerca: zona vecina y le falta un baño.",
    confianza: 0.6, desacuerdo_con_puntaje: "",
    sin_confirmar: [], le_falta: [],
    refs_dudosas: ["REF1"],
  });

  const { veredicto } = await revalidar.revalidar(clasificado(), [match()]);

  assert.deepStrictEqual(veredicto.refs_utiles, []);
  assert.deepStrictEqual(veredicto.refs_dudosas, ["REF1"]);
});

test("una ref nunca aparece en refs_utiles y refs_dudosas a la vez -- son mutuamente excluyentes por contrato del prompt", async (t) => {
  // Esto documenta el contrato (el prompt se lo pide a Sofi); no hay
  // validacion de codigo que lo fuerce, asi que el test deja constancia
  // explicita de la regla para quien lea el esquema despues.
  mockRespuesta(t, {
    es_pedido_real: true, sirve_alguna: true, refs_utiles: ["REF1"],
    por_que: "Calza en todo.", confianza: 0.9, desacuerdo_con_puntaje: "",
    sin_confirmar: [], le_falta: [], refs_dudosas: [],
  });

  const { veredicto } = await revalidar.revalidar(clasificado(), [match()]);
  const interseccion = veredicto.refs_utiles.filter((r) => veredicto.refs_dudosas.includes(r));
  assert.deepStrictEqual(interseccion, []);
});

test("un veredicto VIEJO sin 'refs_dudosas' no rompe apruebaAviso", async (t) => {
  mockRespuesta(t, {
    es_pedido_real: true, sirve_alguna: true, refs_utiles: ["REF1"],
    por_que: "Calza en zona, alcobas y precio.", confianza: 0.9, desacuerdo_con_puntaje: "",
    // sin 'refs_dudosas' a proposito: lo que ya esta guardado antes de este cambio
  });

  const { veredicto } = await revalidar.revalidar(clasificado(), [match()]);
  assert.strictEqual(veredicto.refs_dudosas, undefined);
  assert.strictEqual(revalidar.apruebaAviso(veredicto), true);
});

test("el prompt nombra la situacion DUDOSA y dice que se manda al asesor, no se pierde", () => {
  const s = revalidar.SISTEMA || "";
  assert.ok(s.includes("DUDOSA"), "el prompt nombra la cuarta situacion");
  assert.ok(/refs_dudosas/.test(s), "el prompt dice explicitamente el nombre del campo");
});

test("apruebaAviso: SOLO refs_dudosas (refs_utiles vacio) SI aprueba el aviso -- este era el bug", () => {
  const veredicto = {
    es_pedido_real: true, sirve_alguna: false, refs_utiles: [],
    refs_dudosas: ["REF1"], por_que: "x", confianza: 0.6,
  };
  assert.strictEqual(revalidar.apruebaAviso(veredicto), true);
});

test("apruebaAviso: ni utiles ni dudosas -- no aprueba", () => {
  const veredicto = {
    es_pedido_real: true, sirve_alguna: false, refs_utiles: [],
    refs_dudosas: [], por_que: "x", confianza: 0.6,
  };
  assert.strictEqual(revalidar.apruebaAviso(veredicto), false);
});

// LO QUE NO PODEMOS EVALUAR VA A NATALIA (Juan, 2026-09-04): "no quiero que
// dejemos propiedades por fuera sin saber si hay match, entonces (...) las que
// tengan esas salvedades enviala a natalia cosas como el numero del piso
// especifico o unidad cerrada o jardin privado".
//
// Ni `properties` ni classify.js tienen piso, orientacion ni unidad cerrada.
// Sin dato de los dos lados no se puede declarar un hueco honesto, asi que
// esos pedidos no se responden solos: los mira una persona.
//
// LAS ASERCIONES TIENEN QUE DISCRIMINAR (revision final, 2026-09-04). Antes
// este test buscaba /piso/i y /refs_dudosas/ sueltos, y las dos ya pasaban
// ANTES del cambio: /piso/i matchea el ejemplo "piso bajo" de la seccion
// `sin_confirmar`, que es el ruteo OPUESTO (la propiedad se manda igual, con
// la salvedad). O sea que borrar la instruccion nueva no habria roto nada.
// Ahora se exige la frase entera de la regla, con su destino.
test("el prompt le ordena a Sofi mandar a dudosas lo que no se puede evaluar", () => {
  // Se normalizan los saltos de linea: el prompt esta envuelto a 80 columnas y
  // las frases que este test exige cruzan renglones. Lo que importa es la
  // regla, no donde cae el corte.
  const s = require("../src/groups/revalidar").SISTEMA.replace(/\s+/g, " ");
  assert.match(s, /ATRIBUTOS QUE NO PODEMOS EVALUAR/, "el bloque de la regla nueva");
  assert.match(s, /N[UÚ]MERO DE PISO espec[ií]fico/, "no basta con la palabra 'piso': 'piso bajo' es otra cosa");
  assert.match(s, /UNIDAD CERRADA/);
  assert.match(s, /JARD[IÍ]N PRIVADO/);
  assert.match(s, /ORIENTACI[OÓ]N/);
  // El destino es la mitad de la regla: sin esto, mencionarlos y mandarlos
  // igual seguiria pasando el test.
  assert.match(s, /esas refs van en 'refs_dudosas', NUNCA en 'refs_utiles'/);
});

// El test que estaba aca ("un veredicto con solo dudosas se aprueba (va a la
// asesora) pero no trae utiles") se borro en la revision final del 2026-09-04:
// su unica asercion propia era `v.refs_utiles.length === 0` sobre el literal
// declarado dos lineas antes -- tautologica, no podia fallar -- y el resto ya
// lo cubre "apruebaAviso: SOLO refs_dudosas (refs_utiles vacio) SI aprueba el
// aviso", mas arriba en este archivo.

// EL CERO DE WASI NO ES UN CERO (Juan, 2026-09-04): "no podemos dejar de
// ofrecer un apartamento por un parqueadero".
//
// Caso real de las 15:00 del 2026-09-04 (pedido de Juan Carlos Montes en
// Pedidos Poblado/Envigado): el motor dio 95 y 85, y Sofi descarto las dos —
// "ambas propiedades tienen 0 garajes registrados (...) es un incumplimiento
// de fondo, no accesorio". Hizo lo correcto con un dato falso: medido contra
// produccion, garaje=0 en 39 de las 114 disponibles y garaje=null en CERO, o
// sea que Wasi manda 0 cuando el campo no esta cargado.
test("un garaje en 0 se le muestra a Sofi como 'sin dato', no como 'no tiene'", () => {
  const { formatearCandidatas } = require("../src/groups/revalidar");
  const t = formatearCandidatas([{ ref: "9702941", garajes: 0, banos: 0, estrato: 0, habitaciones: 2 }]);
  assert.match(t, /garajes: sin dato/);
  assert.ok(!/0 garajes/.test(t), "un 0 de Wasi no puede leerse como 'no tiene'");
  assert.match(t, /baños: sin dato/);
  assert.match(t, /estrato: sin dato/);
});

test("un garaje real sigue saliendo con su numero", () => {
  const { formatearCandidatas } = require("../src/groups/revalidar");
  assert.match(formatearCandidatas([{ ref: "1", garajes: 2, banos: 3 }]), /2 garajes/);
  assert.match(formatearCandidatas([{ ref: "1", garajes: 2, banos: 3 }]), /3 baños/);
});

// La lista de "de fondo" es cerrada: Sofi ascendio el parqueadero a "de fondo"
// y descarto. El prompt tiene que cerrarle esa puerta.
test("el prompt cierra la lista de 'de fondo' y deja el parqueadero como accesorio", () => {
  const s = require("../src/groups/revalidar").SISTEMA;
  assert.match(s, /LISTA DE "DE FONDO" ES CERRADA/);
  // El prompt va envuelto a ~70 columnas, asi que la frase puede quedar
  // partida por un salto de linea: se compara tolerando el corte.
  assert.match(s.replace(/\s+/g, " "), /no podemos dejar de ofrecer un apartamento por un parqueadero/);
  assert.ok(!/Si dudas si algo es accesorio o de fondo, tratalo como de FONDO/.test(s),
    "la regla vieja mandaba a de FONDO ante la duda: era el permiso para descartar");
});
