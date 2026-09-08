// Por que una propiedad no salio, dicho para que lo entienda una persona.
//
// BUG REAL (Juan, 2026-09-06). Juan le pidio a Sofi que le mandara al colega
// la 9921388, la de Loma de los Balsos, que era la que mejor calzaba con el
// pedido. No salio, y Sofi le contesto que el colega "no tiene teléfono
// registrado en el sistema — solo aparece el nombre del WhatsApp", y le
// ofrecio tres alternativas basadas en conseguir ese numero.
//
// Las dos afirmaciones eran falsas:
//
//   1. El DM a ese colega YA habia salido esa mañana a las 07:56, por @lid
//      (politica_traza: ["destino:lid", ...]). El @lid es el canal principal
//      desde el 2026-09-04 y no necesita telefono.
//   2. La razon real de que ESA ref no fuera es otra y esta en el codigo:
//      `ref_bloqueada`. La 9921388 esta en GRUPOS_REFS_BLOQUEADAS porque tiene
//      el precio mal cargado en Wasi.
//
// El motivo existia, era correcto y era exacto. Lo que no existia era una
// traduccion, asi que quien lo leyo puso una explicacion inventada en su
// lugar. Estos tests fijan que los motivos salgan en castellano.

const { test } = require("node:test");
const assert = require("node:assert");

const publicable = require("../src/groups/publicable");

test("ref_bloqueada explica que el dato esta mal en Wasi y que se corrige alla", () => {
  const texto = publicable.explicarMotivos(["ref_bloqueada"]);
  assert.match(texto, /Wasi/);
  assert.doesNotMatch(texto, /ref_bloqueada/, "el identificador crudo no le dice nada a una persona");
});

test("la 9921388 sigue bloqueada por defecto: es el caso que motivo esto", () => {
  assert.ok(publicable.REFS_BLOQUEADAS.has("9921388"));
});

test("todos los motivos que el filtro puede producir tienen traduccion", () => {
  // Si se agrega un motivo nuevo en publicable.js y no se traduce, este test
  // falla: un motivo sin traducir es un hueco que alguien va a rellenar
  // inventando.
  const producidos = [
    "no_es_inventario_propio", "zona_no_publicable", "puntaje_bajo", "sin_ref",
    "ref_bloqueada", "sin_titulo", "sin_precio", "precio_fuera_de_rango",
    "sin_zona", "sin_area", "sin_link", "link_ajeno", "sin_link_wasi",
    "sync_viejo", "link_no_abre",
  ];
  const faltan = producidos.filter((m) => !publicable.MOTIVOS_LEGIBLES[m]);
  assert.deepStrictEqual(faltan, [], `sin traduccion: ${faltan.join(", ")}`);
});

test("un motivo desconocido se devuelve crudo, no se traga", () => {
  assert.match(publicable.explicarMotivos(["motivo_nuevo_sin_traducir"]), /motivo_nuevo_sin_traducir/);
});

test("varios motivos se listan juntos", () => {
  const texto = publicable.explicarMotivos(["sin_precio", "sin_area"]);
  assert.match(texto, /precio/);
  assert.match(texto, /área/);
});

// ── LAS DOS CLASES DE "NO" (Juan, 2026-09-07) ────────────────────────────
//
// Tratar "no se puede publicar sin supervision" como "nunca se ofrece" le
// borro a la asesora las propiedades que ella justamente existe para juzgar,
// contra el invariante escrito en src/groups/ubicacion.js:134-137. La
// clasificacion vive al lado de los motivos, y estos tests la fijan.

test("cada motivo que el filtro produce esta clasificado, y en una sola clase", () => {
  const producidos = [
    "no_es_inventario_propio", "zona_no_publicable", "puntaje_bajo", "sin_ref",
    "ref_bloqueada", "sin_titulo", "sin_precio", "precio_fuera_de_rango",
    "sin_zona", "sin_area", "sin_link", "link_ajeno", "sin_link_wasi",
    "sync_viejo", "link_no_abre", "periodo_no_soportado", "amoblado_sin_confirmar",
  ];
  const sinClase = producidos.filter(
    (m) => !publicable.MOTIVOS_SOLO_PUBLICACION.has(m) && !publicable.MOTIVOS_NUNCA_OFRECER.has(m)
  );
  assert.deepStrictEqual(sinClase, [], `sin clasificar: ${sinClase.join(", ")}`);
  const enLasDos = producidos.filter(
    (m) => publicable.MOTIVOS_SOLO_PUBLICACION.has(m) && publicable.MOTIVOS_NUNCA_OFRECER.has(m)
  );
  assert.deepStrictEqual(enLasDos, [], `en las dos clases: ${enLasDos.join(", ")}`);
});

test("la zona NUNCA esconde una propiedad de la asesora: es el invariante de ubicacion.js:134-137", () => {
  const c = publicable.clasificarMotivos(["zona_no_publicable"]);
  assert.strictEqual(c.ofrecible, true);
  assert.deepStrictEqual(c.soloPublicacion, ["zona_no_publicable"]);
});

test("el dato corrupto o ajeno si se esconde", () => {
  for (const m of ["sin_precio", "precio_fuera_de_rango", "no_es_inventario_propio", "link_ajeno", "link_no_abre", "ref_bloqueada"]) {
    assert.strictEqual(publicable.clasificarMotivos([m]).ofrecible, false, `${m} tendria que esconderse`);
  }
});

test("con un motivo de cada clase, manda el severo: la ref no se ofrece", () => {
  const c = publicable.clasificarMotivos(["sync_viejo", "sin_precio"]);
  assert.strictEqual(c.ofrecible, false);
  assert.deepStrictEqual(c.soloPublicacion, ["sync_viejo"]);
  assert.deepStrictEqual(c.nuncaOfrecer, ["sin_precio"]);
});

test("un motivo nuevo sin clasificar cae del lado severo: ante la duda, no", () => {
  assert.strictEqual(publicable.clasificarMotivos(["motivo_que_nadie_clasifico"]).ofrecible, false);
});

test("explicarMotivosSeguro se calla ante un motivo sin traducir; explicarMotivos no", () => {
  assert.strictEqual(publicable.explicarMotivosSeguro(["motivo_nuevo_sin_traducir"]), null);
  assert.match(publicable.explicarMotivos(["motivo_nuevo_sin_traducir"]), /motivo_nuevo_sin_traducir/);
  // Con uno traducible y otro no, sale el traducible solo -- nunca el crudo.
  const mezcla = publicable.explicarMotivosSeguro(["motivo_nuevo_sin_traducir", "sin_area"]);
  assert.match(mezcla, /área/);
  assert.ok(!mezcla.includes("motivo_nuevo_sin_traducir"));
});

test("la salvedad para el colega existe para lo que se le puede decir de frente", () => {
  assert.match(publicable.aclaracionParaColega(["periodo_no_soportado"]), /por mes, no por días/);
  assert.match(publicable.aclaracionParaColega(["amoblado_sin_confirmar"]), /amoblada/);
  // La zona la calcula redactar.js#desvios contra el pedido real; duplicarla
  // aca imprimiria dos veces lo mismo en la misma linea de Aclaración.
  assert.strictEqual(publicable.aclaracionParaColega(["zona_no_publicable"]), null);
  assert.strictEqual(publicable.aclaracionParaColega([]), null);
});
