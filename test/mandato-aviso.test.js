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

test("con un LID de 15 digitos en vez de telefono, NO se muestra el numero crudo — se pide tocar el nombre", () => {
  const t = buildMandatoMatchAlert({
    ...BASE,
    colega: { nombre: "Glovi l Propiedad raíz", telefono: "573201234567890" },
  });
  assert.ok(!t.includes("573201234567890"), "un LID no es un telefono marcable, no se debe mostrar crudo");
  assert.ok(!/\+573201234567890/.test(t));
  assert.ok(/Glovi l Propiedad ra[íi]z/.test(t));
  assert.ok(/toc/i.test(t), "debe explicar como abrir el chat sin el numero, igual que sin telefono");
});

test("sin telefono y sin grupo, no da a entender que hay un grupo especifico mas abajo", () => {
  const t = buildMandatoMatchAlert({
    ...BASE,
    colega: { nombre: "Patricia Vivares", telefono: null },
    grupo: null,
  });
  assert.ok(!/\+null|undefined/.test(t));
  assert.ok(/Patricia Vivares/.test(t));
  assert.ok(!/Visto en:/.test(t), "sin grupo no hay linea Visto en");
  assert.ok(
    /grupo donde public/i.test(t),
    "debe decir que hay que ubicarlo en el grupo donde publico, no asumir uno especifico"
  );
});

test("si la oferta no trae ningun dato numerico, no deja una linea en blanco antes de Ficha:", () => {
  const ofertaSinDatos = {
    tipo: "Apartamento", operacion: "Venta", zona: "Loma del Tesoro",
    link: "https://glovi.co/inmueble/1",
  };
  const t = buildMandatoMatchAlert({ ...BASE, oferta: ofertaSinDatos });
  assert.ok(!t.includes("\n\nFicha:"), "fichaDe vacio no debe empujar una linea en blanco antes de Ficha:");
  assert.ok(t.includes("Ficha: https://glovi.co/inmueble/1"));
});

test("una salvedad que ya viene con 'Sin verificar:' no queda redundante con 'Ojo:'", () => {
  const t = buildMandatoMatchAlert({
    ...BASE,
    evaluacion: { ...BASE.evaluacion, salvedades: ["Sin verificar: balcón, vista"] },
  });
  assert.ok(!/Ojo:\s*Sin verificar/i.test(t), "no debe repetir Ojo: pegado a Sin verificar:");
  assert.ok(/Sin verificar: balc[óo]n, vista/.test(t));
});

test("una salvedad sin el prefijo 'Sin verificar:' si mantiene la etiqueta Ojo:", () => {
  const t = buildMandatoMatchAlert({
    ...BASE,
    evaluacion: { ...BASE.evaluacion, salvedades: ["no tiene garaje propio"] },
  });
  assert.ok(/Ojo: no tiene garaje propio/.test(t));
});

test("nivel 'fuerte' (o ausente, por compatibilidad) usa el encabezado de siempre", () => {
  const t = buildMandatoMatchAlert(BASE); // BASE.evaluacion no trae 'nivel'
  assert.match(t, /^🎯 Oferta nueva que le sirve a Marcela Restrepo/);
});

test("nivel 'revisar' usa un encabezado distinto, sin prometer que sirve", () => {
  const t = buildMandatoMatchAlert({ ...BASE, evaluacion: { ...BASE.evaluacion, nivel: "revisar" } });
  assert.match(t, /^🔎 Revisar con el colega — match parcial para Marcela Restrepo/);
  assert.doesNotMatch(t, /Oferta nueva que le sirve/);
});

test("el cuerpo del mensaje (Cumple/Ojo/ficha) no cambia entre niveles", () => {
  const fuerte = buildMandatoMatchAlert({ ...BASE, evaluacion: { ...BASE.evaluacion, nivel: "fuerte" } });
  const revisar = buildMandatoMatchAlert({ ...BASE, evaluacion: { ...BASE.evaluacion, nivel: "revisar" } });
  const sinEncabezado = (t) => t.split("\n").slice(1).join("\n");
  assert.strictEqual(sinEncabezado(fuerte), sinEncabezado(revisar));
});
