const { test } = require("node:test");
const assert = require("node:assert");
const { buildSlug } = require("../src/lib/slug");
const config = require("../src/config");
const { withLandingLink, enlazarWasiPublico } = require("../src/data/properties");

test("buildSlug: kebab-case sin tildes + ref al final (identico a web/lib/slug.ts)", () => {
  assert.strictEqual(
    buildSlug("Apartamento Moderno en Sabaneta - Iluminado con Vista Verde", "AP001"),
    "apartamento-moderno-en-sabaneta-iluminado-con-vista-verde-ap001"
  );
});

test("buildSlug: quita tildes y usa el ref en minuscula", () => {
  assert.strictEqual(buildSlug("Casa Campestre en La Estrella", "CA001"), "casa-campestre-en-la-estrella-ca001");
});

test("withLandingLink: reemplaza el link de Wasi/inmo.co por el de la landing propia", () => {
  const raw = {
    ref: "AP001",
    titulo: "Apartamento Moderno en Sabaneta - Iluminado con Vista Verde",
    link: "https://info.wasi.co/apartamento-venta-el-carmelo-sabaneta/9755676",
  };
  const result = withLandingLink(raw);
  assert.strictEqual(result.link, `${config.landingBaseUrl}/propiedades/apartamento-moderno-en-sabaneta-iluminado-con-vista-verde-ap001`);
  assert.ok(!result.link.includes("wasi.co"));
  assert.ok(!result.link.includes("inmo.co"));
});

test("withLandingLink: no muta el objeto original ni pierde el resto de campos", () => {
  const raw = { ref: "AP001", titulo: "Casa X", link: "https://info.wasi.co/x", precio: "$100" };
  const result = withLandingLink(raw);
  assert.strictEqual(raw.link, "https://info.wasi.co/x");
  assert.strictEqual(result.precio, "$100");
});

test("withLandingLink: null pasa directo (propiedad no encontrada)", () => {
  assert.strictEqual(withLandingLink(null), null);
});

test("withLandingLink: conserva el link original de Wasi en linkWasi, con ?shared=whatsapp", () => {
  // Nadie lo consumia hasta el 2026-08-18 — el mensaje "blanqueado" del modo
  // auto lo necesita (ver src/groups/redactar.js). `link` sigue siendo,
  // como siempre, el de la landing propia para todo lo demas.
  const raw = { ref: "AP001", titulo: "Casa X", link: "https://info.wasi.co/apartamento-venta-x/9755676" };
  const result = withLandingLink(raw);
  assert.strictEqual(result.linkWasi, "https://info.wasi.co/apartamento-venta-x/9755676?shared=whatsapp");
  assert.ok(result.link.includes(config.landingBaseUrl));
});

test("withLandingLink: sin link original (Wasi vacio), linkWasi es null y no truena", () => {
  const raw = { ref: "AP001", titulo: "Casa X", link: null };
  const result = withLandingLink(raw);
  assert.strictEqual(result.linkWasi, null);
  assert.ok(result.link.includes(config.landingBaseUrl));
});

test("enlazarWasiPublico: reescribe el dominio propio (*.inmo.co) a info.wasi.co, mismo slug e id", () => {
  // Juan, 2026-08-19: el sitio de cuenta (ej. paraisoinmobiliario.inmo.co) no
  // tiene boton de contacto por WhatsApp; info.wasi.co con ?shared=whatsapp
  // si. Wasi sirve la misma propiedad en las dos rutas (verificado en vivo).
  assert.strictEqual(
    enlazarWasiPublico("https://paraisoinmobiliario.inmo.co/apartamento-venta-el-poblado-medellin/9785035"),
    "https://info.wasi.co/apartamento-venta-el-poblado-medellin/9785035?shared=whatsapp"
  );
});

test("enlazarWasiPublico: un link que ya es de info.wasi.co solo suma el parametro", () => {
  assert.strictEqual(
    enlazarWasiPublico("https://info.wasi.co/casa-venta-laureles/123"),
    "https://info.wasi.co/casa-venta-laureles/123?shared=whatsapp"
  );
});

test("enlazarWasiPublico: un link que no es de Wasi pasa intacto (no se inventa un dominio)", () => {
  assert.strictEqual(enlazarWasiPublico("https://ejemplo-cualquiera.com/x"), "https://ejemplo-cualquiera.com/x");
});

test("enlazarWasiPublico: null y URL invalida no truenan", () => {
  assert.strictEqual(enlazarWasiPublico(null), null);
  assert.strictEqual(enlazarWasiPublico("no es una url"), "no es una url");
});
