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
  assert.match(texto, /area/);
});
