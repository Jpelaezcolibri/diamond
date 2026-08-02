// El contrato del EPE.
//
// Estos tests definen qué promete el núcleo. Si alguno falla, cambió el
// contrato — no el detalle de implementación.

const { test } = require("node:test");
const assert = require("node:assert");
const { procesar, aplicarCorte } = require("../epe/core");

const ahora = () => new Date().toISOString();
const haceDias = (n) => new Date(Date.now() - n * 86400000).toISOString();

// Un mensaje que pasa el prefiltro (tiene señal inmobiliaria real).
const conSenal = (extra = {}) => ({
  id: "m1",
  texto: "Tengo cliente para apto 3 alcobas en Laureles hasta 600 millones",
  autor: "Marcela",
  instanteIso: ahora(),
  esSistema: false,
  esMultimedia: false,
  ...extra,
});

// Un mensaje que el prefiltro descarta.
const ruido = (extra = {}) => ({
  id: "r1",
  texto: "Buenos días a todos, feliz lunes",
  autor: "Andrés",
  instanteIso: ahora(),
  esSistema: false,
  esMultimedia: false,
  ...extra,
});

// ── El contrato ──────────────────────────────────────────────────────────

test("devuelve solo aEnviar y métricas — nada de contenido descartado", async () => {
  const r = await procesar([conSenal(), ruido()]);

  assert.strictEqual(r.aEnviar.length, 1);
  assert.strictEqual(r.aEnviar[0].texto, conSenal().texto);
  assert.strictEqual(r.descartados, undefined, "lo descartado no se devuelve: no tiene consumidor y es texto de terceros");
  assert.deepStrictEqual(Object.keys(r.metricas).sort(), [
    "aEnviar", "crudos", "fueraDeCorte", "porMotivo", "prefiltrados", "repetidos", "tasaDescarte",
  ]);
});

test("una lista vacía no revienta y no inventa métricas", async () => {
  const r = await procesar([]);
  assert.deepStrictEqual(r.aEnviar, []);
  assert.strictEqual(r.metricas.crudos, 0);
  assert.strictEqual(r.metricas.tasaDescarte, 0);
});

test("el núcleo no necesita saber de qué grupo ni de qué cuenta viene", async () => {
  // Es lo que permite que el sensor no sepa nada del tenant (P1, P3): sin
  // `grupo`, sin `groupId`, sin `org_id`.
  const sinIdentidad = { ...conSenal() };
  delete sinIdentidad.grupo;
  const r = await procesar([sinIdentidad]);
  assert.strictEqual(r.aEnviar.length, 1);
});

// ── Orden de las etapas ──────────────────────────────────────────────────

test("el corte va ANTES del dedup y del prefiltro", async () => {
  // Un mensaje viejo no debe llegar a hashearse ni a prefiltrarse.
  const r = await procesar([conSenal({ instanteIso: haceDias(60) }), conSenal()], { dias: 30 });
  assert.strictEqual(r.metricas.fueraDeCorte, 1);
  assert.strictEqual(r.aEnviar.length, 1);
});

test("el dedup va ANTES del prefiltro — el mismo aviso se paga una vez", async () => {
  // Mismo autor y mismo texto en dos grupos distintos: una sola vez.
  const r = await procesar([
    conSenal({ id: "a", grupo: "Gremio A" }),
    conSenal({ id: "b", grupo: "Gremio B" }),
  ]);
  assert.strictEqual(r.metricas.repetidos, 1);
  assert.strictEqual(r.aEnviar.length, 1);
});

test("el dedup ignora el grupo pero respeta el contenido", async () => {
  const r = await procesar([
    conSenal({ id: "a" }),
    conSenal({ id: "b", texto: "Vendo casa en Envigado, 850 millones" }),
  ]);
  assert.strictEqual(r.metricas.repetidos, 0);
  assert.strictEqual(r.aEnviar.length, 2);
});

// ── La marca de agua ─────────────────────────────────────────────────────

