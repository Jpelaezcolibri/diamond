// construir() del aviso que recibe la asesora cuando Sofi aprueba una
// oportunidad de grupo (src/groups/alerta-asesor.js). Es una funcion pura
// (sin IO): no hace falta mockear nada, solo prender/apagar
// CONTACT_WHATSAPP_NUMBER por caso, igual que aviso-cercano.js.
//
// CAMBIO DE POLITICA (Juan, 2026-08-22): "que se notifique al celular de
// natalia todo para que ella lo responda directamente desde su numero" — el
// bug real que motivo esta suite: `senal.autor_telefono` es un @lid (14-17
// digitos), no un telefono real (medido en produccion: 12 de 12 eran LID), y
// el aviso terminaba diciendo "respondele en el grupo" el 100% de las veces —
// justo lo opuesto a la norma. Ahora `construir` recibe aparte el telefono ya
// resuelto por src/groups/directorio.js.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const { construir } = require("../src/groups/alerta-asesor");

function senal(extra = {}) {
  return {
    grupo_nombre: "Inmobiliarias Medellin",
    autor_nombre: "Patricia Gomez",
    autor_telefono: "141746805670125", // @lid tipico que llega de WhatsApp, no marcable
    texto_original: "Busco apartamento en Laureles, 3 alcobas",
    ...extra,
  };
}

const VEREDICTO = {
  es_pedido_real: true,
  sirve_alguna: true,
  refs_utiles: ["AP004"],
  por_que: "Es exactamente lo que pide: zona, alcobas y presupuesto calzan.",
};

function matchUtil(extra = {}) {
  return {
    ref: "AP004",
    titulo: "Apartamento en Venta Envigado",
    zona: "Centro, Envigado",
    precio: "$395.000.000",
    habitaciones: 2,
    area: "62m2",
    link: "https://diamondinmobiliaria.com/propiedades/ap004",
    ...extra,
  };
}

beforeEach(() => {
  delete process.env.CONTACT_WHATSAPP_NUMBER;
});

test("con telefono resuelto por el directorio, el aviso trae el link directo al privado", () => {
  const texto = construir(senal(), VEREDICTO, [matchUtil()], "573001234567");
  assert.match(texto, /Contacto: https:\/\/wa\.me\/573001234567/);
});

test("sin telefono resuelto, NO dice 'respondele en el grupo' -- dice que toque el nombre del colega", () => {
  const texto = construir(senal(), VEREDICTO, [matchUtil()], null);
  assert.doesNotMatch(texto, /respondele en el grupo/i);
  assert.match(texto, /tocá el nombre de Patricia Gomez en el grupo/);
});

test("sin pasar el cuarto parametro (llamador viejo), sigue funcionando igual que sin telefono", () => {
  // La firma nueva es aditiva: quien llame a construir(senal, veredicto,
  // matches) sin el cuarto argumento no se rompe.
  const texto = construir(senal(), VEREDICTO, [matchUtil()]);
  assert.doesNotMatch(texto, /respondele en el grupo/i);
  assert.match(texto, /tocá el nombre/);
});

test("sin telefono resuelto por el directorio, pero con autor_telefono marcable (@c.us), lo usa como ultimo intento", () => {
  // Revision 2026-08-24: WhatsApp a veces entrega el participante como @c.us
  // -numero visible, no LID- y el aviso decia "no se pudo resolver el
  // numero" TENIENDO el numero a mano en senal.autor_telefono.
  const texto = construir(senal({ autor_telefono: "573009998877" }), VEREDICTO, [matchUtil()], null);
  assert.match(texto, /Contacto: https:\/\/wa\.me\/573009998877/);
  assert.doesNotMatch(texto, /tocá el nombre/);
});

test("el telefono YA RESUELTO por el directorio gana sobre autor_telefono", () => {
  const texto = construir(
    senal({ autor_telefono: "573000000009" }),
    VEREDICTO,
    [matchUtil()],
    "573001234567"
  );
  assert.match(texto, /Contacto: https:\/\/wa\.me\/573001234567/);
  assert.doesNotMatch(texto, /573000000009/);
});

test("un @lid pasado por error como telefonoColega no arma un link roto", () => {
  // linkWhatsapp ya filtra esto, pero la ruta completa (directorio -> aca)
  // tiene que degradar igual de bien si algun dia llega un LID sin resolver.
  const texto = construir(senal(), VEREDICTO, [matchUtil()], "141746805670125");
  assert.doesNotMatch(texto, /wa\.me\/141746805670125/);
  assert.match(texto, /tocá el nombre/);
});

test("con CONTACT_WHATSAPP_NUMBER definida, agrega el renglon listo para copiar hacia Sofi", () => {
  process.env.CONTACT_WHATSAPP_NUMBER = "573000000001";
  const texto = construir(senal(), VEREDICTO, [matchUtil()], "573001234567");
  assert.match(texto, /escribirle a Sofi/);
  assert.match(texto, /https:\/\/wa\.me\/573000000001/);
});

test("sin CONTACT_WHATSAPP_NUMBER, el aviso sale SIN el renglon de Sofi -- nunca un link a medias", () => {
  const texto = construir(senal(), VEREDICTO, [matchUtil()], "573001234567");
  assert.doesNotMatch(texto, /escribirle a Sofi/);
  assert.doesNotMatch(texto, /YOUR_CONTACT_LINK/);
});

test("conserva lo que ya funcionaba: grupo, colega, pedido, refs, Sofi dice y el cierre", () => {
  const texto = construir(senal(), VEREDICTO, [matchUtil()], "573001234567");
  assert.match(texto, /Inmobiliarias Medellin/);
  assert.match(texto, /Patricia Gomez/);
  assert.match(texto, /Busco apartamento en Laureles, 3 alcobas/);
  assert.match(texto, /Ref AP004/);
  assert.match(texto, /Sofi dice: Es exactamente lo que pide/);
  assert.match(texto, /Contame en qué quedó/);
});

test("sin refs utiles, no hay nada que avisar", () => {
  assert.strictEqual(construir(senal(), { ...VEREDICTO, refs_utiles: [] }, [matchUtil()], "573001234567"), null);
});
