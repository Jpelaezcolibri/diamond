const { test } = require("node:test");
const assert = require("node:assert");
const { buildSlug } = require("../src/lib/slug");
const config = require("../src/config");
const { withLandingLink } = require("../src/data/properties");

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

test("withLandingLink: conserva el link original de Wasi en linkWasi", () => {
  // Nadie lo consumia hasta el 2026-08-18 — el mensaje "blanqueado" del modo
  // auto lo necesita (ver src/groups/redactar.js). `link` sigue siendo,
  // como siempre, el de la landing propia para todo lo demas.
  const raw = { ref: "AP001", titulo: "Casa X", link: "https://info.wasi.co/apartamento-venta-x/9755676" };
  const result = withLandingLink(raw);
  assert.strictEqual(result.linkWasi, "https://info.wasi.co/apartamento-venta-x/9755676");
  assert.ok(result.link.includes(config.landingBaseUrl));
});

test("withLandingLink: sin link original (Wasi vacio), linkWasi es null y no truena", () => {
  const raw = { ref: "AP001", titulo: "Casa X", link: null };
  const result = withLandingLink(raw);
  assert.strictEqual(result.linkWasi, null);
  assert.ok(result.link.includes(config.landingBaseUrl));
});
