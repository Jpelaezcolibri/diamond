// Lo que el colega pidio de verdad: area, baños, garajes, estrato y si acepta
// una alcoba menos (Juan, 2026-08-24 — caso Edwin Ramirez).
//
// classify.js YA extraia estos campos y match.js YA los usaba para puntuar;
// lo unico que faltaba era guardarlos. Sin eso, el panel mostraba un pedido
// recortado ("Lo que pide" moria en Alcobas) y el efecto del castigo por
// cumplir corto no se podia medir sobre historico.
//
// Se prueba tambien la degradacion, que es donde estaba el riesgo real: hasta
// hoy el reintento por columna faltante borraba la lista ENTERA de columnas
// nuevas, asi que una migracion sin correr se llevaba puesto tambien
// `fecha_mensaje` — de donde sale la antiguedad del pedido para decidir el DM.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

// Mismo patron que test/group-signals-dm.test.js: se inyecta un doble en el
// cache del modulo ANTES de cargarlo, porque src/data/supabase.js exporta
// null bajo test.
const supabasePath = require.resolve("../src/data/supabase");
const groupSignalsPath = require.resolve("../src/data/group-signals");

// `respuestas` es una cola: cada insert consume la siguiente. Asi se puede
// simular "falla por columna X, despues anda".
function instalar(respuestas) {
  const insertadas = [];
  delete require.cache[supabasePath];
  delete require.cache[groupSignalsPath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true,
    exports: {
      from: () => ({
        insert: (fila) => {
          insertadas.push(fila);
          const r = respuestas.shift() || { data: { id: "sig-1", ...fila }, error: null };
          return { select: () => ({ single: async () => r }) };
        },
      }),
    },
  };
  const mod = require(groupSignalsPath);
  mod._resetBlindaje();
  return { mod, insertadas };
}

function limpiar() {
  delete require.cache[supabasePath];
  delete require.cache[groupSignalsPath];
}

beforeEach(limpiar);

const pedido = {
  group_id: "grp-1", wa_message_id: "wamid-1", clase: "demanda",
  operacion: "venta", tipo: "apartamento", zona: "Envigado",
  precio_max: 980000000, habitaciones: 3,
  area_min: 98, banos: 2, garajes: 2, estrato: 5, flexible_habitaciones: true,
  fecha_mensaje: "2026-08-24T20:05:00.000Z",
};

test("las cinco exigencias del pedido se guardan, no solo alcobas y precio", async () => {
  const { mod, insertadas } = instalar([]);
  await mod.create("org-1", pedido);
  limpiar();

  const fila = insertadas[0];
  assert.strictEqual(fila.area_min, 98);
  assert.strictEqual(fila.banos, 2);
  assert.strictEqual(fila.garajes, 2);
  assert.strictEqual(fila.estrato, 5);
  assert.strictEqual(fila.flexible_habitaciones, true);
});

// `|| null` convertiria false en null y se perderia la diferencia entre "el
// pedido NO acepta una menos" y "no sabemos" — que es justo lo que explica
// por que una propiedad corta pudo (o no pudo) entrar.
test("flexible_habitaciones en false se guarda como false, no como null", async () => {
  const { mod, insertadas } = instalar([]);
  await mod.create("org-1", { ...pedido, flexible_habitaciones: false });
  limpiar();
  assert.strictEqual(insertadas[0].flexible_habitaciones, false);
});

test("un pedido que no menciona nada de esto guarda null, no ceros", async () => {
  const { mod, insertadas } = instalar([]);
  await mod.create("org-1", {
    group_id: "grp-1", wa_message_id: "w", clase: "demanda",
    area_min: 0, banos: 0, garajes: 0, estrato: 0,
  });
  limpiar();

  const fila = insertadas[0];
  for (const c of ["area_min", "banos", "garajes", "estrato"]) {
    assert.strictEqual(fila[c], null, `${c} vacio va como null`);
  }
});

// ── Degradacion: la migracion no corrio todavia ──────────────────────────

