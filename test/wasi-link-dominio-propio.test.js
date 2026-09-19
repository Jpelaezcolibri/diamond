// Un link de Wasi servido en NUESTRO dominio sigue siendo un link de Wasi.
//
// EL CASO (18-sep-2026, 9:05 p. m.). Un colega recibio de Wasi este link y no
// abrio:
//
//   https://diamondinmobiliaria.com/apartamento-alquiler-envigado-medellin/10416693?shared=whatsapp
//
// Wasi lo genera con NUESTRO dominio, porque en su cuenta el dominio
// configurado es diamondinmobiliaria.com. Pero ese dominio lo sirve nuestra
// landing en Vercel, cuyas fichas viven en /propiedades/<titulo>-<ref>: la
// ruta de Wasi cae en el 404 propio.
//
// `enlazarWasiPublico` reescribia el dominio solo si era info.wasi.co o
// *.inmo.co, asi que estos links salian tal cual. Medido ese dia contra
// produccion: de 105 fichas disponibles con link, 101 venian de
// paraisoinmobiliario.inmo.co (se reescribian bien) y 2 del dominio propio
// (10416693 y 9013897). Esas dos se descartaban con `link_no_abre` y no le
// podian salir a ningun colega — sin ruido, solo una linea en el log. Y el
// problema crece: cada ficha nueva que crea Wasi trae el link asi.
//
// LA FORMA, no el dominio, es lo que identifica un link de Wasi: dos
// segmentos y el ultimo todos digitos (/slug/10416693). La ficha de nuestra
// landing es /propiedades/<slug>-<ref>, que no calza con eso.

const { test } = require("node:test");
const assert = require("node:assert");
const { enlazarWasiPublico } = require("../src/data/properties");

test("el caso real: un link de Wasi en nuestro dominio se publica en el dominio de Wasi", () => {
  const url = enlazarWasiPublico("https://diamondinmobiliaria.com/apartamento-alquiler-envigado-medellin/10416693");
  assert.strictEqual(url, "https://info.wasi.co/apartamento-alquiler-envigado-medellin/10416693?shared=whatsapp");
});

test("el lote 9013897, el otro que estaba roto", () => {
  const url = enlazarWasiPublico("https://diamondinmobiliaria.com/lote-terreno-venta-belen-medellin/9013897");
  assert.match(url, /^https:\/\/info\.wasi\.co\/lote-terreno-venta-belen-medellin\/9013897/);
});

test("el link de NUESTRA landing no se toca: no tiene forma de link de Wasi", () => {
  const propio = "https://diamondinmobiliaria.com/propiedades/apartamento-en-venta-envigado-10416693";
  assert.strictEqual(enlazarWasiPublico(propio), propio);
});

test("lo que ya funcionaba sigue igual: paraisoinmobiliario.inmo.co se reescribe", () => {
  const url = enlazarWasiPublico("https://paraisoinmobiliario.inmo.co/apartamento-venta-el-poblado-medellin/9921323");
  assert.strictEqual(url, "https://info.wasi.co/apartamento-venta-el-poblado-medellin/9921323?shared=whatsapp");
});

test("una pagina cualquiera de nuestro sitio tampoco se toca", () => {
  for (const propio of [
    "https://diamondinmobiliaria.com/",
    "https://diamondinmobiliaria.com/vende-tu-propiedad",
    "https://diamondinmobiliaria.com/propiedades",
  ]) {
    assert.strictEqual(enlazarWasiPublico(propio), propio, propio);
  }
});

test("el dominio de Wasi se puede cambiar sin tocar codigo", () => {
  // El dia que info.diamondinmobiliaria.com este activo, esto es lo unico que
  // cambia: una variable en Railway, no un despliegue.
  const antes = process.env.WASI_PUBLIC_HOST;
  process.env.WASI_PUBLIC_HOST = "info.diamondinmobiliaria.com";
  try {
    const url = enlazarWasiPublico("https://paraisoinmobiliario.inmo.co/apartamento-venta-el-poblado-medellin/9921323");
    assert.strictEqual(url, "https://info.diamondinmobiliaria.com/apartamento-venta-el-poblado-medellin/9921323?shared=whatsapp");
  } finally {
    if (antes === undefined) delete process.env.WASI_PUBLIC_HOST;
    else process.env.WASI_PUBLIC_HOST = antes;
  }
});
