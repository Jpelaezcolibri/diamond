const { test } = require("node:test");
const assert = require("node:assert");
const { construir } = require("../src/groups/alerta-asesor");

const senal = {
  autor_nombre: "Gustavo Arango", grupo: "PEDIDOS INMOBILIARIOS",
  texto_original: "Buscamos apartamento Amoblado en el poblado, 2 habitaciones, hasta $8.000.000",
  operacion: "arriendo", tipo: "apartamento", zona: "El Poblado", precio_max: 8000000,
  habitaciones: 2, amoblado: "si",
};
const matches = [{
  fuente: "diamond", ref: "10319436", titulo: "Apartamento Amoblado en Arriendo en El Poblado - Los Gonzáles",
  zona: "Los Gonzáles", precio: "$7.900.000", operacion: "Arriendo", area: "90m2",
  habitaciones: 3, puntaje: 79, ubicacion: "exacta", amoblado: true,
  razones: ["misma zona", "$7,9M dentro de $8M", "3 alcobas", "amoblada"],
}];
const veredicto = { refs_utiles: ["10319436"], refs_dudosas: [], sin_confirmar: [], le_falta: [] };

test("el aviso de amoblados se distingue de un vistazo", () => {
  // Juan, 2026-09-07: "se envia a natalia con un mensaje diferenciado que sepa
  // que es de amoblados". Natalia recibe avisos de venta todo el dia; si este
  // se lee igual, no lo va a tratar distinto.
  const texto = construir(senal, veredicto, matches, null, null, null, { carrilAmoblados: true });
  assert.ok(texto, "tiene que producir un aviso");
  assert.ok(texto.includes("AMOBLADOS"), `no se distingue:\n${texto}`);
});

test("un aviso de venta no lleva el encabezado de amoblados", () => {
  const venta = { ...senal, operacion: "venta", amoblado: "" };
  const texto = construir(venta, veredicto, matches, null, null, null, {});
  assert.ok(texto);
  assert.ok(!texto.includes("AMOBLADOS"), `un aviso de venta no se marca:\n${texto}`);
});