const errorColumna = (columna) => ({
  data: null,
  error: { code: "PGRST204", message: `Could not find the '${columna}' column of 'group_signals' in the schema cache` },
});

test("si falta UNA columna, se reintenta sin ella y la señal se guarda igual", async () => {
  const { mod, insertadas } = instalar([errorColumna("garajes")]);
  const r = await mod.create("org-1", pedido);
  limpiar();

  assert.ok(r.signal, "la señal no se pierde por una columna sin migrar");
  assert.strictEqual(insertadas.length, 2, "un intento y un reintento");
  assert.strictEqual(insertadas[1].garajes, undefined, "la columna que falta no viaja");
});

// EL PUNTO DE ESTE ARCHIVO. Antes de hoy, cualquier columna faltante borraba
// TODAS las columnas nuevas de un saque: con esta migracion sin correr y la
// de agosto ya corrida —el estado normal durante un despliegue— se perdia
// `fecha_mensaje`, y sin fecha el pedido no puede salir por DM
// (src/groups/politica.js#decidirDm devuelve sin_fecha_mensaje). Se habrian
// perdido DMs sin un solo error visible.
test("una columna faltante NO se lleva puestas las demas -- fecha_mensaje sobrevive", async () => {
  const { mod, insertadas } = instalar([errorColumna("area_min")]);
  await mod.create("org-1", pedido);
  limpiar();

  const reintento = insertadas[1];
  assert.strictEqual(reintento.area_min, undefined, "solo se saca la que falta");
  assert.strictEqual(reintento.fecha_mensaje, pedido.fecha_mensaje, "fecha_mensaje sigue viajando");
  assert.strictEqual(reintento.origen, "vivo");
  assert.strictEqual(reintento.banos, 2, "las otras columnas de la misma migracion tampoco se pierden");
});

test("si faltan dos columnas distintas, se van sacando de a una", async () => {
  const { mod, insertadas } = instalar([errorColumna("estrato"), errorColumna("garajes")]);
  const r = await mod.create("org-1", pedido);
  limpiar();

  assert.ok(r.signal);
  assert.strictEqual(insertadas.length, 3);
  assert.strictEqual(insertadas[2].estrato, undefined);
  assert.strictEqual(insertadas[2].garajes, undefined);
  assert.strictEqual(insertadas[2].fecha_mensaje, pedido.fecha_mensaje);
});

// Si el mensaje del error no nombra ninguna columna conocida no hay nada que
// identificar: se cae al comportamiento historico (sacar todas) antes que
// perder la señal. Perder metadatos es malo; perder el pedido es peor.
test("si no se puede identificar la columna, se sacan todas -- pero la señal se guarda", async () => {
  const { mod, insertadas } = instalar([{ data: null, error: { code: "42703", message: "columna faltante" } }]);
  const r = await mod.create("org-1", pedido);
  limpiar();

  assert.ok(r.signal, "la señal se guarda igual: ese es el objetivo del blindaje");
  assert.strictEqual(insertadas[1].fecha_mensaje, undefined);
  assert.strictEqual(insertadas[1].area_min, undefined);
  assert.strictEqual(insertadas[1].zona, "Envigado", "lo que no es columna nueva nunca se toca");
});

// Un error que menciona algo entre comillas que NO es una columna nuestra no
// puede hacer que se borre un campo a ciegas.
test("no se borra a ciegas un campo que el error nombro por otra razon", async () => {
  const { mod, insertadas } = instalar([
    { data: null, error: { code: "42703", message: `column "otra_cosa" of relation "group_signals" does not exist` } },
  ]);
  await mod.create("org-1", pedido);
  limpiar();
  // Cae al camino historico (todas), no a "borrar otra_cosa" ni a un bucle.
  assert.strictEqual(insertadas.length, 2);
});

test("el dedup por indice unico sigue reportandose como duplicado, no como columna faltante", async () => {
  const { mod } = instalar([{ data: null, error: { code: "23505", message: "duplicate key" } }]);
  const r = await mod.create("org-1", pedido);
  limpiar();
  assert.deepStrictEqual(r, { signal: null, duplicado: true });
});
