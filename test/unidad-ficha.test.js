// La unidad se confirma en el texto de la ficha (Juan, 2026-09-21).
//
// Desde el 2026-08-21 (caso Murano Plaza) un pedido que nombra una unidad o
// edificio NUNCA salia solo: "en wasi no las tenemos marcadas por edificio por
// seguridad", y el motor no tenia como saber si una propiedad era la pedida.
// Pero algunas fichas si nombran su unidad ("Unidad residencial Riachuelos",
// "Edificio Fontanar"): ~10 de 102 medido ese dia. Decision de Juan: si la
// ficha nombra la unidad pedida, sale; si no, sigue sin salir sola.
const { test } = require("node:test");
const assert = require("node:assert");
const match = require("../src/groups/match");
const publicable = require("../src/groups/publicable");
const politica = require("../src/groups/politica");

const ficha = (extra = {}) => ({
  ref: "9921323", tipo: "Apartamento", operacion: "Venta", precio: "$650.000.000", zona: "El Poblado", ciudad: "Medellín",
  habitaciones: 3, banos: 2, garaje: 1, estrato: 5, area: "90m2", link: "https://diamondinmobiliaria.com/propiedades/x",
  titulo: "Apartamento en venta Unidad residencial Riachuelos", descripcion: "", ...extra,
});
const pide = (extra = {}) => ({
  tipo: "apartamento", operacion: "venta", zona: "El Poblado", zonas: ["El Poblado"], zona_madre: "", ciudad: null,
  habitaciones: 3, precio_max: 700000000, edificio: "Unidad Riachuelos", ...extra,
});

test("la ficha que nombra la unidad pedida la confirma", () => {
  const m = match.evaluarCandidata(ficha(), pide(), "diamond");
  assert.ok(m);
  assert.strictEqual(m.edificio_confirmado, true);
  assert.strictEqual(m.edificio_sin_confirmar, false);
});

test("la ficha que no nombra la unidad queda sin confirmar y no sale sola", () => {
  const m = match.evaluarCandidata(ficha({ ref: "Y", titulo: "Apartamento en venta El Poblado, unidad completa" }), pide(), "diamond");
  assert.ok(m, "no desaparece: la asesora sabe donde queda cada propiedad");
  assert.strictEqual(m.edificio_sin_confirmar, true);
  const v = publicable.esPublicable(m, { umbral: 0, syncFresco: true });
  assert.ok(v.motivos.includes("edificio_sin_confirmar"), v.motivos.join(","));
});

test("edificio_sin_confirmar solo frena la publicacion y se traduce", () => {
  assert.strictEqual(publicable.clasificarMotivos(["edificio_sin_confirmar"]).ofrecible, true);
  assert.match(publicable.explicarMotivosSeguro(["edificio_sin_confirmar"]), /unidad|edificio/i);
});

test("un pedido sin unidad no marca nada", () => {
  const m = match.evaluarCandidata(ficha(), pide({ edificio: "" }), "diamond");
  assert.ok(m);
  assert.ok(!m.edificio_sin_confirmar);
});

test("'unidad completa' o 'unidad cerrada' no confirman una unidad con nombre", () => {
  const m = match.evaluarCandidata(ficha({ titulo: "Apartamento en unidad cerrada completa" }), pide(), "diamond");
  assert.strictEqual(m.edificio_confirmado, false);
});

test("si el clasificador se equivoca y manda 'Unidad Completa' como nombre, no confirma nada", () => {
  // Medido contra el inventario el 2026-09-21: "Unidad Completa" confirmaba 9
  // fichas y "Conjunto Cerrado" 1. Son descripciones, no nombres; el prompt ya
  // lo prohibe, pero la seguridad no puede depender de que el modelo obedezca.
  for (const generico of ["Unidad Completa", "Conjunto Cerrado", "Unidad Cerrada", "Edificio Residencial", "Unidad Residencial"]) {
    const m = match.evaluarCandidata(ficha({ titulo: "Apartamento en unidad completa, conjunto cerrado, unidad residencial" }), pide({ edificio: generico }), "diamond");
    assert.strictEqual(m.edificio_confirmado, false, generico);
  }
});

// ── La politica ───────────────────────────────────────────────────────────

const base = { senal: { clase: "demanda", confianza: 0.95, respondida_at: null, edificio: "Unidad Riachuelos" }, grupo: { responde: true }, modo: "auto" };

test("el grupo: con la unidad confirmada en todas las que salen, deja de frenar", () => {
  const confirmada = match.evaluarCandidata(ficha(), pide(), "diamond");
  const d = politica.decidir({ ...base, publicables: [confirmada] });
  assert.notStrictEqual(d.motivo, "edificio_especifico", d.traza.join(" > "));
});

test("el grupo: si alguna no tiene la unidad confirmada, sigue frenando", () => {
  const sinConfirmar = { ref: "Z", edificio_confirmado: false };
  const d = politica.decidir({ ...base, publicables: [sinConfirmar] });
  assert.strictEqual(d.motivo, "edificio_especifico");
});

test("el grupo: sin publicables tampoco se levanta el freno", () => {
  const d = politica.decidir({ ...base, publicables: [] });
  assert.strictEqual(d.publicar, false);
});

const dm = { telefono: "573001112233", fechaMensajeIso: new Date().toISOString(), dmsHoyColega: 0, dmsHoyLinea: 0, cuotaLinea: null, soloLlamada: false, edificio: "Unidad Riachuelos" };

test("el DM: con la unidad confirmada sale", () => {
  const confirmada = match.evaluarCandidata(ficha(), pide(), "diamond");
  const d = politica.decidirDm({ ...dm, publicables: [confirmada] });
  assert.notStrictEqual(d.motivo, "edificio_especifico", d.traza.join(" > "));
});

test("el DM: sin la unidad confirmada sigue yendo a la asesora", () => {
  assert.strictEqual(politica.decidirDm({ ...dm, publicables: [{ ref: "Z", edificio_confirmado: false }] }).motivo, "edificio_especifico");
  assert.strictEqual(politica.decidirDm({ ...dm }).motivo, "edificio_especifico", "quien no pasa publicables conserva el freno de siempre");
});
