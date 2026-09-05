// Una ref BLOQUEADA no se le ofrece a la asesora como si pudiera ofrecerla.
//
// EL CASO (encontrado el 2026-09-05 armando el resumen del dia para Natalia).
// La ref 9921388 esta en GRUPOS_REFS_BLOQUEADAS desde hace semanas: tiene el
// precio mal cargado en Wasi y por eso no sale a ningun colega
// (src/groups/publicable.js). Pero el aviso a la asesora se arma con las refs
// crudas del veredicto —refsDelAviso no pasa por publicable.filtrar— asi que
// ese dia el aviso de GUSTAVO ARANGO le mostro a la asesora
// "Ref 9921388 · El Poblado · $1.550.000.000" como una de las que teniamos.
//
// El bloqueo no sirve de nada si la persona la ofrece igual: sale por ella, con
// el precio equivocado, y el colega recibe un dato falso de Diamond. Es el
// mismo daño que el bloqueo existe para evitar, entrando por la otra puerta.
//
// NO SE OCULTA, SE MARCA. Si la asesora ve el pedido sin ninguna propiedad no
// entiende por que le llego; y si la ref es la unica que habia, tiene derecho a
// saber que existe y por que no se puede ofrecer todavia.
const { test } = require("node:test");
const assert = require("node:assert");
const alertaAsesor = require("../src/groups/alerta-asesor");

const SENAL = {
  grupo_nombre: "PEDIDOS INMOBILIARIOS",
  autor_nombre: "GUSTAVO ARANGO",
  autor_telefono: "266558756647101",
  texto_original: "Busco apartamento en El Poblado, 3 alcobas, hasta $1.700 millones",
  zonas: ["El Poblado"], habitaciones: 3, operacion: "venta", tipo: "apartamento",
};
const BLOQUEADA = {
  ref: "9921388", titulo: "Apartamento Loma de los Balsos", operacion: "Venta",
  zona: "Loma De Los Balsos", area: "180m2", habitaciones: 3, precio: "$1.550.000.000",
  linkWasi: "https://info.wasi.co/x/9921388?shared=whatsapp", fuente: "diamond",
};
const BUENA = {
  ref: "9806316", titulo: "Apartamento en El Poblado", operacion: "Venta",
  zona: "El Poblado", area: "160m2", habitaciones: 3, precio: "$1.580.000.000",
  linkWasi: "https://info.wasi.co/x/9806316?shared=whatsapp", fuente: "diamond",
};

test("la ref bloqueada NO aparece entre las que puede ofrecer", () => {
  const t = alertaAsesor.construir(SENAL, { refs_utiles: ["9806316", "9921388"], refs_dudosas: [] }, [BUENA, BLOQUEADA]);
  // "▸ Ref X" es el formato con el que se lista una propiedad OFRECIBLE; que
  // la ref aparezca en la línea de advertencia (⛔) es justamente lo buscado.
  assert.ok(!t.includes("▸ Ref 9921388"), `la listo como ofrecible:\n${t}`);
  assert.match(t, /Ref 9806316/, "se llevo puesta la buena");
});

test("pero se dice que existe y por que no se puede ofrecer", () => {
  const t = alertaAsesor.construir(SENAL, { refs_utiles: ["9806316", "9921388"], refs_dudosas: [] }, [BUENA, BLOQUEADA]);
  assert.match(t, /9921388/, "la escondio del todo: la asesora no sabe que existe");
  assert.match(t, /no la ofrezcas/i);
});

test("si la bloqueada era la UNICA, el aviso sigue existiendo y lo explica", () => {
  const t = alertaAsesor.construir(SENAL, { refs_utiles: ["9921388"], refs_dudosas: [] }, [BLOQUEADA]);
  assert.ok(t, "se quedo sin aviso y la asesora nunca se entera del pedido");
  assert.match(t, /9921388/);
  assert.match(t, /no la ofrezcas/i);
});

test("sin refs bloqueadas el aviso sale exactamente igual que antes", () => {
  const t = alertaAsesor.construir(SENAL, { refs_utiles: ["9806316"], refs_dudosas: [] }, [BUENA]);
  assert.match(t, /Ref 9806316/);
  assert.ok(!/no la ofrezcas/i.test(t), "agrego una advertencia que no hacia falta");
});
