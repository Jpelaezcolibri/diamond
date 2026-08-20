const { test } = require("node:test");
const assert = require("node:assert");
const { filtrosInventario, filtrosAliados, mismaOperacion, evaluarOferta } = require("../src/groups/match");

const demanda = {
  clase: "demanda", operacion: "venta", tipo: "apartamento", zona: "Laureles",
  precio_max: 400000000, precio_min: 0, habitaciones: 3,
};

// ── Traducción de claves ─────────────────────────────────────────────────

test("BUG: properties usa precio_max y ally-properties usa precioMax", () => {
  // Sin traducir, el filtro de precio se ignora en silencio en una de las dos
  // fuentes y TODO parece matchear — que es justo lo que haría pasar la
  // compuerta de negocio por la razón equivocada.
  assert.strictEqual(filtrosInventario(demanda).precio_max, 400000000);
  assert.strictEqual(filtrosInventario(demanda).precioMax, undefined);

  assert.strictEqual(filtrosAliados(demanda).precioMax, 400000000);
  assert.strictEqual(filtrosAliados(demanda).precio_max, undefined);
});

test("las habitaciones van como habitaciones_min al inventario propio", () => {
  assert.strictEqual(filtrosInventario(demanda).habitaciones_min, 3);
});

test("los campos vacíos o en cero no se mandan como filtro", () => {
  // Un precio_max: 0 filtraría todo el inventario a nada.
  const sinDatos = { operacion: "", tipo: "", zona: "", precio_max: 0, precio_min: 0, habitaciones: 0 };
  assert.deepStrictEqual(filtrosInventario(sinDatos), {});
  // `origen` no es un dato del pedido sino una regla de negocio, así que va
  // siempre — incluso sin ningún criterio.
  assert.deepStrictEqual(filtrosAliados(sinDatos), { origen: "asesor" });
});

test("REGLA: a un colega sólo se le ofrece lo propio o lo que verificó un asesor", () => {
  // Contestarle a un colega con la propiedad de OTRO colega —que Sofi leyó al
  // pasar en un grupo y que nadie confirmó— pone a Diamond de intermediaria en
  // un negocio ajeno con información sin verificar. Las de origen 'grupo' se
  // usan sólo hacia adentro, para un cliente propio.
  assert.strictEqual(filtrosAliados(demanda).origen, "asesor");
});

test("la operación NO se manda a ally-properties (su comparación es estricta)", () => {
  // ally-properties.matchesFilters compara con !== estricto y la tabla guarda
  // lo que extrajo Claude en su momento ("Venta" / "venta"). Se filtra aparte.
  assert.strictEqual(filtrosAliados(demanda).operacion, undefined);
});

// ── Operación ────────────────────────────────────────────────────────────

test("BUG: una demanda de arriendo no debe matchear propiedades en venta", () => {
  // properties.search() no filtra por operacion; sin este filtro la métrica de
  // negocio de la Fase 0 se infla y la compuerta pasa por la razón equivocada.
  const arriendo = { ...demanda, operacion: "arriendo" };
  assert.strictEqual(mismaOperacion({ operacion: "Venta" }, arriendo), false);
  assert.strictEqual(mismaOperacion({ operacion: "Arriendo" }, arriendo), true);
});

test("la comparación de operación ignora mayúsculas y espacios", () => {
  assert.strictEqual(mismaOperacion({ operacion: "  VENTA " }, demanda), true);
});

test("sin operación en el pedido no se descarta nada", () => {
  // Preferimos un falso positivo (barato, lo revisa el asesor) antes que
  // perder un negocio por un dato que el colega no escribió.
  const sinOperacion = { ...demanda, operacion: "" };
  assert.strictEqual(mismaOperacion({ operacion: "Arriendo" }, sinOperacion), true);
  assert.strictEqual(mismaOperacion({ operacion: "Venta" }, sinOperacion), true);
});

test("una propiedad sin operación registrada no se descarta", () => {
  assert.strictEqual(mismaOperacion({ operacion: null }, demanda), true);
});

// ── Ofertas ──────────────────────────────────────────────────────────────

const oferta = {
  clase: "oferta", operacion: "venta", tipo: "casa", zona: "Sabaneta",
  precio_max: 650000000, precio_min: 0, contacto: "", notas: "3 alcobas",
  mensaje: { autor: "Diana Vélez", texto: "Se vende casa en Sabaneta" },
};

