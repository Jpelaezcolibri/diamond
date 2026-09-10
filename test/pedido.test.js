// Como se describe un pedido de colega (Juan, 2026-09-10). Lo usan el DM al
// colega (redactar.js) y el aviso a la asesora (alerta-asesor.js): tienen que
// describir el MISMO pedido, o el colega y la asesora hablan de dos cosas.
const { test } = require("node:test");
const assert = require("node:assert");
const pedido = require("../src/groups/pedido");

test("numeroPedido: los formatos reales medidos en produccion", () => {
  assert.strictEqual(pedido.numeroPedido("🟢🟢🟢🟢 _*PEDIDO 👉 645*_\n🔎 _*BUSCO*_"), "645");
  assert.strictEqual(pedido.numeroPedido("Pedido #201 busco apto"), "201");
  assert.strictEqual(pedido.numeroPedido("*Pedido 12026* Busco *apto*"), "12026");
  assert.strictEqual(pedido.numeroPedido("Pedido 02👈 casa en Envigado"), "02");
  assert.strictEqual(pedido.numeroPedido("_*C_647*_ 🔆 Por favor quién con apartamentos"), "647");
});

test("numeroPedido: si trae los dos, gana la palabra 'pedido'", () => {
  assert.strictEqual(pedido.numeroPedido("_*C_647*_ ... _*PEDIDO 👉 647*_"), "647");
  assert.strictEqual(pedido.numeroPedido("C_111 ... PEDIDO 222"), "222");
});

test("numeroPedido: un # suelto, 'pedidos' o un digito solo NO son un numero de pedido", () => {
  assert.strictEqual(pedido.numeroPedido("Calle 10 #43, apto 3 alcobas"), null);
  assert.strictEqual(pedido.numeroPedido("para mis pedidos 23 aptos"), null);
  assert.strictEqual(pedido.numeroPedido("Pedido: 3 alcobas en Laureles"), null);
  assert.strictEqual(pedido.numeroPedido("Busco apto en Sabaneta"), null);
  assert.strictEqual(pedido.numeroPedido(null), null);
});

test("resumenPedido: la linea 'Busca:' de siempre", () => {
  assert.strictEqual(
    pedido.resumenPedido({ operacion: "venta", tipo: "apartamento", zonas: ["Sabaneta", "Envigado"], precio_max: 320000000, habitaciones: 2, banos: 2, garajes: 1 }),
    "venta · apartamento · Sabaneta, Envigado · hasta $320.000.000 · 2 alcobas · 2 baños · 1 garaje"
  );
  assert.strictEqual(pedido.resumenPedido({}), null);
});

test("frasePedido: tipo, zonas unidas con 'o', tope y alcobas", () => {
  assert.strictEqual(
    pedido.frasePedido({ tipo: "Apartamento", zonas: ["envigado", "itagüí", "la estrella", "sabaneta"], precio_max: 350000000, habitaciones: 2 }),
    "apartamento en Envigado, Itagüí, La Estrella o Sabaneta, hasta $350.000.000, 2 alcobas"
  );
  assert.strictEqual(pedido.frasePedido({ tipo: "apartamento", zona: "laureles" }), "apartamento en Laureles");
  assert.strictEqual(
    pedido.frasePedido({ tipo: "casa", operacion: "arriendo", zona: "el poblado", precio_max: 9000000 }),
    "casa en arriendo en El Poblado, hasta $9.000.000"
  );
  assert.strictEqual(pedido.frasePedido({ zonas: ["Envigado"], habitaciones: 2 }), "propiedad en Envigado, 2 alcobas");
});

test("frasePedido: sin tipo, zona ni precio no hay frase (el que llama cae al fragmento)", () => {
  assert.strictEqual(pedido.frasePedido({ habitaciones: 3 }), null);
  assert.strictEqual(pedido.frasePedido(null), null);
});

test("fragmentoPedido: sus primeras palabras, sin emojis ni asteriscos, cortadas en ~60", () => {
  const f = pedido.fragmentoPedido("🏭 *BUSCO BODEGA PARA RENTA* 📍 Ubicación: sabaneta,La Estrella o Caldas 📐 Área: 1.000 m²");
  assert.ok(f.startsWith("BUSCO BODEGA PARA RENTA Ubicación: sabaneta,La Estrella"), f);
  assert.ok(f.endsWith("…"), f);
  assert.ok(f.length <= 61, `largo ${f.length}`);
  assert.ok(!/[*🏭📍]/u.test(f), f);
  assert.strictEqual(pedido.fragmentoPedido("Viva solicita apto Sabaneta"), "Viva solicita apto Sabaneta");
  assert.strictEqual(pedido.fragmentoPedido("👀🔥"), null);
});

test("fechaSiEsOtroDia: nada si es el mismo dia en Bogota, la fecha si es otro", () => {
  const ahora = new Date("2026-09-10T15:00:00Z"); // 10-sep 10:00 a. m. Bogota
  assert.strictEqual(pedido.fechaSiEsOtroDia("2026-09-10T13:00:00Z", ahora), null);
  assert.strictEqual(pedido.fechaSiEsOtroDia("2026-09-08T20:00:00Z", ahora), "8 de septiembre");
  // 10-sep 02:00 UTC todavia es 9-sep en Bogota.
  assert.strictEqual(pedido.fechaSiEsOtroDia("2026-09-10T02:00:00Z", ahora), "9 de septiembre");
  assert.strictEqual(pedido.fechaSiEsOtroDia(null, ahora), null);
  assert.strictEqual(pedido.fechaSiEsOtroDia("basura", ahora), null);
});