test("`desde` gana sobre `dias` cuando es más reciente", async () => {
  const r = await procesar(
    [conSenal({ instanteIso: haceDias(10) }), conSenal({ id: "m2", texto: "Vendo lote en Rionegro 300 millones" })],
    { dias: 30, desde: haceDias(3) }
  );
  assert.strictEqual(r.metricas.fueraDeCorte, 1);
});

test("un mensaje sin instante se descarta: no se puede probar que sea reciente", async () => {
  const r = await procesar([conSenal({ instanteIso: null })], { dias: 30 });
  assert.strictEqual(r.metricas.fueraDeCorte, 1);
  assert.strictEqual(r.aEnviar.length, 0);
});

test("sin corte ni marca de agua pasa todo", async () => {
  const r = await procesar([conSenal({ instanteIso: haceDias(400) })]);
  assert.strictEqual(r.metricas.fueraDeCorte, 0);
  assert.strictEqual(r.aEnviar.length, 1);
});

// ── El tope ──────────────────────────────────────────────────────────────

test("el tope se evalúa DESPUÉS del corte", async () => {
  // Un export de tres años con marca de agua de ayer trae dos mensajes, no
  // cien mil. Evaluar el tope antes del corte rechazaría cargas legítimas.
  const viejos = Array.from({ length: 50 }, (_, i) =>
    conSenal({ id: `v${i}`, instanteIso: haceDias(400) })
  );
  const r = await procesar([...viejos, conSenal()], { dias: 30, maxMensajes: 10 });
  assert.strictEqual(r.aEnviar.length, 1);
});

test("superar el tope lanza un error identificable, no uno genérico", async () => {
  const muchos = Array.from({ length: 12 }, (_, i) => conSenal({ id: `m${i}`, texto: `Vendo casa ${i} en Belén 400 millones` }));
  await assert.rejects(
    () => procesar(muchos, { maxMensajes: 5 }),
    (e) => {
      assert.strictEqual(e.codigo, "DEMASIADOS_MENSAJES");
      assert.strictEqual(e.cuantos, 12);
      return true;
    }
  );
});

// ── Determinismo ─────────────────────────────────────────────────────────

test("la misma entrada da exactamente la misma salida", async () => {
  // Sin esto, un sensor que reintenta produce resultados distintos y el dedup
  // aguas abajo deja de servir.
  const entrada = [conSenal(), ruido(), conSenal({ id: "x", texto: "Casa en Sabaneta 500 millones" })];
  const a = await procesar(entrada, { dias: 30 });
  const b = await procesar(entrada, { dias: 30 });

  assert.deepStrictEqual(a.metricas, b.metricas);
  assert.deepStrictEqual(a.aEnviar.map((m) => m.id), b.aEnviar.map((m) => m.id));
});

test("procesar no muta la entrada", async () => {
  const entrada = [conSenal(), ruido()];
  const copia = JSON.parse(JSON.stringify(entrada));
  await procesar(entrada, { dias: 30 });
  assert.deepStrictEqual(entrada, copia);
});

// ── La métrica que vuelve medible el principio ───────────────────────────

test("tasaDescarte mide qué proporción NO sale del dispositivo", async () => {
  const r = await procesar([conSenal(), ruido(), ruido({ id: "r2" }), ruido({ id: "r3" })]);
  // 4 crudos, 1 sale → 75% se queda en el equipo del asesor.
  assert.strictEqual(r.metricas.tasaDescarte, 0.75);
});

test("tasaDescarte cuenta TODO lo que no salió, no solo el prefiltro", async () => {
  // Corte, dedup y prefiltro son las tres formas de no salir. Si la métrica
  // solo contara el prefiltro, sobreestimaría lo que viaja.
  const r = await procesar(
    [conSenal({ instanteIso: haceDias(60) }), conSenal({ id: "d" }), conSenal({ id: "d2" }), ruido()],
    { dias: 30 }
  );
  assert.strictEqual(r.metricas.aEnviar, 1);
  assert.strictEqual(r.metricas.tasaDescarte, 0.75);
});
