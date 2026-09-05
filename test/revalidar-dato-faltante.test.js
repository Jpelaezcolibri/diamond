// Un dato que NO REGISTRAMOS nunca vota en contra, sean uno o cinco.
//
// EL CASO (Patricia Urreta, 2026-09-05, 12:04 p. m., grupo SOLO POBLADO).
// Pidió "APARTAMENTO EN EL POBLADO · Ideal 2 habitaciones (o 3) · Área 120 m2
// · SIN poniente · Nuevo o máximo 2 años de construido · Presupuesto máximo
// $1.700 millones". Teníamos cuatro que cumplían zona, precio, área y alcobas.
//
// Sofi mandó las CUATRO a refs_dudosas con `sin_confirmar` vacío, y al colega
// no le llegó nada. Su propio razonamiento lo dice: "El inventario no registra
// orientación ni antigüedad, así que no podemos verificar ninguno de esos
// requisitos" — que es la definición exacta de INCOMPLETO, la situación que el
// prompt manda a refs_utiles.
//
// POR QUÉ SE CONFUNDIÓ: la regla decía "nunca en refs_dudosas por eso solo"
// (singular) y, en otra línea, "DOS O MAS incumplimientos: eso es DUDOSA".
// Con dos datos no verificables, contarlos como dos incumplimientos era una
// lectura posible del texto. No lo es: un dato que no tenemos no es un
// incumplimiento.
//
// Regla de Juan, literal: "no podemos dejar de avisar por no conocer el
// poniente ni los años de construcción".
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const FUENTE = fs.readFileSync(path.join(__dirname, "..", "src", "groups", "revalidar.js"), "utf8");

test("la regla dice que los datos que no tenemos NO se cuentan", () => {
  assert.match(FUENTE, /NO SE CUENTAN LOS DATOS QUE NO TENEMOS/);
});

test("el umbral de DOS O MAS habla de incumplimientos CONOCIDOS", () => {
  // Sin la palabra, "dos o mas incumplimientos" vuelve a poder leerse como
  // "dos cosas que no pude verificar".
  const dudosa = FUENTE.split("\n").find((l) => l.includes("| DUDOSA |"));
  assert.ok(dudosa, "desapareció la fila DUDOSA de la tabla");
  assert.match(dudosa, /CONOCIDOS/);
  assert.match(dudosa, /NUNCA datos que no registramos/);
});

test("queda escrito el caso real, para que nadie lo afloje sin saber qué costó", () => {
  assert.match(FUENTE, /Patricia Urreta/);
  assert.match(FUENTE, /poniente/);
});

test("no se aflojó el estándar de lo que SÍ se puede verificar", () => {
  // El riesgo del cambio: que "no lo tenemos" se vuelva excusa para aprobar
  // cualquier cosa. Lo verificable tiene que seguir cumpliendo.
  assert.match(FUENTE, /NO es una excusa para bajar el estandar/);
});
