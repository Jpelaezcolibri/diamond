// Quien recibe el digest.
//
// Estos tests nacen de un bug real encontrado el 2026-08-02 en produccion:
// Danna Ospina tiene tres filas en `advisors` —arriendo, vehiculos y venta,
// mismo telefono— y el digest recorria filas, no personas. Iba a recibir tres
// mensajes identicos cada manana, con la plantilla de Meta cobrada tres veces.
//
// El modelo de una fila por (persona, especialidad) es correcto y se queda: el
// enrutamiento de leads es por especialidad. Lo que estaba mal era asumir que
// una fila equivale a un destinatario.

const { test } = require("node:test");
const assert = require("node:assert");

const { elegiblesEnLista } = require("../src/data/advisors");

// La foto real de produccion al 2026-08-02.
const DIAMOND = [
  { id: "46ad3a81", name: "Danna Ospina", phone: "573011880668", especialidad: "arriendo", activo: true, auth_user_id: null },
  { id: "9070e115", name: "Catherine Uribe", phone: "573028536489", especialidad: "venta", activo: true, recibe_transferencias: false, auth_user_id: null },
  { id: "f2e09cc1", name: "Danna Ospina", phone: "573011880668", especialidad: "vehiculos", activo: true, auth_user_id: null },
  { id: "6b639d16", name: "Asesor Prueba QA", phone: "573009998877", especialidad: "venta", activo: false, auth_user_id: null },
  { id: "f2ad2c41", name: "Natalia Velez", phone: "573001878024", especialidad: "venta", activo: true, auth_user_id: "auth-natalia" },
  { id: "261900e0", name: "Claudia Valencia", phone: "573003418113", especialidad: "venta", activo: true, recibe_transferencias: false, auth_user_id: null },
  { id: "f63ca64b", name: "Danna Ospina", phone: "573011880668", especialidad: "venta", activo: true, auth_user_id: "auth-danna" },
];

const telefonos = (r) => r.map((a) => a.phone).sort();

test("solo venta: los mercados sin inventario no reciben nada", () => {
  const r = elegiblesEnLista(DIAMOND, ["venta"]);
  assert.deepStrictEqual(
    telefonos(r),
    ["573001878024", "573011880668"],
    "Natalia y Danna, nadie mas"
  );
});

test("una persona, un mensaje — aunque tenga tres especialidades", () => {
  const r = elegiblesEnLista(DIAMOND, ["venta"]);
  const deDanna = r.filter((a) => a.phone === "573011880668");
  assert.strictEqual(deDanna.length, 1, "tres filas de Danna no son tres destinatarios");
});

test("sin el filtro de especialidad, Danna seguiria siendo una sola persona", () => {
  // El dedup no depende del filtro: son dos protecciones distintas y cada una
  // tiene que sostenerse sola.
  const r = elegiblesEnLista(DIAMOND, []);
  const deDanna = r.filter((a) => a.phone === "573011880668");
  assert.strictEqual(deDanna.length, 1);
  assert.deepStrictEqual(telefonos(r), ["573001878024", "573011880668"]);
});

test("de las filas repetidas gana la que tiene login del CRM", () => {
  // Es la identidad con la que esa persona actua sobre las señales: si el
  // digest la nombra con otra fila, el advisor_id de sus eventos no cuadra.
  const r = elegiblesEnLista(DIAMOND, ["venta"]);
  const danna = r.find((a) => a.phone === "573011880668");
  assert.strictEqual(danna.auth_user_id, "auth-danna");
});

test("el resultado no depende del orden en que vengan las filas", () => {
  const alReves = [...DIAMOND].reverse();
  assert.deepStrictEqual(
    elegiblesEnLista(alReves, ["venta"]).map((a) => a.id).sort(),
    elegiblesEnLista(DIAMOND, ["venta"]).map((a) => a.id).sort()
  );
});

test("recibe_transferencias false sigue excluyendo — Claudia y Catherine no entran", () => {
  const r = elegiblesEnLista(DIAMOND, ["venta"]);
  assert.ok(!r.some((a) => a.phone === "573003418113"), "Claudia esta excluida por decision de negocio");
  assert.ok(!r.some((a) => a.phone === "573028536489"), "Catherine tambien");
});

test("un asesor inactivo no recibe digest", () => {
  const r = elegiblesEnLista(DIAMOND, ["venta"]);
  assert.ok(!r.some((a) => a.phone === "573009998877"));
});

test("sin telefono no hay a donde mandar", () => {
  const r = elegiblesEnLista([{ id: "x", especialidad: "venta", activo: true, phone: null }], ["venta"]);
  assert.deepStrictEqual(r, []);
});

test("la especialidad se compara sin importar mayusculas", () => {
  const r = elegiblesEnLista(
    [{ id: "x", phone: "5731", especialidad: "Venta", activo: true }], ["venta"]
  );
  assert.strictEqual(r.length, 1);
});

test("lista vacia de especialidades = todas, para cuando arriendo tenga mercado", () => {
  const soloArriendo = [{ id: "x", phone: "5731", especialidad: "arriendo", activo: true }];
  assert.strictEqual(elegiblesEnLista(soloArriendo, []).length, 1);
  assert.strictEqual(elegiblesEnLista(soloArriendo, ["venta"]).length, 0);
});
