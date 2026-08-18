// verificar-link.js decide que URL comprueba antes de publicar. Desde el
// mensaje "blanqueado" (2026-08-18) lo que sale al grupo es match.linkWasi,
// no match.link — este test existe para que nadie vuelva a desalinear esos
// dos campos sin que algo lo note (ver la nota de diseno en el propio modulo).

const { test } = require("node:test");
const assert = require("node:assert");

test("verificar: comprueba linkWasi, no link (es el que se publica)", async (t) => {
  const verificarLink = require("../src/groups/verificar-link");
  verificarLink._resetCache();

  const llamadas = [];
  t.mock.method(global, "fetch", async (url) => {
    llamadas.push(url);
    return { ok: true };
  });

  const match = {
    ref: "AP004",
    link: "https://diamondinmobiliaria.com/propiedades/no-deberia-consultarse",
    linkWasi: "https://info.wasi.co/apartamento-venta-envigado/9744456",
  };

  const { verificadas, rotas } = await verificarLink.verificar([match]);

  assert.deepStrictEqual(llamadas, ["https://info.wasi.co/apartamento-venta-envigado/9744456"]);
  assert.strictEqual(verificadas.length, 1);
  assert.strictEqual(rotas.length, 0);
});

test("verificar: un linkWasi roto se reporta con la URL de Wasi, no la de la landing", async (t) => {
  const verificarLink = require("../src/groups/verificar-link");
  verificarLink._resetCache();

  t.mock.method(global, "fetch", async () => ({ ok: false, status: 404 }));

  const match = {
    ref: "AP004",
    link: "https://diamondinmobiliaria.com/propiedades/sano",
    linkWasi: "https://info.wasi.co/apartamento-venta-envigado/9744456",
  };

  const { verificadas, rotas } = await verificarLink.verificar([match]);

  assert.strictEqual(verificadas.length, 0);
  assert.deepStrictEqual(rotas, [{ ref: "AP004", link: "https://info.wasi.co/apartamento-venta-envigado/9744456" }]);
});
