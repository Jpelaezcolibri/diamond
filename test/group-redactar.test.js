// El mensaje que se publica en el grupo gremial. Lo leen 80 competidores y no
// se puede editar despues de enviado, asi que se prueba el texto exacto.
//
// "Blanqueado" desde el 2026-08-18 (Juan, con el riesgo explicito sobre la
// mesa): el colega reenvia esto tal cual a su propio cliente, asi que no
// puede llevar nada que identifique a Diamond — ver la nota de diseño en
// src/groups/redactar.js.

const { test } = require("node:test");
const assert = require("node:assert");
const redactar = require("../src/groups/redactar");

function match(extra = {}) {
  return {
    fuente: "diamond",
    ref: "AP004",
    titulo: "Apartamento en Venta Envigado - Cerca al Metro",
    zona: "Centro, Envigado",
    precio: "$395.000.000",
    operacion: "Venta",
    link: "https://diamondinmobiliaria.com/propiedades/apartamento-envigado-ap004",
    linkWasi: "https://info.wasi.co/apartamento-venta-envigado-centro/9744456",
    habitaciones: 2,
    area: "62m2",
    puntaje: 88,
    ...extra,
  };
}

test("sin propiedades publicables no se redacta nada", () => {
  // Es la salida que mas se va a usar: si la compuerta no dejo pasar nada, el
  // bot calla. Callar es gratis.
  assert.strictEqual(redactar.mensajeGrupo({ autor_nombre: "Patricia" }, []), null);
  assert.strictEqual(redactar.mensajeGrupo({ autor_nombre: "Patricia" }, null), null);
});

test("el mensaje trae ref, operacion, zona, medidas y precio", () => {
  const texto = redactar.mensajeGrupo({ autor_nombre: "Patricia Gomez" }, [match()]);

  assert.match(texto, /^Hola Patricia, vi tu solicitud\./);
  assert.ok(texto.includes("Ref AP004 · Venta · Centro, Envigado"));
  assert.ok(texto.includes("62 m² · 2 alcobas · $395.000.000"));
});

// FICHA COMPLETA (Juan, 2026-08-20): banos, garajes y estrato ahora salen en
// el mensaje cuando el inventario los tiene.
test("la ficha muestra banos, garajes y estrato cuando el inventario los tiene", () => {
  const texto = redactar.mensajeGrupo({ autor_nombre: "Ana" }, [match({ banos: 2, garajes: 1, estrato: 5 })]);
  assert.ok(texto.includes("2 baños · 1 garaje · estrato 5"));
});

test("sin esos datos en el inventario, la ficha no inventa una linea vacia", () => {
  const texto = redactar.mensajeGrupo({ autor_nombre: "Ana" }, [match()]);
  assert.ok(!texto.includes("baño"));
  assert.ok(!texto.includes("garaje"));
  assert.ok(!texto.includes("estrato"));
});

test("el link es el de Wasi, NUNCA el propio — es lo opuesto de la regla en todos los demas mensajes", () => {
  const texto = redactar.mensajeGrupo({ autor_nombre: "Ana" }, [match()]);
  assert.ok(texto.includes("https://info.wasi.co/apartamento-venta-envigado-centro/9744456"));
  assert.ok(!texto.includes("diamondinmobiliaria.com"));
});

test("una sola opcion no se anuncia en plural", () => {
  const texto = redactar.mensajeGrupo({ autor_nombre: "Ana" }, [match()]);
  assert.ok(texto.includes("Tengo esta opcion que puede servirte:"));
  assert.ok(!texto.includes("opciones"));
});

// SIN TOPE (Juan, 2026-08-20): "que no se restrinja a 3, que se envien los
// que tengan un scoring alto" — mensajeGrupo ya no trunca por su cuenta. La
// cantidad la decide publicable.js (compuerta de calidad), no un numero fijo
// aca. El parametro maxPropiedades sigue existiendo por si algun dia hace
// falta acotar de nuevo.
test("se publican TODAS las propiedades que llegan, sin tope por defecto", () => {
  const cinco = ["A", "B", "C", "D", "E"].map((ref) => match({ ref }));
  const texto = redactar.mensajeGrupo({ autor_nombre: "Ana" }, cinco);

  assert.ok(texto.includes("Tengo 5 opciones"));
  assert.ok(texto.includes("Ref A"));
  assert.ok(texto.includes("Ref D"));
  assert.ok(texto.includes("Ref E"));
  assert.deepStrictEqual(texto.match(/^\d\) /gm).length, 5);
});

