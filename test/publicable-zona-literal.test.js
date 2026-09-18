// La zona es literal: una propiedad de la zona de al lado NO le sale a un
// colega, por bien que calce en todo lo demas.
//
// EL CASO (18-sep-2026, 11:00 a. m.): un colega pidio "apartamento Envigado
// $400.000.000" y recibio por DM la ref 10012722, que esta en ITAGUI. La ficha
// salio con su propia salvedad impresa ("Aclaracion: queda en Itagui, vecina de
// Envigado") — el sistema sabia que no era lo pedido y lo mando igual. El
// colega contesto: "Hola Sofi. Me dice Itagui y solo quiere Envigado".
//
// Medido sobre el mes anterior: 213 de las 717 fichas enviadas a colegas (30%)
// salieron por esta regla. Decision de Juan el mismo dia: la zona se hace
// literal. Ver docs/superpowers/specs/2026-09-18-match-literal-design.md.

const { test } = require("node:test");
const assert = require("node:assert");
const publicable = require("../src/groups/publicable");

function matchBueno(extra = {}) {
  return {
    fuente: "diamond",
    ref: "AP004",
    titulo: "Apartamento en Venta Envigado - Cerca al Metro",
    zona: "Centro, Envigado",
    precio: "$395.000.000",
    operacion: "Venta",
    link: "https://diamondinmobiliaria.com/propiedades/apartamento-en-venta-envigado-ap004",
    linkWasi: "https://info.wasi.co/apartamento-venta-envigado-centro/9744456",
    habitaciones: 2,
    area: "62m2",
    puntaje: 88,
    razones: ["Zona: Centro, Envigado"],
    ...extra,
  };
}

test("la zona vecina NO se publica, aunque el puntaje sea alto", () => {
  const v = publicable.esPublicable(matchBueno({ ubicacion: "vecina", puntaje: 95 }));
  assert.strictEqual(v.ok, false);
  assert.ok(v.motivos.includes("zona_vecina"), `motivos: ${v.motivos.join(",")}`);
});

test("el motivo de la vecina es propio, no se confunde con zona_no_publicable", () => {
  const v = publicable.esPublicable(matchBueno({ ubicacion: "vecina" }));
  assert.ok(!v.motivos.includes("zona_no_publicable"));
});

test("zona_vecina se traduce a algo que una persona pueda accionar", () => {
  const texto = publicable.explicarMotivosSeguro(["zona_vecina"]);
  assert.ok(texto, "un motivo sin traduccion llega a la asesora como un error del sistema");
  assert.match(texto, /zona/i);
});

test("la zona exacta sigue saliendo", () => {
  const v = publicable.esPublicable(matchBueno({ ubicacion: "exacta" }));
  assert.strictEqual(v.ok, true, `motivos: ${v.motivos.join(",")}`);
});

test("zona_general sigue saliendo: el barrio pedido esta dentro del municipio que si tenemos", () => {
  const v = publicable.esPublicable(matchBueno({ ubicacion: "zona_general" }));
  assert.strictEqual(v.ok, true, `motivos: ${v.motivos.join(",")}`);
});

test("el caso real: la 10012722 de Itagui no le sale a un pedido de Envigado", () => {
  const itagui = matchBueno({
    ref: "10012722",
    titulo: "VENDO APARTAMENTO CIUDADELA DEL VALLE PISO ALTO CON VISTA",
    zona: "Itagüi",
    precio: "$390.000.000",
    puntaje: 60,
    ubicacion: "vecina",
    razones: ["Itagüi (vecina de lo pedido)", "$390M dentro de $400M"],
  });
  const { publicables, descartados } = publicable.filtrar([itagui], { umbral: 0 });
  assert.deepStrictEqual(publicables, []);
  assert.ok(descartados[0].motivos.includes("zona_vecina"));
});
