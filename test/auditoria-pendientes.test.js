// Lo que quedo abierto de la auditoria del motor de match
// (docs/superpowers/specs/auditoria-motor-match-2026-09-05.md), cerrado el
// 2026-09-13:
//   · H6, segunda mitad: una sola lista de exigencias (src/groups/exigencias.js).
//   · Hallazgo bajo: el freno de edificio puntual no llegaba al DM.
//   · Hallazgo bajo: redactar.js tenia su propia forma de leer las zonas pedidas.
const { test } = require("node:test");
const assert = require("node:assert");
const politica = require("../src/groups/politica");
const exigencias = require("../src/groups/exigencias");
const redactar = require("../src/groups/redactar");
const { resumenPedido } = require("../src/groups/pedido");

// ── El freno de edificio en el DM ────────────────────────────────────────

const BASE = {
  telefono: null,
  lid: "141746805670125",
  fechaMensajeIso: new Date().toISOString(),
  dmsHoyLinea: 0,
  cuotaLinea: null,
  soloLlamada: false,
};

test("decidirDm frena un pedido de un edificio puntual, igual que el camino del grupo", () => {
  const d = politica.decidirDm({ ...BASE, edificio: "Murano Plaza" });
  assert.strictEqual(d.enviarDm, false);
  assert.strictEqual(d.motivo, "edificio_especifico");
});

test("sin edificio con nombre propio, decidirDm no cambia", () => {
  assert.strictEqual(politica.decidirDm({ ...BASE, edificio: "" }).enviarDm, true);
  assert.strictEqual(politica.decidirDm({ ...BASE }).enviarDm, true);
});

test("solo llamada sigue mandando sobre el edificio: es el freno mas duro", () => {
  assert.strictEqual(politica.decidirDm({ ...BASE, soloLlamada: true, edificio: "Murano Plaza" }).motivo, "colega_solo_llamada");
});

// ── Una sola lista de exigencias ─────────────────────────────────────────

test("la lista de exigencias es una sola, con los cinco campos del pedido", () => {
  assert.deepStrictEqual(
    exigencias.EXIGENCIAS.map((e) => e.campo),
    ["habitaciones", "area_min", "banos", "garajes", "estrato"]
  );
});

test("el garaje se lee con el nombre que traiga cada fuente", () => {
  // La fila de properties dice `garaje`; el match y las ofertas, `garajes`.
  assert.strictEqual(exigencias.dePropiedad({ garaje: 2 }, "garajes"), 2);
  assert.strictEqual(exigencias.dePropiedad({ garajes: 1 }, "garajes"), 1);
  assert.strictEqual(exigencias.dePropiedad({ garaje: 0 }, "garajes"), 0, "un 0 se devuelve tal cual: cada lector decide que significa");
  assert.strictEqual(exigencias.dePropiedad({}, "garajes"), undefined);
  assert.strictEqual(exigencias.dePropiedad({ area: "92m2" }, "area_min"), "92m2", "crudo: cada lector parsea");
});

test("una exigencia desconocida falla ruidosamente, no en silencio", () => {
  assert.throws(() => exigencias.pedido({}, "piscina"), /Exigencia desconocida/);
});

// El texto que ve Sofi es entrada del prompt: si cambia, el golden set tiene
// que volver a correrse. Este test fija que el refactor no lo movio.
test("las lineas del pedido que ve Sofi son las mismas de siempre", () => {
  assert.deepStrictEqual(
    exigencias.lineasParaSofi({ habitaciones: 3, flexible_habitaciones: true, area_min: 80, banos: 2, garajes: 0, estrato: 4 }),
    ["- alcobas: 3 (acepta una menos si tiene estudio)", "- area minima: 80 m²", "- baños: 2", "- garajes: no dice", "- estrato: 4"]
  );
  assert.deepStrictEqual(exigencias.lineasParaSofi({}), [
    "- alcobas: no dice",
    "- area minima: no dice",
    "- baños: no dice",
    "- garajes: no dice",
    "- estrato: no dice",
  ]);
});

test("el resumen del pedido para la asesora es el mismo de siempre", () => {
  assert.strictEqual(
    resumenPedido({
      operacion: "venta", tipo: "apartamento", zonas: ["Envigado"], precio_max: 500000000,
      habitaciones: 1, area_min: 60, banos: 1, garajes: 2, estrato: 3,
    }),
    "venta · apartamento · Envigado · hasta $500.000.000 · 1 alcoba · desde 60 m² · 1 baño · 2 garajes · estrato 3"
  );
  assert.strictEqual(
    resumenPedido({ tipo: "casa", zona: "Belén", habitaciones: 3, flexible_habitaciones: true }),
    "casa · Belén · 3 alcobas (o una menos con estudio)"
  );
});

// ── Las zonas pedidas, leidas como las lee el motor ──────────────────────

test("el desvio de zona lee las zonas pedidas con la misma funcion que el motor", () => {
  // Con `zonas` vacia y `zona` cargada, antes no se aclaraba nada.
  assert.deepStrictEqual(redactar.desvios({ zona: "Robledo" }, { zonas: [], zona: "Laureles" }), ["queda en Robledo, no en Laureles"]);
  assert.deepStrictEqual(redactar.desvios({ zona: "San Joaquín" }, { zonas: ["Laureles"] }), [], "San Joaquin es Laureles: exacta");
});