test("un maxPropiedades explicito SI se respeta — el default es sin tope, no la unica opcion", () => {
  const cinco = ["A", "B", "C", "D", "E"].map((ref) => match({ ref }));
  const texto = redactar.mensajeGrupo({ autor_nombre: "Ana" }, cinco, { maxPropiedades: 3 });

  assert.ok(texto.includes("Tengo 3 opciones"));
  assert.ok(!texto.includes("Ref D"));
  assert.deepStrictEqual(texto.match(/^\d\) /gm).length, 3);
});

test("no deriva a ninguna asesora — el mensaje no lleva nombre ni contacto de nadie de Diamond", () => {
  const texto = redactar.mensajeGrupo({ autor_nombre: "Ana" }, [match()]);
  assert.ok(!texto.includes("wa.me"));
  assert.ok(!texto.includes("Catherine"));
  assert.ok(!texto.includes("Mas informacion con"));
  assert.ok(texto.includes("Comision compartida."));
});

test("el mensaje se firma como Sofi, asistente virtual — sin mencionar a Diamond", () => {
  const texto = redactar.mensajeGrupo({ autor_nombre: "Ana" }, [match()]);
  assert.ok(texto.includes("— Sofi, asistente virtual"));
  assert.ok(!texto.toLowerCase().includes("diamond"));
});

test("un nombre de WhatsApp con emojis no produce un saludo absurdo", () => {
  const conEmoji = redactar.mensajeGrupo({ autor_nombre: "🏠🔥 INMOBILIARIA" }, [match()]);
  assert.match(conEmoji, /^Hola, vi tu solicitud\./);

  const sinNombre = redactar.mensajeGrupo({ autor_nombre: "" }, [match()]);
  assert.match(sinNombre, /^Hola, vi tu solicitud\./);
});

test("el titulo se normaliza: no se grita en el grupo", () => {
  const texto = redactar.mensajeGrupo({ autor_nombre: "Ana" }, [
    match({ titulo: "VENDO DUPLEX  FRENTE AL VIVA LAURELES" }),
  ]);
  assert.ok(texto.includes("Vendo Duplex Frente al Viva Laureles"));
  assert.ok(!texto.includes("VENDO DUPLEX"));
});

test("un titulo generico se completa con la zona", () => {
  // Caso real: la ref 9921137 tiene como titulo solo "Apartamento". Publicado
  // en un grupo, "1) Apartamento" no le dice nada a nadie y se lee como un
  // volcado automatico.
  const texto = redactar.mensajeGrupo({ autor_nombre: "Ana" }, [
    match({ titulo: "Apartamento", zona: "Laureles" }),
  ]);
  assert.ok(texto.includes("Apartamento en Laureles"));

  assert.strictEqual(redactar.tituloUtil({ titulo: "CASA", zona: "Envigado" }), "Casa en Envigado");
  // Un titulo que ya dice algo no se toca, aunque empiece con la palabra tipo.
  assert.strictEqual(
    redactar.tituloUtil({ titulo: "Apartamento en Venta Envigado - Cerca al Metro", zona: "Envigado" }),
    "Apartamento en Venta Envigado - Cerca al Metro"
  );
  // Sin zona no hay con que completarlo: se deja como esta antes que inventar.
  assert.strictEqual(redactar.tituloUtil({ titulo: "Apartamento", zona: "" }), "Apartamento");
});

test("una alcoba se dice en singular", () => {
  const texto = redactar.mensajeGrupo({ autor_nombre: "Ana" }, [match({ habitaciones: 1 })]);
  assert.ok(texto.includes("1 alcoba ·") || texto.includes("· 1 alcoba"));
  assert.ok(!texto.includes("1 alcobas"));
});
