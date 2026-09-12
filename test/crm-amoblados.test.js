// Logica pura del panel de amoblados del CRM (spec 2026-09-12-panel-amoblados).
// Node 24 importa el .ts directo (sin imports "@/": el archivo es hoja).
const { test } = require("node:test");
const assert = require("node:assert");
const lib = require("../crm/lib/amoblados.ts");
const bot = require("../src/groups/amoblado");

test("salidaDelPedido: DM al colega manda sobre todo lo demas", () => {
  assert.strictEqual(lib.salidaDelPedido({ respondida_at: "2026-09-12T10:00:00Z", respuesta_modo: "auto", aviso_advisor_id: "a1" }), "dm");
});

test("salidaDelPedido: aviso a la asesora (por advisor o por wamid)", () => {
  assert.strictEqual(lib.salidaDelPedido({ aviso_advisor_id: "a1" }), "aviso");
  assert.strictEqual(lib.salidaDelPedido({ aviso_wamid: "wamid.X" }), "aviso");
});

test("salidaDelPedido: sombra no cuenta como DM", () => {
  assert.strictEqual(lib.salidaDelPedido({ respondida_at: "2026-09-12T10:00:00Z", respuesta_modo: "sombra" }), "sin_dueno");
});

test("salidaDelPedido: Sofi lo descarto (caso Niko, edificio especifico)", () => {
  assert.strictEqual(lib.salidaDelPedido({ revalidacion: { sirve_alguna: false } }), "descartado");
});

test("salidaDelPedido: con match y sin nada es 'sin_dueno'", () => {
  assert.strictEqual(lib.salidaDelPedido({ revalidacion: null }), "sin_dueno");
  assert.strictEqual(lib.salidaDelPedido({ revalidacion: { sirve_alguna: true } }), "sin_dueno");
});

test("resumenSalidas cuenta una salida por pedido", () => {
  const r = lib.resumenSalidas([
    { aviso_advisor_id: "a1" },
    { revalidacion: { sirve_alguna: false } },
    { respondida_at: "x", respuesta_modo: "auto" },
    {},
  ]);
  assert.deepStrictEqual(r, { dm: 1, aviso: 1, descartado: 1, sin_dueno: 1 });
});

test("esAmoblada es el MISMO veredicto que src/groups/amoblado.js", () => {
  const casos = [
    { titulo: "Apartamento Amoblado en Arriendo en Don Quijote", caracteristicas: null },
    { titulo: "RENTA DE HERMOSO APARTAMENTO EN DON QUIJOTE", caracteristicas: "Admite mascotas, Clósets" },
    { titulo: "WALL BY LINARES", caracteristicas: "Amoblado, Balcón" },
    { titulo: "Apartamento sin amoblar en Belén", caracteristicas: "" },
    { titulo: "Apartamento Desamoblado", caracteristicas: null },
    { titulo: "", caracteristicas: "" },
  ];
  for (const p of casos) assert.strictEqual(lib.esAmoblada(p), bot.esAmoblada(p), JSON.stringify(p));
});

test("periodoDePropiedad: lee la descripcion (con HTML de Wasi) y el titulo", () => {
  assert.strictEqual(lib.periodoDePropiedad({ descripcion: "<div>RENTA MINIMA: 3 MESES</div><div>$ 6.800.000</div>" }), "mensual");
  assert.strictEqual(lib.periodoDePropiedad({ descripcion: "<div>°Mes $4,500.000</div>" }), "mensual");
  assert.strictEqual(lib.periodoDePropiedad({ descripcion: "Valor por noche: $1.700.000 · mínimo 2 noches" }), "noche");
  assert.strictEqual(lib.periodoDePropiedad({ descripcion: "Ven a disfrutar de esta hermosa casa campestre" }), "sin_periodo");
  assert.strictEqual(lib.periodoDePropiedad({ titulo: "Canon mensual", descripcion: null }), "mensual");
});

test("periodoDePropiedad: si dice mes Y noche, gana noche (hay que revisarla)", () => {
  assert.strictEqual(lib.periodoDePropiedad({ descripcion: "Por mes $7.000.000 o por noche $400.000" }), "noche");
});

test("pedidosPorRef cuenta cada ref una vez por pedido", () => {
  const m = lib.pedidosPorRef([
    { matches: [{ ref: "10383636" }, { ref: "10319552" }, { ref: "10383636" }] },
    { matches: [{ ref: "10319552" }, { ref: null }] },
    { matches: null },
  ]);
  assert.strictEqual(m.get("10383636"), 1);
  assert.strictEqual(m.get("10319552"), 2);
  assert.strictEqual(m.size, 2);
});
