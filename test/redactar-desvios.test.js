// Si la propiedad se desvía de lo que el colega pidió, el mensaje lo DICE.
//
// EL CASO REAL (2026-09-04, auditado el 2026-09-05 contra producción). Marsh
// Jaramillo pidió "apartamento o casa de 2 alcobas sector Envigado
// presupuesto $350.000.000". Le mandamos una propiedad en SABANETA con TRES
// alcobas, y el mensaje no mencionó ninguna de las dos cosas — decía
// simplemente "Tengo esta opcion que puede servirte".
//
// Lo peor es que Sofi SÍ lo sabía: el veredicto guardado dice textual "queda
// en Sabaneta (vecino a Envigado) ... y tiene 3 alcobas (una más de las
// pedidas)". Ese razonamiento se quedaba en la base y nunca llegaba al
// colega. Mismo día, Glovi pidió "Poblado ó Ciudad del Río" y la primera
// opción que recibió fue Las Palmas, tampoco advertido.
//
// El dato no era falso —la propiedad existe, en Sabaneta, a ese precio— pero
// omitir el desvío es lo que quema la credibilidad: el colega abre el mensaje,
// ve otra zona, y concluye que el bot no lee lo que le escriben.
//
// Juan, 2026-09-05: "valida que los mensajes a los colegas sean verdaderos,
// siempre con la informacion que hemos estructurado para que los colegas
// tengan una propuesta de valor".
//
// SE CALCULA, NO SE PREGUNTA. El desvío sale de comparar el pedido con la
// ficha —dos datos que ya tenemos— y no de pedirle al modelo que se acuerde
// de mencionarlo. `le_falta` (que sí lo redacta el modelo) siguió vacío en
// los dos casos de arriba; una regla que depende de que el modelo se acuerde
// no es una garantía.
const { test } = require("node:test");
const assert = require("node:assert");
const redactar = require("../src/groups/redactar");

const APTO_SABANETA = {
  ref: "10013129",
  titulo: "Vendo Apartamento en Sabaneta Villa Romera",
  operacion: "Venta",
  zona: "Sabaneta",
  area: "50m2",
  habitaciones: 3,
  banos: 2,
  precio: "$235.000.000",
  linkWasi: "https://info.wasi.co/apartamento-venta-sabaneta-medellin/10013129?shared=whatsapp",
};

test("zona distinta a la pedida: el mensaje lo aclara", () => {
  const t = redactar.mensajeGrupo({ autor_nombre: "Marsh Jaramillo" }, [APTO_SABANETA], {
    pedido: { zonas: ["Envigado"], habitaciones: 2 },
  });
  assert.match(t, /Sabaneta/);
  assert.match(t, /Envigado/, "no menciona la zona que el colega pidio");
  assert.match(t, /Aclaración/);
});

test("alcobas distintas a las pedidas: tambien se dice", () => {
  const t = redactar.mensajeGrupo({ autor_nombre: "Marsh" }, [APTO_SABANETA], {
    pedido: { zonas: ["Sabaneta"], habitaciones: 2 },
  });
  assert.match(t, /3 alcobas/);
  assert.match(t, /pediste 2|pediste dos/i, `no aclara la diferencia de alcobas:\n${t}`);
});

test("el caso exacto de Marsh: zona Y alcobas en la misma aclaracion", () => {
  const t = redactar.mensajeGrupo({ autor_nombre: "Marsh Jaramillo" }, [APTO_SABANETA], {
    pedido: { zonas: ["Envigado"], habitaciones: 2 },
  });
  const linea = t.split("\n").find((l) => l.includes("Aclaración"));
  assert.ok(linea, "no hay linea de aclaracion");
  assert.match(linea, /Sabaneta/);
  assert.match(linea, /Envigado/);
  assert.match(linea, /alcoba/i);
});

test("si la zona SI es la pedida, no inventa una aclaracion", () => {
  const t = redactar.mensajeGrupo({ autor_nombre: "Ana" }, [APTO_SABANETA], {
    pedido: { zonas: ["Sabaneta"], habitaciones: 3 },
  });
  assert.ok(!t.includes("Aclaración"), `aclaro algo que no hacia falta:\n${t}`);
});

test("sin pedido (camino viejo) el mensaje sale exactamente igual que antes", () => {
  const conPedido = redactar.mensajeGrupo({ autor_nombre: "Ana" }, [APTO_SABANETA], {});
  assert.ok(!conPedido.includes("Aclaración"));
  assert.match(conPedido, /Ref 10013129/);
});

test("la zona se compara sin acentos ni mayusculas", () => {
  const t = redactar.mensajeGrupo({ autor_nombre: "Ana" }, [{ ...APTO_SABANETA, zona: "SABANETÁ" }], {
    pedido: { zonas: ["sabaneta"], habitaciones: 3 },
  });
  assert.ok(!t.includes("Aclaración"), `trato la misma zona como distinta:\n${t}`);
});

test("la aclaracion del modelo y la calculada conviven, sin repetirse", () => {
  const t = redactar.mensajeGrupo({ autor_nombre: "Marsh" }, [APTO_SABANETA], {
    pedido: { zonas: ["Envigado"], habitaciones: 2 },
    leFalta: [{ ref: "10013129", detalle: "no tiene garaje registrado" }],
  });
  const linea = t.split("\n").find((l) => l.includes("Aclaración"));
  assert.match(linea, /Sabaneta/);
  assert.match(linea, /garaje/);
  assert.strictEqual((t.match(/Aclaración/g) || []).length, 1, "duplico la aclaracion");
});

// ── La funcion pura ───────────────────────────────────────────────────────
test("desvios() no inventa cuando falta el dato", () => {
  // Sin habitaciones en el pedido no hay con que comparar: no se dice nada.
  assert.deepStrictEqual(redactar.desvios(APTO_SABANETA, { zonas: ["Sabaneta"] }), []);
  // Sin zonas pedidas tampoco.
  assert.deepStrictEqual(redactar.desvios(APTO_SABANETA, { habitaciones: 3 }), []);
  assert.deepStrictEqual(redactar.desvios(APTO_SABANETA, {}), []);
  assert.deepStrictEqual(redactar.desvios(APTO_SABANETA, null), []);
});

test("desvios() detecta que sobra una alcoba y que falta", () => {
  const sobra = redactar.desvios(APTO_SABANETA, { habitaciones: 2 });
  assert.match(sobra.join(" "), /3 alcobas/);
  const falta = redactar.desvios({ ...APTO_SABANETA, habitaciones: 1 }, { habitaciones: 3 });
  assert.match(falta.join(" "), /1 alcoba/);
});
