const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const { COLUMNAS_NUEVAS } = require("../src/data/group-signals");

// Mismo patron que test/group-signals-exigencias.test.js: se inyecta un doble en el
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
  amoblado: "", periodo: null,
  fecha_mensaje: "2026-09-07T20:05:00.000Z",
};

test("las columnas nuevas entran en la lista de reintento", () => {
  // Si el insert falla porque la migracion no corrio, group-signals reintenta
  // SIN estas columnas. Fuera de la lista, una senal se perderia entera en vez
  // de guardarse sin el dato nuevo — y una senal guardada a medias vale mucho
  // mas que una senal perdida.
  assert.ok(COLUMNAS_NUEVAS.includes("amoblado"));
  assert.ok(COLUMNAS_NUEVAS.includes("periodo"));
});

// ── Tri-estado del amoblado ──────────────────────────────────────────────────
// Hallazgo del revisor (2026-09-07): `amoblado: fields.amoblado ?? null` protege
// contra ediciones que cambien `??` por `||`, que colapsarian "" en null.
// "" (no se menciona) y "no" (se rechaza) son DISTINTOS y ambos conducen a
// comportamiento diferente en match.js y en el panel. Un regresion aqui seria
// silenciosa: la migracion correria, el insert entraria, pero la distincion se
// perderia para siempre en los datos historicos.

test("amoblado vacio se guarda como string vacio, no como null", async () => {
  const { mod, insertadas } = instalar([]);
  await mod.create("org-1", { ...pedido, amoblado: "" });
  limpiar();
  assert.strictEqual(insertadas[0].amoblado, "", "amoblado vacio debe ser string");
  assert.notStrictEqual(insertadas[0].amoblado, null);
});

test("amoblado 'no' se guarda como 'no', no como null", async () => {
  const { mod, insertadas } = instalar([]);
  await mod.create("org-1", { ...pedido, amoblado: "no" });
  limpiar();
  assert.strictEqual(insertadas[0].amoblado, "no");
});

test("amoblado 'si' se guarda como 'si', no como null", async () => {
  const { mod, insertadas } = instalar([]);
  await mod.create("org-1", { ...pedido, amoblado: "si" });
  limpiar();
  assert.strictEqual(insertadas[0].amoblado, "si");
});

test("amoblado undefined se guarda como null", async () => {
  const { mod, insertadas } = instalar([]);
  await mod.create("org-1", { group_id: "grp-1", wa_message_id: "w", clase: "demanda" });
  limpiar();
  assert.strictEqual(insertadas[0].amoblado, null);
});

test("periodo se guarda con sus valores cuando llega", async () => {
  const { mod, insertadas } = instalar([]);
  await mod.create("org-1", { ...pedido, periodo: "mes" });
  limpiar();
  assert.strictEqual(insertadas[0].periodo, "mes");
});

test("periodo vacio se guarda como string vacio, no como null", async () => {
  const { mod, insertadas } = instalar([]);
  await mod.create("org-1", { ...pedido, periodo: "" });
  limpiar();
  assert.strictEqual(insertadas[0].periodo, "", "periodo vacio debe ser string");
  assert.notStrictEqual(insertadas[0].periodo, null);
});

test("periodo 'corta' se guarda como 'corta', no como null", async () => {
  const { mod, insertadas } = instalar([]);
  await mod.create("org-1", { ...pedido, periodo: "corta" });
  limpiar();
  assert.strictEqual(insertadas[0].periodo, "corta");
});

test("periodo undefined se guarda como null", async () => {
  const { mod, insertadas } = instalar([]);
  await mod.create("org-1", { group_id: "grp-1", wa_message_id: "w", clase: "demanda" });
  limpiar();
  assert.strictEqual(insertadas[0].periodo, null);
});

// ── Degradacion: la migracion no corrio todavia ──────────────────────────────
// Hallazgo historico (2026-08-24, bug real): hasta hoy, cuando el insert fallaba
// por columna faltante, el reintento borraba TODA la lista de columnas nuevas.
// Esto significaba que si amoblado o periodo no existian en la base todavia, se
// perdia tambien fecha_mensaje — la marca de agua que decide si un pedido puede
// salir por DM automatico (decidirDm en politica.js devuelve sin_fecha_mensaje).
// Se habrian perdido DMs sin un solo error visible.

const errorColumna = (columna) => ({
  data: null,
  error: { code: "PGRST204", message: `Could not find the '${columna}' column of 'group_signals' in the schema cache` },
});

test("si falta amoblado, se reintenta sin ella y la senal se guarda igual", async () => {
  const { mod, insertadas } = instalar([errorColumna("amoblado")]);
  const r = await mod.create("org-1", pedido);
  limpiar();

  assert.ok(r.signal, "la senal no se pierde por amoblado sin migrar");
  assert.strictEqual(insertadas.length, 2, "un intento y un reintento");
  assert.strictEqual(insertadas[1].amoblado, undefined, "amoblado no viaja en el reintento");
});

test("una columna faltante (amoblado) NO se lleva puestas las demas -- fecha_mensaje sobrevive", async () => {
  const { mod, insertadas } = instalar([errorColumna("amoblado")]);
  await mod.create("org-1", pedido);
  limpiar();

  const reintento = insertadas[1];
  assert.strictEqual(reintento.amoblado, undefined, "solo se saca la que falta");
  assert.strictEqual(reintento.fecha_mensaje, pedido.fecha_mensaje, "fecha_mensaje sigue viajando");
  assert.strictEqual(reintento.origen, "vivo");
});


test("si faltan amoblado y periodo, se van sacando de a una", async () => {
  const { mod, insertadas } = instalar([errorColumna("amoblado"), errorColumna("periodo")]);
  const r = await mod.create("org-1", pedido);
  limpiar();

  assert.ok(r.signal);
  assert.strictEqual(insertadas.length, 3);
  assert.strictEqual(insertadas[2].amoblado, undefined);
  assert.strictEqual(insertadas[2].periodo, undefined);
  assert.strictEqual(insertadas[2].fecha_mensaje, pedido.fecha_mensaje);
});
