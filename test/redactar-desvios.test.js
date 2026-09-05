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

test("alcobas de MENOS se aclaran; de más, no", () => {
  // CORREGIDO el mismo día que se escribió. Este test pedía que se avisara
  // también cuando SOBRAN alcobas, y eso contradice la regla que el prompt de
  // revalidar.js repite en mayúsculas: SOBRAR NO ES FALLAR. Generando el
  // mensaje real de Patricia Urreta salió "Aclaración: 4 alcobas y pediste 2"
  // — el colega lo lee como una objeción a una propiedad que le da de más.
  const sobran = redactar.mensajeGrupo({ autor_nombre: "Marsh" }, [APTO_SABANETA], {
    pedido: { zonas: ["Sabaneta"], habitaciones: 2 },
  });
  assert.ok(!sobran.includes("Aclaración"), `aclaró que sobran alcobas:\n${sobran}`);

  const faltan = redactar.mensajeGrupo({ autor_nombre: "Marsh" }, [{ ...APTO_SABANETA, habitaciones: 2 }], {
    pedido: { zonas: ["Sabaneta"], habitaciones: 3 },
  });
  assert.match(faltan, /2 alcobas/);
  assert.match(faltan, /pediste 3/);
});

test("el caso exacto de Marsh: zona Y alcobas en la misma aclaracion", () => {
  const t = redactar.mensajeGrupo({ autor_nombre: "Marsh Jaramillo" }, [APTO_SABANETA], {
    pedido: { zonas: ["Envigado"], habitaciones: 2 },
  });
  const linea = t.split("\n").find((l) => l.includes("Aclaración"));
  assert.ok(linea, "no hay linea de aclaracion");
  assert.match(linea, /Sabaneta/);
  assert.match(linea, /Envigado/);
  // Las alcobas de MÁS ya no se mencionan (sobrar no es fallar): el desvío
  // real de este caso siempre fue la zona.
  assert.ok(!/alcoba/i.test(linea), `volvió a tratar las alcobas de más como defecto: ${linea}`);
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

test("desvios() solo habla de lo que FALTA", () => {
  const sobra = redactar.desvios(APTO_SABANETA, { habitaciones: 2 });
  assert.deepStrictEqual(sobra, [], "tratar lo de más como defecto es una objeción, no un dato");
  const falta = redactar.desvios({ ...APTO_SABANETA, habitaciones: 1 }, { habitaciones: 3 });
  assert.match(falta.join(" "), /1 alcoba/);
});

// ── El área que se queda corta ────────────────────────────────────────────
//
// Faltaba (Juan, 2026-09-05, caso Esteban Higuita). Pidió "Área 80m2 en
// adelante" y la ref 9776631 tiene 77 m². Entra por el margen del 10 %
// (GRUPOS_MARGEN_AREA) y está bien que entre — pero el colega tiene que
// leerlo, no descubrirlo abriendo el link. Es el mismo principio que la zona:
// el dato no es falso, la omisión es lo que quema.
const APTO_SABANETA_77 = {
  ref: "9776631",
  titulo: "Venta Apartamento en Sabaneta en Zona Plana",
  operacion: "Venta", zona: "Sabaneta", area: "77m2",
  habitaciones: 3, banos: 2, precio: "$470.000.000",
  linkWasi: "https://info.wasi.co/x/9776631?shared=whatsapp",
};

test("área por debajo de la pedida: el mensaje lo aclara", () => {
  const t = redactar.mensajeGrupo({ autor_nombre: "Esteban" }, [APTO_SABANETA_77], {
    pedido: { zonas: ["Envigado", "Sabaneta"], habitaciones: 3, areaMin: 80 },
  });
  assert.match(t, /Aclaración/);
  assert.match(t, /77/, "no dice el área real");
  assert.match(t, /80/, "no dice la que pidió");
});

test("área que cumple: no inventa una aclaración", () => {
  const t = redactar.mensajeGrupo({ autor_nombre: "Esteban" }, [{ ...APTO_SABANETA_77, area: "83m2" }], {
    pedido: { zonas: ["Sabaneta"], habitaciones: 3, areaMin: 80 },
  });
  assert.ok(!t.includes("Aclaración"), `aclaró algo que no hacía falta:\n${t}`);
});

test("sin área mínima en el pedido no se dice nada", () => {
  assert.deepStrictEqual(redactar.desvios(APTO_SABANETA_77, { zonas: ["Sabaneta"], habitaciones: 3 }), []);
});

test("el caso de Esteban completo: zona bien, alcobas bien, área corta", () => {
  const d = redactar.desvios(APTO_SABANETA_77, { zonas: ["Envigado", "Sabaneta"], habitaciones: 3, areaMin: 80 });
  assert.strictEqual(d.length, 1, `esperaba solo el desvío de área: ${JSON.stringify(d)}`);
  assert.match(d[0], /77.*80|80.*77/);
});

// ── Sobrar no es fallar, y no se repite lo que el modelo ya dijo ──────────
//
// Los dos defectos aparecieron el 2026-09-05 generando el mensaje real para
// Patricia Urreta:
//
//   "Aclaración: 4 alcobas y pediste 2"
//   "Aclaración: 113 m² y pediste desde 120 · tiene 113 m² y pediste mínimo 120"
//
// El primero contradice la regla que el propio prompt de revalidar.js repite
// en mayúsculas — SOBRAR NO ES FALLAR — y que el colega lee como una objeción:
// quien pide 2 alcobas no se queja de que haya 4. El segundo es la misma frase
// dos veces, la calculada y la del modelo.
test("tener MÁS alcobas no se aclara: sobrar no es fallar", () => {
  const d = redactar.desvios({ ...APTO_SABANETA, habitaciones: 4 }, { habitaciones: 2 });
  assert.deepStrictEqual(d, [], `lo trató como un defecto: ${JSON.stringify(d)}`);
});

test("tener MENOS alcobas sí se aclara", () => {
  const d = redactar.desvios({ ...APTO_SABANETA, habitaciones: 2 }, { habitaciones: 3 });
  assert.match(d.join(" "), /2 alcobas/);
});

test("tener MÁS área tampoco se aclara", () => {
  const d = redactar.desvios({ ...APTO_SABANETA, area: "160m2" }, { areaMin: 120 });
  assert.deepStrictEqual(d, []);
});

test("no repite el desvío que el modelo ya escribió", () => {
  const t = redactar.mensajeGrupo({ autor_nombre: "Patricia" }, [{ ...APTO_SABANETA, ref: "9785035", area: "113m2", habitaciones: 2 }], {
    pedido: { zonas: ["El Poblado"], habitaciones: 2, areaMin: 120 },
    leFalta: [{ ref: "9785035", detalle: "tiene 113 m² y pediste mínimo 120" }],
  });
  const linea = t.split("\n").find((l) => l.includes("Aclaración"));
  assert.ok(linea, "no hay aclaración");
  const veces = (linea.match(/113/g) || []).length;
  assert.strictEqual(veces, 1, `dijo lo mismo dos veces: ${linea}`);
});
