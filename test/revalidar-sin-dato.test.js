// "Sin dato" se dice, no se omite (Juan, 2026-09-02: "lo que no tengamos
// validado en wasi se le envia como observacion").
//
// Caso real: el pedido de Melissa exigia garaje. Tres refs con garaje null en
// Wasi se fueron a dudosas porque la linea del garaje desaparecia de la ficha
// y Sofi leia la ausencia como "no tiene". Con 85 de 114 propiedades sin
// garaje cargado, eso decidia la mitad de los pedidos.
const { test } = require("node:test");
const assert = require("node:assert");
const { formatearCandidatas, SISTEMA } = require("../src/groups/revalidar");

const base = { ref: "10203968", operacion: "Venta", zona: "Envigado", precio: "$520.000.000", area: "66m2", habitaciones: 3, puntaje: 90, razones: [] };

test("un garaje vacio se muestra como 'sin dato', no desaparece", () => {
  const ficha = formatearCandidatas([{ ...base, banos: 2, garajes: null, estrato: null }]);
  assert.ok(ficha.includes("garajes: sin dato"), ficha);
  assert.ok(ficha.includes("estrato: sin dato"), ficha);
  assert.ok(ficha.includes("2 baños"));
});

// SUPERADO (Juan, 2026-09-04). Este test fijaba que un 0 se mostrara como
// "0 garajes" porque se asumia que Wasi distingue "no tiene" (0) de "no lo
// cargamos" (null). NO LO HACE: medido contra produccion el 2026-09-04 sobre
// las 114 disponibles, garaje = 0 en 39 y garaje = null en CERO.
//
// O sea que la rama del null era codigo muerto para garajes, y las 39
// propiedades sin el campo cargado —el 34% del inventario— llegaban a Sofi
// como "0 garajes", que ella lee como "confirmado que no tiene". A las 15:00
// del 2026-09-04 descarto dos refs de 95 y 85 puntos por eso: "es un
// incumplimiento de fondo, no accesorio". Hizo lo correcto con un dato falso.
//
// Ahora el criterio es el mismo que match.js ya usaba (`!(e.tiene > 0)`).
test("un cero de Wasi es 'sin dato': ese campo nunca se cargo", () => {
  const ficha = formatearCandidatas([{ ...base, banos: 2, garajes: 0, estrato: 3 }]);
  assert.ok(ficha.includes("garajes: sin dato"), ficha);
  assert.ok(!ficha.includes("0 garajes"), "un 0 de Wasi no puede leerse como 'no tiene'");
  assert.ok(ficha.includes("estrato 3"));
});

test("con dato, la ficha es la de siempre", () => {
  const ficha = formatearCandidatas([{ ...base, banos: 3, garajes: 2, estrato: 6 }]);
  assert.ok(ficha.includes("3 baños · 2 garajes · estrato 6"), ficha);
});

test("el prompt le dice a Sofi que 'sin dato' es sin_confirmar, no dudosa, y que sobrar no se niega", () => {
  assert.ok(SISTEMA.includes('"garajes: sin dato" NO significa'));
  assert.ok(SISTEMA.includes("nunca en refs_dudosas por"));
  assert.ok(SISTEMA.includes("Nada que este por encima se"));
});
