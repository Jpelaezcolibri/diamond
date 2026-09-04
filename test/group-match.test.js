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
  // compuerta de negocio por la razón equivocada. Lo que este test fija es la
  // CLAVE de cada fuente; el valor lleva el margen y se prueba abajo.
  const conMargen = Math.round(400000000 * (1 + require("../src/groups/match").MARGEN_PRECIO));
  assert.strictEqual(filtrosInventario(demanda).precio_max, conMargen);
  assert.strictEqual(filtrosInventario(demanda).precioMax, undefined);

  assert.strictEqual(filtrosAliados(demanda).precioMax, conMargen);
  assert.strictEqual(filtrosAliados(demanda).precio_max, undefined);
});

// BUG real (Juan, 2026-09-02 — caso Camilo Loaiza). Mismo error que el de las
// alcobas de mas abajo, en el otro filtro duro de filtrosInventario: el corte
// de precio de la consulta SQL no sabia nada del margen de captura que
// evaluarCandidata SI aplica. La ref 9702941 (Loma Del Esmeraldal, 2 alcobas,
// 1 garaje, $720M, disponible) quedo fuera de un pedido de "Esmeraldal, 2
// habitaciones, 1 parqueadero, hasta $700M" por 20 millones — un 2,9% — con
// un margen configurado del 10% que la aceptaba. El mismo colega, once dias
// antes y con techo de $750M, la habia recibido con puntaje 100.
test("BUG: el prefiltro SQL de precio deja pasar el margen de captura", () => {
  const { MARGEN_PRECIO } = require("../src/groups/match");
  const camilo = { ...demanda, precio_max: 700000000 };
  const techo = filtrosInventario(camilo).precio_max;

  assert.ok(
    techo >= 720000000,
    `la consulta tiene que dejar pasar los $720M de la ref 9702941; corta en ${techo}`
  );
  assert.strictEqual(techo, Math.round(700000000 * (1 + MARGEN_PRECIO)));

  // El margen relaja, no borra: mas alla del techo con margen se sigue
  // cortando en la consulta, igual que antes.
  assert.ok(techo < 800000000, "el margen no puede volverse barra libre");
});

test("las habitaciones van como habitaciones_min al inventario propio", () => {
  assert.strictEqual(filtrosInventario(demanda).habitaciones_min, 3);
});

// BUG real (Juan, 2026-08-21 — caso GLOVI/VC9091): habitaciones_min es un
// .gte() duro en la consulta SQL. Sin este ajuste, una propiedad de 2 alcobas
// quedaba fuera del prefiltro ANTES de que evaluarCandidata pudiera aplicarle
// la flexibilidad de "3 alcobas + estudio" — la ref 8989725 (2 alcobas,
// marcada con prioridad de venta) nunca llegaba a evaluarse para un pedido
// asi, sin importar cuanto puntaje tuviera.
test("BUG: con flexible_habitaciones, el prefiltro SQL acepta una alcoba menos", () => {
  const flexible = { ...demanda, flexible_habitaciones: true };
  assert.strictEqual(filtrosInventario(flexible).habitaciones_min, 2);
});

