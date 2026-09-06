// El cierre del dia — src/groups/cierre-dia.js.
//
// BUG REAL QUE ORIGINA ESTE MODULO (Juan, 2026-09-06): el recordatorio por
// pedido le citaba a Natalia el texto que habia escrito el COLEGA en el grupo
// ("Buenas tardes Quién tiene lotes para construir bodega en zona franca
// Rionegro..."). Juan: "el asesor no sabe de que propiedad estan hablando".
// La asesora no gestiona pedidos ajenos, gestiona SUS propiedades, y las
// reconoce por referencia.
//
// Estos tests fijan las dos cosas que no se pueden romper: que el mensaje
// nombre NUESTRA propiedad, y que la numeracion sea estable y auditable.

const { test } = require("node:test");
const assert = require("node:assert");

const cierre = require("../src/groups/cierre-dia");

const ADVISOR = { id: "adv-1", name: "Natalia Velez" };

// Señal real del 2026-09-05, recortada: aviso a la asesora, sin utiles, con
// una dudosa. El texto del colega es largo a proposito — es el que NO debe
// aparecer en el mensaje.
const SEÑAL_AVISO = {
  id: "sig-1",
  autor_nombre: "Gustavo Arango",
  texto_original: "*_PEDIDO 1_* *SE BUSCA APARTAMENTO EN VENTA — EL POBLADO* Sectores: Zúñiga, Otra Parte, La Frontera",
  matches: [
    { ref: "10316178", titulo: "Apartamento en Venta en Otraparte, Envigado", zona: "Otra Parte", puntaje: 81 },
    { ref: "10077063", titulo: "VENDO APARTAMENTO ENVIGADO BARRIO MESA", zona: "Envigado", puntaje: 56 },
  ],
  revalidacion: { refs_utiles: [], refs_dudosas: ["10316178"] },
  enviado_at: "2026-09-05T13:36:00Z",
  respondida_at: null,
  respuesta_refs: null,
};

// Señal que salio por DM al colega: la referencia que de verdad se ofrecio
// esta en respuesta_refs.
const SEÑAL_DM = {
  id: "sig-2",
  autor_nombre: "Adriana Gutierrez",
  texto_original: "📌Casa en unidad de Loma de los Bernal o La Mota, mínimo 3 alcobas",
  matches: [
    { ref: "10012896", titulo: "VENDO EXCLUSIVA CASA REMODELADA EN BELEN", zona: "La Mota", puntaje: 81 },
    { ref: "10099999", titulo: "OTRA CASA QUE NO SE OFRECIO", zona: "Belén", puntaje: 90 },
  ],
  revalidacion: { refs_utiles: ["10012896", "10099999"], refs_dudosas: [] },
  enviado_at: null,
  respondida_at: "2026-09-05T13:59:00Z",
  respuesta_refs: ["10012896"],
};

test("el mensaje nombra NUESTRA propiedad, nunca el texto que escribio el colega", () => {
  const r = cierre.armar([SEÑAL_AVISO], ADVISOR);

  assert.match(r.texto, /10316178/, "tiene que llevar la referencia");
  assert.doesNotMatch(r.texto, /zona franca|Zúñiga|SE BUSCA APARTAMENTO/, "el pedido del colega no va en el mensaje");
});

test("saluda por el primer nombre de quien recibe, no con uno hardcodeado", () => {
  const r = cierre.armar([SEÑAL_AVISO], ADVISOR);
  assert.match(r.texto, /^Natalia,/);
});

test("numera desde 1 y guarda la numeracion para poder cobrarla despues", () => {
  const r = cierre.armar([SEÑAL_AVISO, SEÑAL_DM], ADVISOR);

  assert.strictEqual(r.items.length, 2);
  assert.deepStrictEqual(
    r.items.map((i) => [i.n, i.signal_ids, i.ref]),
    [[1, ["sig-1"], "10316178"], [2, ["sig-2"], "10012896"]]
  );
  assert.match(r.texto, /1\) 10316178/);
  assert.match(r.texto, /2\) 10012896/);
});

// La que salio es la que se pregunta. refs_utiles tenia dos, pero al colega
// solo le llego una: preguntar por la otra seria preguntar por algo que nunca
// se ofrecio.
test("cuando hubo DM, la referencia es la que REALMENTE salio, no la mejor puntuada", () => {
  const r = cierre.armar([SEÑAL_DM], ADVISOR);
  assert.strictEqual(r.items[0].ref, "10012896");
  assert.doesNotMatch(r.texto, /10099999/);
});

test("sin DM, cae a refs_utiles y despues a refs_dudosas", () => {
  const soloUtiles = { ...SEÑAL_DM, respuesta_refs: null, respondida_at: null, enviado_at: "2026-09-05T14:00:00Z" };
  assert.strictEqual(cierre.armar([soloUtiles], ADVISOR).items[0].ref, "10012896");

  // SEÑAL_AVISO no tiene utiles: la dudosa es lo unico que se movio.
  assert.strictEqual(cierre.armar([SEÑAL_AVISO], ADVISOR).items[0].ref, "10316178");
});

