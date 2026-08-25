// test/mandato-aviso.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { buildMandatoMatchAlert, paramsPlantilla } = require("../src/notifications/mandato-aviso");

const BASE = {
  mandato: { cliente_nombre: "Marcela Restrepo" },
  oferta: {
    tipo: "Apartamento", operacion: "Venta", zona: "Loma del Tesoro",
    precio: "$1.580.000.000", habitaciones: 4, banos: 3, area: 246, garajes: 2,
    estrato: 6, mensaje_original: "Apartamento dúplex en venta Loma del Tesoro",
    link: "https://glovi.co/inmueble/9829914",
  },
  evaluacion: {
    puntaje: 92, ubicacion: "exacta",
    cumple: ["sector (Loma del Tesoro)", "presupuesto ($620.000.000 por debajo del tope)", "4 habitaciones"],
    salvedades: ["Sin verificar: balcón, vista, moderna"],
  },
  colega: { nombre: "Glovi l Propiedad raíz", telefono: "573244151819" },
  grupo: "SOLO VIVIENDA >$1000 MLLS",
  vistoEnIso: "2026-08-25T15:42:00-05:00",
};

test("el aviso trae cliente, propiedad, colega, grupo y ficha", () => {
  const t = buildMandatoMatchAlert(BASE);
  assert.ok(t.includes("Marcela Restrepo"));
  assert.ok(t.includes("Loma del Tesoro"));
  assert.ok(t.includes("573244151819"));
  assert.ok(t.includes("SOLO VIVIENDA >$1000 MLLS"));
  assert.ok(t.includes("https://glovi.co/inmueble/9829914"));
});

test("dice que cumple y que falta verificar, y NUNCA un puntaje", () => {
  const t = buildMandatoMatchAlert(BASE);
  assert.ok(t.includes("4 habitaciones"));
  assert.ok(/balcón/.test(t));
  assert.ok(!/92/.test(t), "un puntaje no le dice al asesor que preguntarle al colega");
});

test("nunca afirma que la propiedad esta disponible, y pide confirmar", () => {
  const t = buildMandatoMatchAlert(BASE);
  assert.ok(!/est[áa] disponible/i.test(t));
  assert.ok(/confirm/i.test(t), "tiene que pedir confirmar disponibilidad");
});

test("sin telefono, da la salida real: tocar el nombre en el grupo", () => {
  const t = buildMandatoMatchAlert({ ...BASE, colega: { nombre: "Patricia Vivares", telefono: null } });
  assert.ok(!/\+null|undefined/.test(t));
  assert.ok(/Patricia Vivares/.test(t));
  assert.ok(/toc/i.test(t), "debe explicar como abrir el chat sin el numero");
  assert.ok(/SOLO VIVIENDA/.test(t), "y en que grupo tocarlo");
});

test("recuerda que la comision se comparte", () => {
  assert.ok(/comisi[óo]n se comparte/i.test(buildMandatoMatchAlert(BASE)));
});

test("pide una respuesta corta (cierra el circuito y renueva la ventana de 24h)", () => {
  assert.ok(/respuesta corta|cont[áa]me/i.test(buildMandatoMatchAlert(BASE)));
});

test("paramsPlantilla devuelve exactamente 3 strings no vacios", () => {
  const p = paramsPlantilla(BASE);
  assert.strictEqual(p.length, 3);
  for (const v of p) {
    assert.strictEqual(typeof v, "string");
    assert.ok(v.trim().length > 0, "Meta rechaza un parametro vacio");
  }
  assert.ok(p[0].includes("Marcela"));
});

test("paramsPlantilla no manda saltos de linea (Meta los rechaza)", () => {
  for (const v of paramsPlantilla(BASE)) assert.ok(!/\n/.test(v));
});
