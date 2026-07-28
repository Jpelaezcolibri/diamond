const { test } = require("node:test");
const assert = require("node:assert");
const { prefilter, motivoDescarte, tieneSenal } = require("../src/groups/prefilter");

const msg = (texto, extra = {}) => ({
  id: "t#0", grupo: "test", texto, autor: "Colega",
  esSistema: false, esMultimedia: false, ...extra,
});

const pasa = (texto, extra) => motivoDescarte(msg(texto, extra)) === null;

// ── Lo que DEBE pasar ────────────────────────────────────────────────────

test("demanda explícita de un colega pasa", () => {
  assert.ok(pasa("Tengo cliente para apto 3 alcobas en Laureles hasta 400 millones"));
  assert.ok(pasa("Busco casa en Belén para cliente, urgente"));
  assert.ok(pasa("Alguien tiene local en Envigado?"));
});

test("oferta de un colega pasa", () => {
  assert.ok(pasa("Les comparto apartaestudio en El Poblado, $1.800.000 arriendo"));
  assert.ok(pasa("Se vende casa en Sabaneta, comisión compartida"));
});

test("FALSO NEGATIVO: mensajes cortos con señal real NO se descartan por largo", () => {
  // El error mas caro y mas facil de cometer: filtrar por longitud antes que
  // por senal. Los tres son oportunidades reales de tres o cuatro palabras.
  assert.ok(pasa("3 alcobas Envigado"));
  assert.ok(pasa("Tengo el de Belén"));
  assert.ok(pasa("400 palos máximo"));
});

test("los precios se reconocen en todas las formas en que la gente los escribe", () => {
  assert.ok(tieneSenal("$400.000.000"));
  assert.ok(tieneSenal("400 millones"));
  assert.ok(tieneSenal("400 palos"));
  assert.ok(tieneSenal("1.200.000"));
});

test("una zona a secas basta como señal", () => {
  assert.ok(pasa("Alguien por Laureles?"));
  assert.ok(pasa("Zona Castropol"));
});

// ── Lo que DEBE descartarse ──────────────────────────────────────────────

test("el ruido social se descarta", () => {
  assert.strictEqual(motivoDescarte(msg("Buenos días a todos")), "sin_senal");
  assert.strictEqual(motivoDescarte(msg("Gracias")), "muy_corto");
  assert.strictEqual(motivoDescarte(msg("Jajaja qué bueno muchachos")), "sin_senal");
});

test("BUG: el barrio 'Buenos Aires' no convierte cada 'buenos días' en señal", () => {
  // Con un Set plano de tokens de zona, "buenos" solo bastaba y el saludo mas
  // comun del grupo —del orden del 5-10% del trafico— pasaba la Etapa 0
  // entero. Una zona de varias palabras exige TODOS sus tokens.
  assert.strictEqual(motivoDescarte(msg("Buenos días a todos")), "sin_senal");
  assert.ok(pasa("Tengo apto en Buenos Aires"));
});

test("los mensajes de sistema se descartan", () => {
  assert.strictEqual(motivoDescarte(msg("Fulano añadió a Mengano", { esSistema: true })), "sistema");
});

test("un adjunto sin pie de foto se descarta", () => {
  assert.strictEqual(motivoDescarte(msg("<Multimedia omitido>", { esMultimedia: true })), "multimedia");
});

test("un adjunto CON pie de foto útil se conserva", () => {
  // El pie puede ser la ficha entera; descartarlo por venir con foto seria un
  // falso negativo sistematico, porque las fichas casi siempre llevan imagen.
  const conPie = msg("<Multimedia omitido> Apartamento en Laureles, 3 alcobas, 450 millones", { esMultimedia: true });
  assert.strictEqual(motivoDescarte(conPie), null);
});

test("BUG: 'loma' genérica no basta como zona (mismo criterio que el inventario)", () => {
  // Coherente con test/zona-search.test.js: los tokens genericos no
  // identifican una zona. Si "loma" bastara, medio grupo pasaria la Etapa 0.
  assert.strictEqual(motivoDescarte(msg("subiendo la loma despacio")), "sin_senal");
});

// ── Metricas ─────────────────────────────────────────────────────────────

test("prefilter reporta la tasa de descarte, que es la métrica que decide el costo", () => {
  const mensajes = [
    msg("Buenos días"),
    msg("Gracias"),
    msg("Ok"),
    msg("Tengo cliente para apto en Laureles hasta 400 millones"),
  ];
  const { pasan, descartados, stats } = prefilter(mensajes);
  assert.strictEqual(pasan.length, 1);
  assert.strictEqual(descartados.length, 3);
  assert.strictEqual(stats.tasaDescarte, 0.75);
  assert.strictEqual(stats.total, 4);
});

test("los descartados conservan su motivo para poder auditarlos", () => {
  const { descartados } = prefilter([msg("Gracias"), msg("hola", { esSistema: true })]);
  assert.deepStrictEqual(descartados.map((d) => d.motivoDescarte), ["muy_corto", "sistema"]);
});

test("prefilter no explota con una lista vacía", () => {
  const { stats } = prefilter([]);
  assert.strictEqual(stats.tasaDescarte, 0);
});
