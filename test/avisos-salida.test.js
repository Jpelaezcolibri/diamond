// La bandeja de salida: un solo mensaje por asesora, agrupando lo pendiente.
//
// POR QUE EXISTE (Juan, 2026-09-02): "no quiero que seas tan insistente", "si
// un solo cliente envia 10 solicitudes que se agrupen". Medido ese dia en
// menos de tres horas: 23 mensajes a Natalia (18 de un solo mandato) y 14 a
// Catherine, cero respuestas, y cuatro rechazados por WhatsApp con
// `(#131056) pair rate limit hit`.
//
// Lo que este archivo protege es la linea que NO se cruza: agrupar es para el
// ASESOR. El DM al colega sigue siendo uno por uno y no pasa por aca.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const digest = require("../src/groups/digest-avisos");
const ritmo = require("../src/lib/ritmo-avisos");

beforeEach(() => ritmo._reset());

// ── El freno de ritmo ────────────────────────────────────────────────────

test("el PRIMER aviso a una asesora siempre pasa: la agrupacion es para la rafaga", () => {
  assert.strictEqual(ritmo.puedeEnviar("adv-1"), true);
});

test("el segundo dentro de la ventana NO pasa; pasada la ventana, si", () => {
  const t0 = Date.parse("2026-09-02T13:00:00Z");
  ritmo.registrarEnvio("adv-1", t0);

  assert.strictEqual(ritmo.puedeEnviar("adv-1", t0 + 60 * 1000), false, "un minuto despues, no");
  assert.strictEqual(
    ritmo.puedeEnviar("adv-1", t0 + (ritmo.VENTANA_MIN * 60 - 1) * 1000),
    false,
    "un segundo antes de la ventana, tampoco"
  );
  assert.strictEqual(
    ritmo.puedeEnviar("adv-1", t0 + ritmo.VENTANA_MIN * 60 * 1000),
    true,
    "cumplida la ventana, vuelve a salir"
  );
});

test("el freno es POR asesora: escribirle a una no calla a la otra", () => {
  const t0 = Date.parse("2026-09-02T13:00:00Z");
  ritmo.registrarEnvio("natalia", t0);
  assert.strictEqual(ritmo.puedeEnviar("natalia", t0 + 1000), false);
  assert.strictEqual(ritmo.puedeEnviar("catherine", t0 + 1000), true);
});

test("sin asesora identificada no se frena nada — nunca se pierde un aviso por esto", () => {
  assert.strictEqual(ritmo.puedeEnviar(null), true);
  assert.strictEqual(ritmo.puedeEnviar(undefined), true);
});

// ── El digest ────────────────────────────────────────────────────────────

const pedido = (colega, extra = {}) => ({
  colega, operacion: "compra", tipo: "apartamento", zona: "Envigado",
  precioMax: 500000000, utiles: 2, dudosas: 0, ...extra,
});

const oferta = (extra = {}) => ({
  mandato: "Cliente de Daiana Zea", zona: "Sabaneta", precio: "$490.000.000",
  habitaciones: 3, reparos: [], cumpleTodo: true, ...extra,
});

test("sin nada pendiente no hay mensaje", () => {
  assert.strictEqual(digest.construir("Natalia", [], []), null);
});

test("DIEZ pedidos del MISMO colega salen como UNA entrada, no como diez", () => {
  // Es literalmente el caso que Juan nombro: "si un solo cliente envia 10
  // solicitudes que se agrupen".
  const diez = Array.from({ length: 10 }, (_, i) => pedido("Camilo Puerta", { zona: `Zona ${i}` }));
  const texto = digest.construir("Natalia", diez, []);

  assert.match(texto, /Camilo Puerta — 10 pedidos distintos/);
  assert.strictEqual((texto.match(/Camilo Puerta/g) || []).length, 1, "el nombre del colega aparece UNA vez");
  assert.match(texto, /y 6 más/, "muestra los primeros y resume el resto");
});

test("pedidos de colegas distintos van en lineas distintas", () => {
  const texto = digest.construir("Natalia", [pedido("Lu Vallejo"), pedido("Jaime")], []);
  assert.match(texto, /1\. Lu Vallejo/);
  assert.match(texto, /2\. Jaime/);
});

test("las ofertas se agrupan por mandato y separan lo que cumple de lo que no", () => {
  const texto = digest.construir("Natalia", [], [
    oferta({ zona: "Envigado", cumpleTodo: true }),
    oferta({ zona: "Sabaneta", cumpleTodo: false, reparos: ["La zona es Sabaneta"] }),
    oferta({ zona: "Itagüí", cumpleTodo: false, reparos: ["Se pasa $30.000.000 del tope"] }),
  ]);

  assert.match(texto, /OFERTAS PARA CLIENTE DE DAIANA ZEA \(3\)/);
  assert.match(texto, /Cumplen todo:/);
  assert.match(texto, /Para revisar:/);
  assert.match(texto, /La zona es Sabaneta/);
  assert.ok(texto.indexOf("Cumplen todo:") < texto.indexOf("Para revisar:"), "primero lo que sirve");
});

test("dos mandatos distintos no se mezclan en la misma lista", () => {
  const texto = digest.construir("Natalia", [], [
    oferta({ mandato: "Cliente A" }),
    oferta({ mandato: "Cliente B" }),
  ]);
  assert.match(texto, /OFERTAS PARA CLIENTE A/);
  assert.match(texto, /OFERTAS PARA CLIENTE B/);
});

test("el total del encabezado cuenta pedidos y ofertas juntos", () => {
  const texto = digest.construir("Natalia", [pedido("Lu"), pedido("Jaime")], [oferta(), oferta()]);
  assert.match(texto, /Natalia, tenés 4 cosas nuevas/);
});

test("cierra diciendo como pedir el detalle: el digest no reemplaza la ficha, la difiere", () => {
  const texto = digest.construir("Natalia", [pedido("Lu"), pedido("Jaime")], []);
  assert.match(texto, /Respondé con el número/);
});

test("un digest de 12 ofertas sigue entrando en el tope de WhatsApp", () => {
  const muchas = Array.from({ length: 12 }, (_, i) =>
    oferta({ zona: `Sabaneta ${i}`, cumpleTodo: false, reparos: ["Se pasa $60.000.000 del tope", "La zona es Sabaneta"] })
  );
  const texto = digest.construir("Natalia", [], muchas);
  assert.ok(texto.length < 4000, `el digest mide ${texto.length}, tiene que caber en los 4096 de Meta`);
});
