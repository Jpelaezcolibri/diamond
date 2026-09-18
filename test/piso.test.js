// En que piso esta una propiedad, leido del texto de su ficha.
//
// POR QUE DEL TEXTO Y NO DE UN CAMPO (2026-09-18): Wasi TIENE el campo, pero
// esta vacio o mentiroso. Medido contra la web publica de Wasi ese dia: en 8
// de 8 apartamentos la ficha no trae el campo Piso, y en el unico que lo trae
// -la ref 10012722- dice "Piso: 1" cuando el apartamento esta en el 19 (lo
// dicen su titulo, "PISO ALTO CON VISTA", y su descripcion, "Piso 19 con
// vista"). Traer ese campo hoy construiria la compuerta sobre un dato vacio y,
// donde esta lleno, al reves de la realidad.
//
// El texto lo dice en 40 de los 90 apartamentos del inventario (44%).
//
// LA TRAMPA DE ESTE MODULO son los falsos positivos: "pisos en madera",
// "piso de ceramica" y "casa de dos pisos" hablan de otra cosa. Un falso
// positivo aca no falla ruidosamente: manda un apartamento del piso 19 a
// quien pidio maximo segundo.

const { test } = require("node:test");
const assert = require("node:assert");
const { pisoDe } = require("../src/groups/piso");

test("lo dice la descripcion: 'Piso 10'", () => {
  assert.strictEqual(pisoDe({ titulo: "APARTAMENTO EN LA LOMA DEL INDIO", descripcion: "Piso 10 | Vista a la ciudad" }), 10);
});

test("el caso 10012722: el numero de la descripcion le gana al 'PISO ALTO' del titulo", () => {
  const p = {
    titulo: "VENDO APARTAMENTO CIUDADELA DEL VALLE PISO ALTO CON VISTA",
    descripcion: "Apartamento moderno. * Piso 19 con vista * Unidad completa con dos piscinas",
  };
  assert.strictEqual(pisoDe(p), 19);
});

test("'primer piso' y 'segundo piso' se leen como numero", () => {
  assert.strictEqual(pisoDe({ descripcion: "Apartamento en primer piso, sin escalas" }), 1);
  assert.strictEqual(pisoDe({ descripcion: "Queda en el segundo piso" }), 2);
});

test("'Piso Alto' sin numero devuelve 'alto'", () => {
  assert.strictEqual(pisoDe({ titulo: "Apartamento en venta", descripcion: "Piso Alto</span>" }), "alto");
});

test("'piso bajo' devuelve 'bajo'", () => {
  assert.strictEqual(pisoDe({ descripcion: "Piso bajo, ideal para adultos mayores" }), "bajo");
});

test("el piso del MATERIAL no es un piso: 'pisos en madera' no dice nada", () => {
  assert.strictEqual(pisoDe({ descripcion: "Pisos en madera, cocina integral" }), null);
  assert.strictEqual(pisoDe({ descripcion: "piso de ceramica en toda la casa" }), null);
  assert.strictEqual(pisoDe({ descripcion: "pisos laminados nuevos" }), null);
});

test("una casa 'de dos pisos' no esta en el piso 2", () => {
  assert.strictEqual(pisoDe({ titulo: "Casa de dos pisos en Envigado" }), null);
  assert.strictEqual(pisoDe({ descripcion: "casa de 3 pisos con terraza" }), null);
});

test("'piso por escalas' no es un numero de piso", () => {
  assert.strictEqual(pisoDe({ descripcion: "Se sube al piso por escalas" }), null);
});

test("sin texto, no se sabe", () => {
  assert.strictEqual(pisoDe({}), null);
  assert.strictEqual(pisoDe(null), null);
});

test("un piso absurdo se descarta en vez de creerse", () => {
  assert.strictEqual(pisoDe({ descripcion: "piso 80" }), null, "no hay edificios de 80 pisos en el inventario");
});

// FALSO POSITIVO REAL, encontrado corriendo este modulo contra las 90 fichas
// de apartamentos del inventario (2026-09-18). La ref 9777884 devolvia 1 por
// esta frase: "Restaurante en el primer piso (proximamente)". El piso del
// RESTAURANTE del edificio, no el del apartamento — que la ficha no dice.
// Un 1 inventado aca le manda esta propiedad a quien pidio primer piso.
test("el piso de un local del edificio no es el piso del apartamento", () => {
  const p = {
    titulo: "VENDO APARTAMENTO EN LAURELES PARA ESTRENAR - SE PUEDE DIVIDIR EN 2",
    descripcion: "Edificio moderno con: Coworking en el último piso, Lavandería, Portería 24 horas, Restaurante en el primer piso (próximamente)",
  };
  assert.strictEqual(pisoDe(p), null, "la ficha no dice en que piso esta el apartamento");
});

test("pero el piso del apartamento sigue leyendose aunque el edificio tenga locales", () => {
  const p = {
    titulo: "Apartamento en venta",
    descripcion: "Restaurante en el primer piso. El apartamento está en el piso 12 con vista.",
  };
  assert.strictEqual(pisoDe(p), 12);
});