test("una señal sin ninguna referencia NO entra: preguntar por algo que no podemos nombrar es el bug original", () => {
  const sinRef = { ...SEÑAL_AVISO, id: "sig-3", matches: [], revalidacion: { refs_utiles: [], refs_dudosas: [] }, respuesta_refs: null };
  const r = cierre.armar([sinRef], ADVISOR);
  assert.strictEqual(r, null);
});

test("un dia sin movimiento no manda nada", () => {
  assert.strictEqual(cierre.armar([], ADVISOR), null);
});

test("el mensaje dice como responder y da un ejemplo", () => {
  const r = cierre.armar([SEÑAL_AVISO, SEÑAL_DM], ADVISOR);
  assert.match(r.texto, /número/i);
  assert.match(r.texto, /no servía/);
});

// Un dia con 20 propiedades es un mensaje que nadie lee. Las que quedan fuera
// vuelven mañana, porque siguen sin resultado.
test("tope de 10 propiedades, y dice cuantas quedaron para mañana", () => {
  const muchas = Array.from({ length: 14 }, (_, i) => ({
    ...SEÑAL_AVISO,
    id: `sig-${i}`,
    matches: [{ ref: `100000${i}`, titulo: "Apartamento de prueba", zona: "Envigado", puntaje: 80 }],
    revalidacion: { refs_utiles: [`100000${i}`], refs_dudosas: [] },
  }));

  const r = cierre.armar(muchas, ADVISOR);
  assert.strictEqual(r.items.length, 10);
  assert.match(r.texto, /10\) 1000009/);
  assert.match(r.texto, /4 más/);
});

test("sin nombre del colega el renglon no inventa uno", () => {
  const anonimo = { ...SEÑAL_AVISO, autor_nombre: null };
  const r = cierre.armar([anonimo], ADVISOR);
  assert.match(r.texto, /1\) 10316178/);
  assert.doesNotMatch(r.texto, /—\s*$/m, "no deja un guion colgando sin nombre");
});

// EL DEFECTO QUE SE VIO EN EL ENSAYO CON DATOS REALES (2026-09-06). El cierre
// del 5 de septiembre listaba dos veces la 10012896, la casa de La Mota: dos
// señales distintas ofrecieron la MISMA propiedad. Pedirle a la asesora que
// responda dos veces por una sola propiedad es justo lo que hace que no
// responda.
test("la misma propiedad ofrecida dos veces se lista UNA vez, y cubre las dos señales", () => {
  const otraVez = { ...SEÑAL_DM, id: "sig-3" };
  const r = cierre.armar([SEÑAL_DM, otraVez], ADVISOR);

  assert.strictEqual(r.items.length, 1, "una sola propiedad, un solo numero");
  assert.deepStrictEqual(r.items[0].signal_ids, ["sig-2", "sig-3"], "responder ese numero cierra las dos");
  assert.strictEqual((r.texto.match(/10012896/g) || []).length, 1);
});

test("si dos colegas distintos pidieron la misma propiedad, se nombran los dos", () => {
  const otroColega = { ...SEÑAL_DM, id: "sig-4", autor_nombre: "Carlos Borja" };
  const r = cierre.armar([SEÑAL_DM, otroColega], ADVISOR);

  assert.strictEqual(r.items.length, 1);
  assert.match(r.texto, /Adriana/);
  assert.match(r.texto, /Carlos/);
});

// "Apartamento en Venta en Otraparte, Envigado -..." cortado a la mitad de una
// palabra se lee como un error, no como un titulo.
test("el titulo se corta en un espacio, nunca a mitad de palabra", () => {
  const largo = {
    ...SEÑAL_AVISO,
    matches: [{ ref: "111", titulo: "Apartamento en Venta en Otraparte Envigado con excelente vista", zona: "Otra Parte", puntaje: 90 }],
    revalidacion: { refs_utiles: ["111"], refs_dudosas: [] },
  };
  const r = cierre.armar([largo], ADVISOR);
  const linea = r.texto.split(String.fromCharCode(10)).find((l) => l.startsWith("1)"));
  assert.match(linea, /\.\.\./, "este titulo es largo, tiene que recortarse");
  // Lo que queda antes de los puntos suspensivos termina en palabra completa.
  const recortado = linea.slice(0, linea.indexOf("..."));
  assert.ok(/(Otraparte|Envigado|Venta|en)$/.test(recortado.trim()), `corto a mitad de palabra: "${recortado}"`);
});

test("el nombre del colega se acorta: nadie necesita 'Consultor Profesional Inmobiliario'", () => {
  const largo = { ...SEÑAL_AVISO, autor_nombre: "Esteban Higuita Consultor Profesional Inmobiliario" };
  const r = cierre.armar([largo], ADVISOR);
  assert.match(r.texto, /Esteban Higuita/);
  assert.doesNotMatch(r.texto, /Consultor Profesional/);
});