test("una oferta completa es utilizable", () => {
  const r = evaluarOferta(oferta);
  assert.strictEqual(r.utilizable, true);
  assert.deepStrictEqual(r.faltantes, []);
});

test("una oferta sin precio ni zona dice exactamente qué le falta", () => {
  const r = evaluarOferta({ ...oferta, precio_max: 0, zona: "" });
  assert.strictEqual(r.utilizable, false);
  assert.deepStrictEqual(r.faltantes, ["zona", "precio"]);
});

test("el autor del mensaje cuenta como contacto", () => {
  // En vivo el remitente de WhatsApp siempre aporta el teléfono; exigir el
  // contacto del texto subestimaría el rendimiento real del sistema.
  const r = evaluarOferta({ ...oferta, contacto: "" });
  assert.strictEqual(r.faltantes.includes("contacto"), false);
  assert.strictEqual(r.propuesta.contacto_nombre, "Diana Vélez");
});

test("sin autor ni contacto sí falta el contacto", () => {
  const r = evaluarOferta({ ...oferta, contacto: "", mensaje: { autor: null, texto: "x" } });
  assert.deepStrictEqual(r.faltantes, ["contacto"]);
});

test("la propuesta tiene el shape de ally-properties.create y conserva el original", () => {
  const r = evaluarOferta(oferta);
  assert.strictEqual(r.propuesta.tipo, "casa");
  assert.strictEqual(r.propuesta.precio, 650000000);
  assert.strictEqual(r.propuesta.mensaje_original, "Se vende casa en Sabaneta");
});

test("un precio que sólo viene como mínimo también sirve", () => {
  const r = evaluarOferta({ ...oferta, precio_max: 0, precio_min: 500000000 });
  assert.strictEqual(r.utilizable, true);
  assert.strictEqual(r.propuesta.precio, 500000000);
});

// ══ Certeza del match ════════════════════════════════════════════════════
//
// Medido en producción el 2026-07-29: un solo pedido sacó 10 propiedades de
// Robledo a Sabaneta. Un contador de matches que incluye cosas así no informa,
// desinforma — el asesor deja de mirarlo.

const { evaluarCandidata, zonaCoincide, zonaExcluida } = require("../src/groups/match");

const pide = (extra = {}) => ({
  operacion: "venta", tipo: "apartamento", zona: "Laureles",
  precio_min: 0, precio_max: 600000000, habitaciones: 3,
  area_min: 0, banos: 0, garajes: 0, estrato: 0, ...extra,
});

const apto = (extra = {}) => ({
  ref: "9944723", titulo: "Apartamento en Laureles", tipo: "Apartamento",
  operacion: "Venta", precio: "$550.000.000", zona: "Laureles", ciudad: "Medellín",
  habitaciones: 3, banos: 2, garaje: 1, estrato: 5, area: "95 m²",
  link: "https://diamondinmobiliaria.com/propiedades/apto-9944723", ...extra,
});

