// construir() / construirEdificio() del aviso a Natalia cuando el radar (modo
// auto, hoy inactivo) NO respondio solo. Funciones puras, sin IO: no hace
// falta mockear nada, solo prender/apagar CONTACT_WHATSAPP_NUMBER por caso.
//
// CAMBIO DE POLITICA (Juan, 2026-08-22): "que se notifique al celular de
// natalia todo para que ella lo responda directamente desde su numero" — el
// gremio pide no llenar los grupos de informacion, asi que ningun aviso
// puede ofrecer publicar ni decir "respondele en el grupo" (ni siquiera el
// caso de edificio, que antes tenia ese texto en la rama sin candidatas).

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const { construir, construirEdificio } = require("../src/groups/aviso-cercano");

function señal(extra = {}) {
  return {
    grupo_nombre: "Inmobiliarias Medellin",
    autor_nombre: "Patricia Gomez",
    texto_original: "Busco apartamento en Laureles, 3 alcobas",
    ...extra,
  };
}

function candidata(extra = {}) {
  return {
    ref: "AP004",
    titulo: "Apartamento en Venta Envigado",
    zona: "Centro, Envigado",
    precio: "$395.000.000",
    puntaje: 88,
    ...extra,
  };
}

beforeEach(() => {
  delete process.env.CONTACT_WHATSAPP_NUMBER;
});

test("construir: sin candidatas, no hay nada que avisar", () => {
  assert.strictEqual(construir(señal(), []), null);
});

test("construir: pide responder por privado y nunca ofrece publicar", () => {
  const texto = construir(señal(), [candidata()]);
  assert.match(texto, /Respondele por privado/);
  assert.doesNotMatch(texto, /publicamos/i);
  assert.doesNotMatch(texto, /Sí, publicar/);
});

test("construir: con CONTACT_WHATSAPP_NUMBER definida, agrega el link de Sofi", () => {
  process.env.CONTACT_WHATSAPP_NUMBER = "573000000001";
  const texto = construir(señal(), [candidata()]);
  assert.match(texto, /escribirle a Sofi/);
  assert.match(texto, /https:\/\/wa\.me\/573000000001/);
});

test("construir: sin CONTACT_WHATSAPP_NUMBER, sale sin el renglon de Sofi -- nunca un link a medias", () => {
  const texto = construir(señal(), [candidata()]);
  assert.doesNotMatch(texto, /escribirle a Sofi/);
  assert.doesNotMatch(texto, /YOUR_CONTACT_LINK/);
});

test("construirEdificio: sin nombre de edificio, no hay nada que avisar", () => {
  assert.strictEqual(construirEdificio(señal(), [], ""), null);
});

test("construirEdificio: sin candidatas por zona, pide responder por privado -- ya no dice 'en el grupo'", () => {
  const texto = construirEdificio(señal(), [], "Murano Plaza");
  assert.match(texto, /Por zona tampoco encontró nada/);
  assert.match(texto, /respondele por privado a Patricia Gomez/);
  assert.doesNotMatch(texto, /respondele directo en el grupo/);
});

test("construirEdificio: con candidatas por zona, tambien pide responder por privado", () => {
  const texto = construirEdificio(señal(), [candidata()], "Murano Plaza");
  assert.match(texto, /Esto es lo que encontró por zona/);
  assert.match(texto, /respondele por privado a Patricia Gomez/);
  assert.doesNotMatch(texto, /respondele directo en el grupo/);
});
