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

// LA CUENTA LA HACE EL MOTOR (auditoria 2026-09-05, H3). Mateo Narvaez, 18:44:
// area 60 de 65 (dentro del margen) + "garajes: sin dato" -> Sofi conto DOS y
// mando a dudosas, con la regla "lo que no registramos no cuenta" escrita tres
// veces. Ahora la ficha trae el numero hecho, derivado de las razones del
// motor, y un "sin dato" no puede subirlo.
test("la ficha cuenta los incumplimientos conocidos y un 'sin dato' no suma", () => {
  const ficha = formatearCandidatas([
    { ...base, banos: 2, garajes: 0, razones: ["Zona: Viviendas del Sur", "$280M dentro de $300M", "3 alcobas", "60 m² (pediste 65)", "2 baños"] },
  ]);
  assert.ok(ficha.includes("incumplimientos conocidos: 1 (60 m² (pediste 65))"), ficha);
  assert.ok(ficha.includes("garajes: sin dato"), ficha);
});

test("el precio dentro del margen cuenta como incumplimiento conocido; sin cortos, la cuenta es 0", () => {
  const conMargen = formatearCandidatas([{ ...base, razones: ["Zona: Envigado", "$450M — 7% sobre $420M, dentro del margen", "3 alcobas"] }]);
  assert.ok(conMargen.includes("incumplimientos conocidos: 1 ($450M — 7% sobre $420M, dentro del margen)"), conMargen);
  const limpio = formatearCandidatas([{ ...base, razones: ["Zona: Envigado", "$400M dentro de $420M", "3 alcobas"] }]);
  assert.ok(limpio.includes("incumplimientos conocidos: 0"), limpio);
});

test("el prompt le ordena a Sofi usar la cuenta del motor tal cual", () => {
  const s = SISTEMA.replace(/\s+/g, " ");
  assert.ok(s.includes("LA CUENTA LA HACE EL MOTOR"));
  assert.ok(s.includes("N >= 2 -> DUDOSA"));
  assert.ok(s.includes('un area corta mas un "garajes: sin dato" es N = 1, no 2'));
});

test("el prompt le dice a Sofi que 'sin dato' es sin_confirmar, no dudosa, y que sobrar no se niega", () => {
  assert.ok(SISTEMA.includes('"sin dato" significa que NO LO'), "sin dato = no lo sabemos");
  assert.ok(SISTEMA.includes("no esta en esa cuenta ni la sube"), "un sin dato no cuenta como incumplimiento");
  assert.ok(SISTEMA.includes("SOBRAR NO ES FALLAR"));
});

// LO QUE WASI SI REGISTRA (2026-09-05). La API manda `features` para 43 de 112
// propiedades ("Urbanización cerrada" x16, "Terraza" x6, "Balcón" x32...) y
// desde hoy el sync las guarda en properties.caracteristicas. La ficha de Sofi
// las muestra para que "unidad cerrada" pueda confirmarse en positivo en vez
// de ir siempre a sin_confirmar. Sin ellas, la linea no aparece: una ficha
// "sin caracteristicas" se leeria como "no tiene nada".
test("la ficha muestra las caracteristicas registradas solo cuando las hay", () => {
  const con = formatearCandidatas([{ ...base, caracteristicas: "Balcón, Urbanización cerrada, Terraza" }]);
  assert.ok(con.includes("caracteristicas registradas: Balcón, Urbanización cerrada, Terraza"), con);
  const sin = formatearCandidatas([{ ...base, caracteristicas: null }]);
  assert.ok(!sin.includes("caracteristicas"), sin);
});

test("el prompt le dice a Sofi que lo registrado cumple y que la ausencia no es un 'no'", () => {
  const s = SISTEMA.replace(/\s+/g, " ");
  assert.ok(s.includes("caracteristicas registradas"));
  assert.ok(s.includes("la ausencia nunca es un \"no tiene\""));
});