test("un match completo trae el link de la landing, nunca el de Wasi", () => {
  const m = evaluarCandidata(apto(), pide(), "diamond");
  assert.ok(m, "debería matchear");
  assert.match(m.link, /diamondinmobiliaria\.com\/propiedades\//);
  assert.ok(!/wasi/.test(m.link), "el link nunca puede mandar tráfico a Wasi");
});

test("las razones dicen POR QUE calza: zona, valor y las demás variables", () => {
  const m = evaluarCandidata(apto(), pide({ area_min: 90, banos: 2, garajes: 1, estrato: 4 }), "diamond");
  const texto = m.razones.join(" | ");
  assert.match(texto, /Laureles/);
  assert.match(texto, /\$550M dentro de \$600M/);
  assert.match(texto, /3 alcobas/);
  assert.match(texto, /95 m²/);
  assert.match(texto, /2 baños/);
  assert.match(texto, /1 garaje/);
  assert.match(texto, /estrato 5/);
});

test("BUG: el precio es una banda, no sólo un techo", () => {
  // A un cliente con $600M no se le ofrece uno de $150M: cabe en el
  // presupuesto y no es lo que busca.
  assert.strictEqual(evaluarCandidata(apto({ precio: "$150.000.000" }), pide(), "diamond"), null);
  assert.ok(evaluarCandidata(apto({ precio: "$420.000.000" }), pide(), "diamond"));
});

test("BUG: la zona se compara contra la zona, no contra la ciudad", () => {
  // "Loma del Chocho" no puede matchear con todo Envigado.
  const enEnvigado = apto({ zona: "Las Antillas", ciudad: "Envigado" });
  assert.strictEqual(evaluarCandidata(enEnvigado, pide({ zona: "Envigado" }), "diamond"), null);
});

test("BUG: pedir 3 alcobas no puede traer una de 6", () => {
  assert.strictEqual(evaluarCandidata(apto({ habitaciones: 6 }), pide(), "diamond"), null);
  assert.ok(evaluarCandidata(apto({ habitaciones: 4 }), pide(), "diamond"), "una de más sí sirve");
});

test("un dato que el inventario no tiene NO descalifica la propiedad", () => {
  // El área vacía es un hueco de nuestro sync, no un defecto del inmueble.
  const m = evaluarCandidata(apto({ area: null }), pide({ area_min: 90 }), "diamond");
  assert.ok(m, "no se puede castigar a la propiedad por lo que no sincronizamos");
  assert.ok(!m.razones.join(" ").includes("m²"), "pero tampoco puede alegar un área que no conoce");
});

test("un dato que el inventario SÍ tiene y no cumple, descalifica", () => {
  assert.strictEqual(evaluarCandidata(apto({ area: "60 m²" }), pide({ area_min: 90 }), "diamond"), null);
  assert.strictEqual(evaluarCandidata(apto({ banos: 1 }), pide({ banos: 3 }), "diamond"), null);
  assert.strictEqual(evaluarCandidata(apto({ estrato: 3 }), pide({ estrato: 5 }), "diamond"), null);
});

test("el área se lee bien en el formato REAL de Wasi, sin unidad separada", () => {
  // Regresión del 2026-08-16. El parser viejo quitaba "todo lo que no fuera
  // dígito", así que "92m2" se leía 922: el 2 de la unidad quedaba pegado.
  // Toda área salía inflada ~10x, la compuerta no rechazaba nunca y encima
  // regalaba sus 8 puntos. Los fixtures usaban "95 m²" —con superíndice, que no
  // es dígito— y por eso los tests nunca lo vieron. Se prueba con las dos
  // escrituras a propósito.
  // area_min alto a proposito: 92 (parseado bien, no 922) tiene que rechazarse
  // incluso con el margen de captura del 10% (GRUPOS_MARGEN_AREA).
  assert.strictEqual(evaluarCandidata(apto({ area: "92m2" }), pide({ area_min: 200 }), "diamond"), null);
  assert.strictEqual(evaluarCandidata(apto({ area: "60m2" }), pide({ area_min: 90 }), "diamond"), null);

  const cumple = evaluarCandidata(apto({ area: "113m2" }), pide({ area_min: 100 }), "diamond");
  assert.ok(cumple, "113m2 sí cumple un pedido de 100 m²");
  assert.match(cumple.razones.join(" | "), /113 m²/, "y lo declara con el número real");
});

test("el precio no se infla con los dígitos que trae el texto al lado", () => {
  // Mismo bug, otra columna: "$450.000.000 negociable 2024" se leía
  // 4500000002024. Un precio así pasa cualquier techo por arriba y la
  // propiedad quedaba descartada en silencio (o peor, se publicaba).
  const m = evaluarCandidata(
    apto({ precio: "$450.000.000 negociable 2024" }),
    pide({ precio_max: 600000000 }),
    "diamond"
  );
  assert.ok(m, "el precio real cabe en el presupuesto");
  assert.match(m.razones.join(" | "), /\$450M dentro de \$600M/);
});

test("el que aprovecha el presupuesto puntúa más que el que se queda corto", () => {
  const alto = evaluarCandidata(apto({ precio: "$580.000.000" }), pide(), "diamond");
  const bajo = evaluarCandidata(apto({ precio: "$390.000.000" }), pide(), "diamond");
  assert.ok(alto.puntaje > bajo.puntaje);
});

// MARGEN DE CAPTURA (Juan, 2026-08-20). Caso real que motivo el cambio: un
// cliente busca hasta $700M en Sabaneta y Diamond tiene una de $720M (2.9%
// arriba) — antes se descartaba de plano. El margen relaja precio y area
// (variables que casi nunca son criticas para el cliente); alcobas, banos,
// garajes y estrato siguen exactos.
test("MARGEN: un precio hasta 10% sobre el techo entra, mas alla se descarta igual que antes", () => {
  const techo = 700000000;
  const casiEncima = evaluarCandidata(apto({ precio: "$720.000.000" }), pide({ precio_max: techo }), "diamond");
  assert.ok(casiEncima, "2.9% sobre el techo tiene que entrar dentro del margen del 10%");
  assert.match(casiEncima.razones.join(" | "), /\$720M — 3% sobre \$700M, dentro del margen/);

  const enElLimite = evaluarCandidata(apto({ precio: "$770.000.000" }), pide({ precio_max: techo }), "diamond");
  assert.ok(enElLimite, "exactamente 10% sobre el techo todavia entra");

  const muyArriba = evaluarCandidata(apto({ precio: "$800.000.000" }), pide({ precio_max: techo }), "diamond");
  assert.strictEqual(muyArriba, null, "mas alla del margen se sigue rechazando");
});

test("MARGEN: pasarse del presupuesto no puntua como si hubiera cabido", () => {
  const techo = 700000000;
  const dentro = evaluarCandidata(apto({ precio: "$680.000.000" }), pide({ precio_max: techo }), "diamond");
  const conMargen = evaluarCandidata(apto({ precio: "$720.000.000" }), pide({ precio_max: techo }), "diamond");
  assert.ok(dentro.puntaje > conMargen.puntaje, "el que SI cupo tiene que puntuar mas que el que necesito margen");
});

test("MARGEN: area hasta 10% por debajo de lo pedido entra, mas abajo se descarta igual que antes", () => {
  const casiSuficiente = evaluarCandidata(apto({ area: "92m2" }), pide({ area_min: 100 }), "diamond");
  assert.ok(casiSuficiente, "92 m² para un pedido de 100 m² (8% de menos) entra dentro del margen");

  const enElLimite = evaluarCandidata(apto({ area: "90m2" }), pide({ area_min: 100 }), "diamond");
  assert.ok(enElLimite, "exactamente 10% de menos todavia entra");

  const muyChico = evaluarCandidata(apto({ area: "80m2" }), pide({ area_min: 100 }), "diamond");
  assert.strictEqual(muyChico, null, "mas alla del margen se sigue rechazando");
});

test("MARGEN: alcobas, banos, garajes y estrato NO llevan margen — siguen exactos", () => {
  // Estas si le cambian lo que puede hacer con la propiedad al cliente: no se
  // relajan aunque precio y area si lo hagan.
  assert.strictEqual(evaluarCandidata(apto({ habitaciones: 1 }), pide({ habitaciones: 2 }), "diamond"), null);
  assert.strictEqual(evaluarCandidata(apto({ banos: 1 }), pide({ banos: 2 }), "diamond"), null);
  // garaje: 0 no sirve para esta asercion — el codigo lo trata como "sin
  // dato" (no distingue "confirmado sin garaje" de "no sincronizado"), asi
  // que no descalifica. Se usa un valor con dato real e insuficiente.
  assert.strictEqual(evaluarCandidata(apto({ garaje: 1 }), pide({ garajes: 2 }), "diamond"), null);
  assert.strictEqual(evaluarCandidata(apto({ estrato: 4 }), pide({ estrato: 5 }), "diamond"), null);
});

test("una demanda de arriendo no matchea una propiedad en venta", () => {
  assert.strictEqual(evaluarCandidata(apto(), pide({ operacion: "arriendo" }), "diamond"), null);
});

test("un aliado no lleva link de la landing — no es inventario nuestro", () => {
  const m = evaluarCandidata(apto({ inmobiliaria_origen: "Colega SAS" }), pide(), "aliado");
  assert.strictEqual(m.link, null);
  assert.strictEqual(m.inmobiliaria, "Colega SAS");
});

test("zonaCoincide ignora genéricos: 'loma' sola no ubica nada", () => {
  assert.strictEqual(zonaCoincide({ zona: "Loma del Chocho" }, { zona: "Loma de los Bernal" }), false);
  assert.strictEqual(zonaCoincide({ zona: "Loma de los Bernal" }, { zona: "Loma de Los Bernal" }), true);
});

test("sin zona en el pedido no hay match posible", () => {
  assert.strictEqual(evaluarCandidata(apto(), pide({ zona: "" }), "diamond"), null);
});

test("un pedido de municipio SÍ matchea, pero vale menos que uno de barrio", () => {
  // "Busco casa en Envigado" es negocio real: no se puede tirar. Pero un match
  // de municipio es más débil que uno de barrio y la pantalla debe decirlo.
  const enEnvigado = apto({ zona: "Las Antillas", ciudad: "Envigado" });
  const porMunicipio = evaluarCandidata(enEnvigado, pide({ zona: "", ciudad: "Envigado" }), "diamond");
  assert.ok(porMunicipio, "un pedido de municipio no se puede descartar");
  assert.match(porMunicipio.razones[0], /Ciudad: Envigado/);

  const porBarrio = evaluarCandidata(apto(), pide(), "diamond");
  assert.ok(porBarrio.puntaje > porMunicipio.puntaje, "el barrio exacto tiene que puntuar más");
});

test("nombrar un barrio y estar en otro lejano entra MARCADO y muy castigado", () => {
  // CAMBIO DELIBERADO DEL 2026-08-18. Antes esto devolvía null: era la
  // corrección del bug que generó 656 de los ~731 falsos positivos.
  //
  // Ahora entra, pero de la única forma que no reintroduce aquel bug: con el
  // grado explícito `otra_zona`, con -35 de castigo (recalibrado 2026-08-19,
  // ver la nota en match.js), y —lo que de verdad lo
  // contiene— SIN permiso para publicarse en un grupo (ver group-publicable).
  // El aviso a la asesora sí puede llevarlo porque lo revisa Sofi y después una
  // persona; la publicación pública no tiene a nadie revisando.
  const otroBarrio = apto({ zona: "Robledo", ciudad: "Medellín" });
  const m = evaluarCandidata(otroBarrio, pide({ zona: "Laureles", ciudad: "Medellín" }), "diamond");
  assert.ok(m, "ya no se descarta de plano: se marca y lo juzga Sofi");
  assert.strictEqual(m.ubicacion, "otra_zona");
  assert.match(m.razones[0], /fuera de la zona pedida/);

  // Y sigue puntuando muy por debajo de un barrio exacto.
  const exacto = evaluarCandidata(apto(), pide(), "diamond");
  assert.ok(exacto.puntaje - m.puntaje >= 25, "la distancia en puntaje tiene que ser grande");
});

test("otra CIUDAD sigue siendo compuerta dura", () => {
  // La vecindad es entre zonas del area metropolitana, no entre ciudades. Un
  // apartamento en Cartagena no es una alternativa para un pedido de Medellín.
  const lejos = apto({ zona: "Bocagrande", ciudad: "Cartagena de Indias" });
  assert.strictEqual(evaluarCandidata(lejos, pide({ zona: "Laureles", ciudad: "Medellín" }), "diamond"), null);
});

test("una zona VECINA entra como tal: quien pide El Poblado compra en Envigado", () => {
  const enEnvigado = apto({ zona: "Envigado", ciudad: "Envigado" });
  const m = evaluarCandidata(enEnvigado, pide({ zona: "El Poblado", ciudad: "Medellín" }), "diamond");
  assert.ok(m, "son contiguos: descartarlo perdía negocio real");
  assert.strictEqual(m.ubicacion, "vecina");
  assert.match(m.razones[0], /vecina de lo pedido/);

  // Vecina puntúa menos que exacta, pero mucho más que una zona cualquiera.
  // El pedido lleva ciudad a propósito: sin ella no se puede afirmar que dos
  // barrios estén en la misma, y el grado `otra_zona` no aplica.
  const exacto = evaluarCandidata(apto(), pide({ ciudad: "Medellín" }), "diamond");
  const lejano = evaluarCandidata(apto({ zona: "Robledo" }), pide({ ciudad: "Medellín" }), "diamond");
  assert.ok(exacto.puntaje > m.puntaje && m.puntaje > lejano.puntaje);
});

test("un pedido con VARIAS zonas las cruza todas", () => {
  // Caso real del 2026-08-18: "POBLADO/ENVIGADO". El esquema tenía `zona` como
  // un solo string, Haiku no podía representar las dos y lo dejaba vacío — así
  // el pedido terminaba cruzando contra toda Medellín.
  const enEnvigado = apto({ zona: "Envigado", ciudad: "Envigado" });
  const c = pide({ zona: "El Poblado", zonas: ["El Poblado", "Envigado"], ciudad: "Medellín" });
  const m = evaluarCandidata(enEnvigado, c, "diamond");
  assert.strictEqual(m.ubicacion, "exacta", "Envigado estaba pedido explícitamente");
});

test("BUG REAL: 'Laurel' (unidad de Sabaneta) ya NO matchea 'Laureles' (el barrio)", () => {
  // Caso Patricia, 2026-07-29: "SOLICITO: SABANETA, APARTAMENTO, LAUREL,
  // BULEVAR ALCAZAR, 3 ALCOBAS" ofrecia 6 apartamentos de Laureles porque la
  // comparacion era por substring: "laureles".includes("laurel") = true.
  const pedidoSabaneta = { zona: "Laurel, Bulevar Alcázar", ciudad: "Sabaneta" };
  const aptoLaureles = { zona: "Laureles", ciudad: "Medellín" };
  assert.strictEqual(zonaCoincide(aptoLaureles, pedidoSabaneta), false);
  assert.strictEqual(evaluarCandidata(aptoLaureles, { ...pide(), ...pedidoSabaneta }, "diamond"), null);
});

test("BUG REAL: 'San Joaquin' ya NO matchea 'Loma de San Julian' (el barrio de El Poblado)", () => {
  // Caso Catalina, 2026-08-20: el radar publico 3 propiedades para un pedido
  // en Cumbres/El Poblado, y 2 no tenian ninguna relacion — matchearon
  // "exacta" solo porque "San Joaquin" y "Tierra Firme San German" comparten
  // el token "san" con "Loma de San Julian". Mismo defecto que "Laurel"/
  // "Laureles" en julio, con el prefijo "san" en vez de "loma".
  const sanJoaquin = apto({ zona: "San Joaquin", ciudad: "Medellín" });
  const pedido = { ...pide(), zona: "Loma de San Julián", zonas: ["Loma de San Julián"], ciudad: "Medellín" };
  assert.strictEqual(zonaCoincide(sanJoaquin, pedido), false);
  // Misma ciudad, asi que ya no es null: cae a "otra_zona" (muy castigado y
  // marcado) en vez de "exacta" — publicable.js sigue sin dejarlo publicar,
  // que es lo que de verdad importa para no repetir el caso Catalina.
  const m = evaluarCandidata(sanJoaquin, pedido, "diamond");
  assert.strictEqual(m.ubicacion, "otra_zona");
});

// ZONAS EXCLUIDAS (Juan, 2026-08-20). Caso real: el pedido de Catalina decia
// "❌No Loma del Indio", y ese dato no se guardaba en ningun lado — el motor
// podia ofrecer justo lo que el cliente rechazo. No paso de pura suerte de
// puntaje (quedo en 78, fuera del top 3), pero era cuestion de tiempo.
test("EXCLUSION: una zona rechazada explicitamente nunca matchea, ni siquiera como otra_zona", () => {
  const lomaDelIndio = apto({ zona: "Loma Del Indio", ciudad: "Medellín" });
  const pedido = {
    ...pide(), zona: "Loma de San Julián",
    zonas: ["Loma de San Julián", "El Poblado"], zonas_excluidas: ["Loma del Indio"],
    ciudad: "Medellín",
  };
  assert.strictEqual(zonaExcluida(lomaDelIndio, pedido), true);
  assert.strictEqual(evaluarCandidata(lomaDelIndio, pedido, "diamond"), null);
});

test("EXCLUSION: sin zonas_excluidas en el pedido, todo sigue igual que antes", () => {
  assert.strictEqual(zonaExcluida(apto(), pide()), false);
});

test("EXCLUSION: una zona que NO esta en la lista de rechazadas no se ve afectada", () => {
  const pedido = { ...pide(), zonas_excluidas: ["Robledo"] };
  assert.ok(evaluarCandidata(apto(), pedido, "diamond"), "Laureles no esta excluido, tiene que matchear normal");
});

test("un token completo SIGUE matcheando aunque sea prefijo de otra palabra", () => {
  // El fix no puede volverse tan estricto que rompa coincidencias legitimas:
  // "Belén" pedido debe seguir matcheando una propiedad en "Belén".
  assert.strictEqual(zonaCoincide({ zona: "Belén" }, { zona: "Belén" }), true);
});