test("sin flexible_habitaciones, el prefiltro sigue exigiendo el minimo exacto", () => {
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

// FICHA COMPLETA (Juan, 2026-08-20): banos/garajes/estrato ahora viajan en el
// match para que redactar.js los pueda mostrar — antes solo influian el
// puntaje, no salian en el objeto.
test("banos, garajes y estrato viajan en el match, no solo en el puntaje", () => {
  const m = evaluarCandidata(apto(), pide(), "diamond");
  assert.strictEqual(m.banos, 2);
  assert.strictEqual(m.garajes, 1);
  assert.strictEqual(m.estrato, 5);
});

// FLEXIBILIDAD HACIA ARRIBA (Juan, 2026-09-04): "si necesita 2 habitaciones y
// tiene 3 o 4 o 5 por el mismo precio o sobre el rango que definimos, envialo".
// Hasta hoy `ok` cortaba en q+1, asi que un pedido de 2 alcobas descartaba en
// silencio una propiedad de 4 que calzaba en zona y precio. Medido: el tope
// aplicaba a 499 de 664 demandas reales (75%).
test("un pedido de 2 alcobas acepta una propiedad de 4", () => {
  const m = evaluarCandidata(apto({ habitaciones: 4 }), pide({ habitaciones: 2 }), "diamond");
  assert.ok(m, "una propiedad con alcobas de sobra no se puede descartar");
  assert.match(m.razones.join(" | "), /4 alcobas/);
});

// La decision del 2026-08-20 sigue viva: abrir la compuerta no puede cambiar
// el orden. "la que calza exacto deberia tener el puntaje mayor" (Juan).
test("la que calza exacto puntua mas alto que la que tiene alcobas de sobra", () => {
  const exacta = evaluarCandidata(apto({ habitaciones: 2 }), pide({ habitaciones: 2 }), "diamond");
  const sobra = evaluarCandidata(apto({ habitaciones: 4 }), pide({ habitaciones: 2 }), "diamond");
  assert.ok(exacta.puntaje > sobra.puntaje, `exacta ${exacta.puntaje} debe superar a sobra ${sobra.puntaje}`);
});

// Hacia ABAJO no se abre nada: las alcobas definen el producto. Quien acepte
// una menos lo sigue diciendo con flexible_habitaciones.
test("un pedido de 3 alcobas sigue descartando una propiedad de 2", () => {
  assert.strictEqual(evaluarCandidata(apto({ habitaciones: 2 }), pide({ habitaciones: 3 }), "diamond"), null);
});

// PRIORIDAD DE VENTA (Juan, 2026-08-21): ref 8989725 registrada por Catherine
// con "urgencia de venta" — el pedido fue que ESA propiedad puntualmente
// sume puntaje extra, sin tocar el resto del inventario.
const { BONUS_PRIORIDAD_VENTA } = require("../src/groups/match");

test("PRIORIDAD DE VENTA: una propiedad marcada suma el bonus configurado", () => {
  const normal = evaluarCandidata(apto(), pide(), "diamond");
  const prioritaria = evaluarCandidata(apto({ prioridad_venta: true }), pide(), "diamond");
  assert.strictEqual(prioritaria.puntaje, Math.min(100, normal.puntaje + BONUS_PRIORIDAD_VENTA));
  assert.match(prioritaria.razones.join(" | "), /prioridad de venta/);
});

test("PRIORIDAD DE VENTA: no aplica a propiedades de aliados", () => {
  const aliado = { ...apto({ prioridad_venta: true }) };
  const normal = evaluarCandidata(aliado, pide(), "aliado");
  const marcada = evaluarCandidata({ ...aliado, prioridad_venta: true }, pide(), "aliado");
  assert.strictEqual(marcada.puntaje, normal.puntaje, "el bonus es solo para inventario propio (diamond)");
});

test("PRIORIDAD DE VENTA: sin la bandera no cambia nada", () => {
  const sinBandera = evaluarCandidata(apto({ prioridad_venta: false }), pide(), "diamond");
  const sinCampo = evaluarCandidata(apto(), pide(), "diamond");
  assert.strictEqual(sinBandera.puntaje, sinCampo.puntaje);
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

// SUPERADO por FLEXIBILIDAD HACIA ARRIBA (Juan, 2026-09-04): el tope de
// "3 alcobas no puede traer una de 6" era la regla del 2026-08-20. Juan la
// revirtió explícitamente: "si necesita 2 habitaciones y tiene 3 o 4 o 5 por
// el mismo precio o sobre el rango que definimos, envialo". Ver los tests
// "FLEXIBILIDAD HACIA ARRIBA" más abajo — este solo confirma que 4 sigue
// sirviendo, ya sin el tope que antes rechazaba a partir de 6.
test("una alcoba de sobra, aunque sean varias de más, ya no descarta la propiedad", () => {
  assert.ok(evaluarCandidata(apto({ habitaciones: 6 }), pide(), "diamond"), "6 alcobas ante un pedido de 3 ya no se descarta");
  assert.ok(evaluarCandidata(apto({ habitaciones: 4 }), pide(), "diamond"), "una de más sí sirve");
});

// FLEXIBILIDAD POR INTENCION (Juan, 2026-08-20): "depende de si menciona
// 'estudio' o 'para inversion'" — solo esos dos pedidos aceptan una alcoba,
// bano o parqueadero MENOS de lo pedido. Sin la señal, sigue siendo estricto.
test("FLEXIBLE: sin la señal del clasificador, pedir 3 alcobas SIGUE sin aceptar 2", () => {
  assert.strictEqual(evaluarCandidata(apto({ habitaciones: 2 }), pide({ habitaciones: 3 }), "diamond"), null);
});

test("FLEXIBLE: con flexible_habitaciones, pedir 3 alcobas SI acepta 2", () => {
  const m = evaluarCandidata(apto({ habitaciones: 2 }), pide({ habitaciones: 3, flexible_habitaciones: true }), "diamond");
  assert.ok(m, "el pedido dijo 'estudio' o 'para inversion': una de menos tiene que servir");
  assert.match(m.razones.join(" | "), /2 alcobas/);
});

test("FLEXIBLE: sigue sin aceptar DOS de menos, ni con la señal activa", () => {
  assert.strictEqual(evaluarCandidata(apto({ habitaciones: 1 }), pide({ habitaciones: 3, flexible_habitaciones: true }), "diamond"), null);
});

test("FLEXIBLE: baños y garajes reciben el MISMO margen que alcobas — antes eran estrictos", () => {
  // REVERTIDO (Juan, 2026-09-04): "si no tiene si no un parqueadero o no esta
  // registrado si tiene o no parqueadero, envialo con la observacion". Las dos
  // aserciones de abajo afirmaban la regla vieja (sin flexible_habitaciones,
  // quedarse corto en baños/garajes descartaba) -- esa regla es justo la que
  // esta tarea elimina, asi que ahora SI entran, sin necesidad de la señal.
  //
  // garaje:0/banos:0 en el inventario se leen como "sin dato" (no
  // descalifica, pero tampoco entra en esta prueba) — se usa 1 real contra
  // un pedido de 2, que es justo el caso "una de menos" que se esta probando.
  assert.ok(evaluarCandidata(apto({ banos: 1 }), pide({ banos: 2 }), "diamond"), "sin la señal, un baño menos ya entra igual");
  assert.ok(evaluarCandidata(apto({ garaje: 1 }), pide({ garajes: 2 }), "diamond"), "lo mismo para garajes");

  const conBanos = evaluarCandidata(apto({ banos: 1 }), pide({ banos: 2, flexible_habitaciones: true }), "diamond");
  const conGarajes = evaluarCandidata(apto({ garaje: 1 }), pide({ garajes: 2, flexible_habitaciones: true }), "diamond");
  assert.ok(conBanos, "con la señal, un baño menos tiene que servir");
  assert.ok(conGarajes, "con la señal, un garaje menos tiene que servir");
});

// EL RESCATE DEL 24-AGO, DESBLOQUEADO (Juan, 2026-09-04). revalidar.js tiene
// `le_falta` desde el caso Edwin Ramirez -- "al menos el apartamento de el
// portal si se podia enviar con la aclaracion de que solo le falta un
// parqueadero de todo el pedido". Pero match.js descartaba la propiedad ANTES
// de que Sofi la viera: `ok: t >= q` solo aflojaba con flexible_habitaciones,
// true en 49 de 664 demandas (7,4%). Como `corto` exige que ok() haya pasado,
// CASTIGO_CORTO.garajes era codigo inalcanzable.
test("un pedido de 2 garajes acepta una propiedad de 1, y lo dice", () => {
  const m = evaluarCandidata(apto({ garaje: 1 }), pide({ garajes: 2 }), "diamond");
  assert.ok(m, "quedarse corto en un garaje no puede descartar la propiedad");
  assert.match(m.razones.join(" | "), /1 garaje \(pediste 2\)/);
});

test("un pedido de 3 banos acepta una propiedad de 2, y lo dice", () => {
  const m = evaluarCandidata(apto({ banos: 2 }), pide({ banos: 3 }), "diamond");
  assert.ok(m, "quedarse corto en un bano no puede descartar la propiedad");
  assert.match(m.razones.join(" | "), /2 baños \(pediste 3\)/);
});

// El castigo deja de ser codigo muerto: quedarse corto entra, pero nunca
// puede empatar con la que cumple.
test("la que cumple los garajes puntua mas que la que se queda corta", () => {
  const cumple = evaluarCandidata(apto({ garaje: 2 }), pide({ garajes: 2 }), "diamond");
  const corta = evaluarCandidata(apto({ garaje: 1 }), pide({ garajes: 2 }), "diamond");
  assert.ok(cumple.puntaje > corta.puntaje, `cumple ${cumple.puntaje} debe superar a corta ${corta.puntaje}`);
});

// Sin dato sigue siendo neutro, no un descarte: el hueco lo declara Sofi en
// sin_confirmar. Una propiedad sin garaje registrado no puede desaparecer.
test("una propiedad sin garaje registrado sigue entrando", () => {
  assert.ok(evaluarCandidata(apto({ garaje: null }), pide({ garajes: 2 }), "diamond"));
  assert.ok(evaluarCandidata(apto({ garaje: 0 }), pide({ garajes: 2 }), "diamond"));
});

test("FLEXIBLE: estrato NO es flexible — no es una preferencia de espacio, es la clasificacion del sector", () => {
  const m = evaluarCandidata(apto({ estrato: 3 }), pide({ estrato: 5, flexible_habitaciones: true }), "diamond");
  assert.strictEqual(m, null, "un estrato de menos no puede colarse aunque el pedido sea 'para inversion'");
});

test("FLEXIBLE: alcobas exacto sigue puntuando mas que la de menos permitida por flexibilidad", () => {
  const exacta = evaluarCandidata(apto({ habitaciones: 3 }), pide({ habitaciones: 3, flexible_habitaciones: true }), "diamond");
  const unaDeMenos = evaluarCandidata(apto({ habitaciones: 2 }), pide({ habitaciones: 3, flexible_habitaciones: true }), "diamond");
  assert.ok(exacta.puntaje > unaDeMenos.puntaje);
});

test("un dato que el inventario no tiene NO descalifica la propiedad", () => {
  // El área vacía es un hueco de nuestro sync, no un defecto del inmueble.
  const m = evaluarCandidata(apto({ area: null }), pide({ area_min: 90 }), "diamond");
  assert.ok(m, "no se puede castigar a la propiedad por lo que no sincronizamos");
  assert.ok(!m.razones.join(" ").includes("m²"), "pero tampoco puede alegar un área que no conoce");
});

// ACOTADO (Juan, 2026-09-04): "si no tiene si no un parqueadero o no esta
// registrado si tiene o no parqueadero, envialo con la observacion". El
// principio sigue vivo, pero ya no vale para baños ni garajes -- esos ahora
// entran igual, con la aclaracion (ver los tests "BAÑOS Y GARAJES YA NO
// DESCARTAN" mas abajo). Se saca esa aserción de aca y se deja el test
// afirmando el principio en area y estrato, donde SÍ sigue valiendo.
test("un dato que el inventario SÍ tiene y no cumple descalifica — salvo baños y garajes, que ahora entran con aclaración", () => {
  assert.strictEqual(evaluarCandidata(apto({ area: "60 m²" }), pide({ area_min: 90 }), "diamond"), null);
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

// ACOTADO (Juan, 2026-09-04): "si no tiene si no un parqueadero o no esta
// registrado si tiene o no parqueadero, envialo con la observacion". Baños y
// garajes dejaron de ser exactos -- ya entran cortos, con margen de facto
// (ver los tests "BAÑOS Y GARAJES YA NO DESCARTAN" mas abajo), asi que ya no
// pertenecen aca. Lo que de verdad sigue exacto: estrato (siempre, no lleva
// gabela de flexibilidad) y alcobas hacia abajo cuando el pedido NO trae
// flexible_habitaciones.
test("MARGEN: estrato, y alcobas hacia abajo sin flexible_habitaciones, NO llevan margen — siguen exactos", () => {
  // Estas si le cambian lo que puede hacer con la propiedad al cliente: no se
  // relajan aunque precio y area si lo hagan.
  assert.strictEqual(evaluarCandidata(apto({ habitaciones: 1 }), pide({ habitaciones: 2 }), "diamond"), null);
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

// ══ Auditoria del veredicto de Sofi en modo asistido (Juan, 2026-08-20) ═══
//
// "necesito que hagas una auditoria de los mensajes que se aprobaron y de
// los que no para que aprendas del resultado, corrigete y afina el motor de
// scoring". Con datos reales (28 señales con veredicto de Sofi, 18 con
// desacuerdo explicito contra el puntaje) aparecieron tres patrones
// consistentes, cada uno con su fix abajo.

const { sinDuplicados } = require("../src/groups/match");

// PATRON 1 (4 desacuerdos independientes): una propiedad de aliado —sin ref,
// sin area, sin alcobas, sin nada verificable mas alla de zona y precio—
// puntuaba IGUAL que una nuestra que confirmo varios datos. ally_properties
// no tiene columnas de area/habitaciones/banos (confirmado contra el schema
// real): esas propiedades NUNCA pueden ganar esos puntos, asi que no son
// comparables con las nuestras en igualdad de condiciones.
test("SCORING: una propiedad de aliado puntua menos que una nuestra identica en zona y precio", () => {
  const diamond = evaluarCandidata(apto(), pide(), "diamond");
  const aliado = evaluarCandidata(apto({ ref: null }), pide(), "aliado");
  assert.ok(diamond.puntaje > aliado.puntaje, "el aliado no puede tener el mismo puntaje sin nada verificado");
  assert.strictEqual(diamond.puntaje - aliado.puntaje, 8);
});

// PATRON 2 (1 desacuerdo, senal 640172eb): "la de 4 alcobas tiene puntaje mas
// alto pero sirve menos [que la de 3, cuando pidieron 3]... deberia tener el
// puntaje mayor [la exacta]". La compuerta ya dejaba pasar t===q+1 (una de
// mas); lo que no hacia era puntuarla distinto de la exacta.
test("SCORING: pedir 3 alcobas y encontrar exactamente 3 puntua mas que encontrar 4", () => {
  const exacta = evaluarCandidata(apto({ habitaciones: 3 }), pide({ habitaciones: 3 }), "diamond");
  const unaDeMas = evaluarCandidata(apto({ habitaciones: 4 }), pide({ habitaciones: 3 }), "diamond");
  assert.ok(exacta && unaDeMas, "las dos tienen que pasar la compuerta");
  assert.ok(exacta.puntaje > unaDeMas.puntaje);
});

// PATRON 3 (2 desacuerdos): "San Joaquin es parte de Laureles" / "Rodeo Alto
// [...] estan dentro de Belen, no son 'vecinas' sino que estan EN la zona
// pedida" — el motor las calificaba 'vecina' cuando son exactamente lo
// pedido, solo que con otro nombre.
test("SCORING: San Joaquin cuenta como zona EXACTA de un pedido en Laureles, no vecina", () => {
  const m = evaluarCandidata(apto({ zona: "San Joaquín" }), pide({ zona: "Laureles" }), "diamond");
  assert.ok(m);
  assert.strictEqual(m.ubicacion, "exacta");
});

test("SCORING: Rodeo Alto cuenta como zona EXACTA de un pedido en Belen, no vecina", () => {
  const m = evaluarCandidata(apto({ zona: "Rodeo Alto" }), pide({ zona: "Belén" }), "diamond");
  assert.ok(m);
  assert.strictEqual(m.ubicacion, "exacta");
});

// Caso Alberto Posada (Juan, 2026-08-21, pedido codigo 629): "las palmas se
// puede tomar como poblado, hace parte de El Poblado". Antes calificaba
// 'vecina' (-5, 58 puntos, bajo el umbral de publicacion) y se descartaba;
// ahora 'exacta' (+20), igual que San Joaquin/Laureles y Rodeo Alto/Belen.
test("SCORING: Las Palmas cuenta como zona EXACTA de un pedido en El Poblado, no vecina", () => {
  const m = evaluarCandidata(apto({ zona: "Las Palmas" }), pide({ zona: "El Poblado" }), "diamond");
  assert.ok(m);
  assert.strictEqual(m.ubicacion, "exacta");
});

test("SCORING: la contencion de sub-zona no es simetrica — pedir San Joaquin y encontrar Laureles sigue siendo VECINA, no exacta", () => {
  // La contencion solo promueve subzona -> zona madre a exacta (San Joaquin
  // ES Laureles). Al reves, "Laureles" es el barrio entero, mas grande que
  // lo pedido: sigue matcheando por la vecindad YA declarada
  // (["laureles","joaquin"] en zonas.js, de antes de este fix), pero como
  // 'vecina', no como si fuera exactamente lo pedido.
  const m = evaluarCandidata(apto({ zona: "Laureles" }), pide({ zona: "San Joaquín" }), "diamond");
  assert.ok(m);
  assert.strictEqual(m.ubicacion, "vecina");
});

// DUPLICADOS (senal 3cdbee86): un pedido real trajo 6 candidatas, 5 la MISMA
// casa de "Alto de Las Palmas" republicada por el colega con el titulo
// apenas distinto cada vez — ally_properties no dedupea al guardar. Con el
// tope de 6, esas repeticiones tapaban cualquier otra propiedad real.
test("DUPLICADOS: la misma propiedad de aliado repetida con distinto titulo se colapsa en una sola", () => {
  const base = { fuente: "aliado", zona: "Alto de Las Palmas, vía aeropuerto", precio: "$4.000.000.000", puntaje: 67 };
  const matches = [
    { ...base, titulo: "Casa de diseño exclusivo Alto de Las Palmas" },
    { ...base, titulo: "Casa de diseño exclusivo en Alto de Las Palmas", puntaje: 70 },
    { ...base, titulo: "Casa en el alto de Las Palmas, vía aeropuerto" },
    { fuente: "aliado", zona: "Sabaneta", precio: "$655.000.000", puntaje: 60, titulo: "Otra propiedad, distinta de verdad" },
  ];
  const out = sinDuplicados(matches);
  assert.strictEqual(out.length, 2, "las 3 copias de Las Palmas colapsan en 1, Sabaneta queda aparte");
});

test("DUPLICADOS: dos propiedades distintas del mismo colega y misma zona NO se confunden si el precio difiere", () => {
  const matches = [
    { fuente: "aliado", zona: "Laureles", precio: "$500.000.000", puntaje: 65, titulo: "Apto A" },
    { fuente: "aliado", zona: "Laureles", precio: "$700.000.000", puntaje: 63, titulo: "Apto B" },
  ];
  assert.strictEqual(sinDuplicados(matches).length, 2);
});

test("DUPLICADOS: sin la funcion de arriba, dos fuentes distintas (nuestra y de aliado) nunca se confunden entre si", () => {
  const matches = [
    { fuente: "diamond", zona: "Laureles", precio: "$500.000.000", puntaje: 85, titulo: "Nuestra" },
    { fuente: "aliado", zona: "Laureles", precio: "$500.000.000", puntaje: 65, titulo: "Del colega" },
  ];
  assert.strictEqual(sinDuplicados(matches).length, 2);
});

// ── CASTIGO POR CUMPLIR CORTO ────────────────────────────────────────────
//
// Caso real (Juan, 2026-08-24 — Edwin Ramirez, grupo SOLO Envigado): para un
// pedido de 3 alcobas, la ref 8989725 (2 alcobas, 92 m²) y la ref 10077095
// (3 alcobas, 100 m², que SI cumplia) mostraban las dos 100% en el panel.
// La gabela decide SI una propiedad pasa; el puntaje tiene que decir QUE TAN
// BIEN calza, y hasta ese dia quedarse corto seguia sumando.

const { CASTIGO_CORTO } = require("../src/groups/match");

test("quedarse corto en alcobas cuesta puntaje, no lo suma", () => {
  const pedido = pide({ habitaciones: 3, flexible_habitaciones: true });
  const cumple = evaluarCandidata(apto({ habitaciones: 3 }), pedido, "diamond");
  const corto = evaluarCandidata(apto({ habitaciones: 2 }), pedido, "diamond");

  assert.ok(corto, "la gabela la sigue dejando pasar: no es una compuerta nueva");
  assert.ok(corto.puntaje < cumple.puntaje, "la que cumple tiene que rankear por encima");
});

test("la razon dice que se quedo corta -- '2 alcobas' al lado de un 100% se leia como match perfecto", () => {
  const m = evaluarCandidata(apto({ habitaciones: 2 }), pide({ habitaciones: 3, flexible_habitaciones: true }), "diamond");
  assert.ok(m.razones.join(" | ").includes("2 alcobas (pediste 3)"));
});

test("cumplir de MAS no se castiga: una alcoba de sobra no es un incumplimiento", () => {
  const pedido = pide({ habitaciones: 3 });
  const conUnaMas = evaluarCandidata(apto({ habitaciones: 4 }), pedido, "diamond");
  assert.ok(conUnaMas.razones.join(" | ").includes("4 alcobas"));
  assert.ok(!conUnaMas.razones.join(" | ").includes("pediste"));
});

test("area, baños y garajes cortos tambien cuestan, cada uno lo suyo", () => {
  const base = { habitaciones: 3, flexible_habitaciones: true, area_min: 100, banos: 3, garajes: 2 };
  const cumpleTodo = apto({ habitaciones: 3, area: "100 m²", banos: 3, garaje: 2 });
  const lleno = evaluarCandidata(cumpleTodo, pide(base), "diamond");

  for (const [campo, corto] of [
    ["area", { area: "95 m²" }],       // dentro del margen del 10%, pero corto
    ["banos", { banos: 2 }],
    ["garajes", { garaje: 1 }],
  ]) {
    const m = evaluarCandidata({ ...cumpleTodo, ...corto }, pide(base), "diamond");
    assert.ok(m, `${campo} corto sigue pasando la gabela`);
    assert.strictEqual(
      m.puntaje, lleno.puntaje - CASTIGO_CORTO[campo],
      `${campo}: el castigo aplicado es exactamente el declarado`
    );
  }
});

// EL PUNTO DE TODO ESTO: el castigo se resta DESPUES del tope de 100. Sumado
// adentro, Math.min(100, ...) se lo volveria a tragar — que es exactamente
// como las dos propiedades del caso Edwin terminaron empatadas en 100%.
test("nada con un requisito incumplido puede mostrar 100%, por mas puntos que acumule", () => {
  // Todo a favor: zona exacta, prioridad de venta, precio que aprovecha el
  // presupuesto, y cada exigencia cumplida menos las alcobas.
  const pedido = pide({ habitaciones: 3, flexible_habitaciones: true, area_min: 90, banos: 2, garajes: 1, estrato: 4 });
  const m = evaluarCandidata(apto({ habitaciones: 2, prioridad_venta: true }), pedido, "diamond");

  assert.ok(m.puntaje < 100, `deberia estar bajo 100 y dio ${m.puntaje}`);
  assert.strictEqual(m.puntaje, 100 - CASTIGO_CORTO.habitaciones);
});

test("100% vuelve a significar 'cumple todo lo que se pudo verificar'", () => {
  const pedido = pide({ habitaciones: 3, area_min: 90, banos: 2, garajes: 1, estrato: 4 });
  const m = evaluarCandidata(apto({ prioridad_venta: true }), pedido, "diamond");
  assert.strictEqual(m.puntaje, 100);
  assert.ok(!m.razones.join(" | ").includes("pediste"));
});

test("pasarse del presupuesto dentro del margen tambien cuesta", () => {
  const pedido = pide({ precio_max: 600000000 });
  const adentro = evaluarCandidata(apto({ precio: "$550.000.000" }), pedido, "diamond");
  const encima = evaluarCandidata(apto({ precio: "$630.000.000" }), pedido, "diamond");

  assert.ok(encima, "el margen del 10% la sigue dejando pasar");
  assert.ok(encima.puntaje < adentro.puntaje);
  assert.ok(encima.razones.join(" | ").includes("dentro del margen"));
});

test("el estrato no lleva castigo: sin gabela no hay forma de quedarse corto", () => {
  // ok es t >= q, asi que un estrato por debajo se descarta de plano — nunca
  // llega a la rama del castigo.
  assert.strictEqual(CASTIGO_CORTO.estrato, undefined);
  assert.strictEqual(evaluarCandidata(apto({ estrato: 3 }), pide({ estrato: 5 }), "diamond"), null);
});

test("un dato que el inventario no tiene no se castiga -- lo desconocido no descalifica", () => {
  // El principio de siempre (ver la cabecera de match.js): si el sync de Wasi
  // no trajo el area, el hueco es nuestro, no un defecto del inmueble. No
  // suma confianza, pero tampoco se le cobra el castigo de haberse quedado
  // corto -- que es lo que pasaria si "sin dato" se tratara como "0 m²".
  const sinDato = apto({ area: null });
  const conExigencia = evaluarCandidata(sinDato, pide({ area_min: 100 }), "diamond");
  const sinExigencia = evaluarCandidata(sinDato, pide({ area_min: 0 }), "diamond");

  assert.ok(conExigencia, "sigue pasando");
  assert.strictEqual(
    conExigencia.puntaje, sinExigencia.puntaje,
    "pedir un area que no tenemos registrada no cambia el puntaje en ninguna direccion"
  );
  assert.ok(!conExigencia.razones.join(" | ").includes("pediste"));
});

// LA APERTURA HACIA ARRIBA ESTA CONDICIONADA AL PRESUPUESTO (revision final,
// 2026-09-04). El pedido de Juan fue "si necesita 2 habitaciones y tiene 3 o 4
// o 5 POR EL MISMO PRECIO O SOBRE EL RANGO QUE DEFINIMOS" — la banda de precio
// no es un detalle de la frase, es lo que hace segura la apertura.
//
// Sin `precio_max` ni `precio_min` el bloque de precio de evaluarCandidata no
// corre: no queda ni banda ni tope de alcobas, y la propiedad pasa sin NINGUNA
// compuerta de tamaño. Medido antes del fix: este mismo caso devolvia puntaje
// 81 con ubicacion exacta, o sea candidata a DM.
test("sin presupuesto, un pedido de 2 alcobas NO acepta una de 9", () => {
  const sinPrecio = {
    operacion: "venta", tipo: "apartamento", zona: "Laureles",
    precio_min: 0, precio_max: 0, habitaciones: 2,
  };
  const mansion = apto({ habitaciones: 9, area: "600 m²", precio: "$2.500.000.000" });
  assert.strictEqual(
    evaluarCandidata(mansion, sinPrecio, "diamond"),
    null,
    "sin banda de precio, el tope de alcobas es la unica compuerta de tamaño que queda"
  );
});

test("CON presupuesto, un pedido de 2 alcobas SI acepta una de 5 (lo que Juan pidio)", () => {
  const m = evaluarCandidata(apto({ habitaciones: 5 }), pide({ habitaciones: 2 }), "diamond");
  assert.ok(m, "dentro de la banda de precio, tres alcobas de mas no pueden descartar");
  assert.match(m.razones.join(" | "), /5 alcobas/);
});
