// Inbox pasivo de la linea vinculada — src/data/linea-dm.js.
//
// Existe SOLO porque la linea es 100% dedicada al radar, sin uso personal
// (Juan, 2026-08-21) — ver db/migrations/2026-08-21_linea_dm.sql.

const { test } = require("node:test");
const assert = require("node:assert");

// src/data/supabase.js NO crea el cliente real bajo test (guard 2026-08-24,
// ver ese archivo). Este test SI necesita un cliente truthy para poder
// mockear su metodo from() por tabla, asi que se inyecta un doble en el
// cache del modulo antes de cargar linea-dm.js — mismo patron que
// test/colegas-data.test.js y test/directorio.test.js usan para forzar null.
const supabasePath = require.resolve("../src/data/supabase");
delete require.cache[supabasePath];
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: { from: () => { throw new Error("from() sin mockear en este test"); } },
};

const lineaDm = require("../src/data/linea-dm");
const supabase = require("../src/data/supabase");

const ORG = "org-1";

function chain(resultado) {
  const c = {
    select: () => c,
    eq: () => c,
    not: () => c,
    order: () => c,
    limit: () => c,
    insert: () => c,
    update: () => c,
    single: () => Promise.resolve(resultado),
    maybeSingle: () => Promise.resolve(resultado),
    then: (resolve) => resolve(resultado),
  };
  return c;
}

test("create guarda el mensaje con sus campos mapeados", async (t) => {
  let recibido = null;
  t.mock.method(supabase, "from", () => {
    const c = chain({ data: null, error: null });
    c.insert = (row) => { recibido = row; return c; };
    c.single = () => Promise.resolve({ data: { id: "dm-1", ...recibido }, error: null });
    return c;
  });

  const { mensaje, duplicado } = await lineaDm.create(ORG, {
    sesion: "RADA-NATALIA", waMessageId: "wamid-1", remitenteTelefono: "573001112222",
    remitenteNombre: "Felipe", texto: "hola", fechaMensaje: "2026-08-21T10:00:00Z", senalId: "sig-1",
  });

  assert.strictEqual(duplicado, false);
  assert.strictEqual(mensaje.id, "dm-1");
  assert.strictEqual(recibido.wa_message_id, "wamid-1");
  assert.strictEqual(recibido.remitente_telefono, "573001112222");
  assert.strictEqual(recibido.senal_id, "sig-1");
});

test("create detecta el duplicado por el indice unico (23505), no lo trata como error", async (t) => {
  t.mock.method(supabase, "from", () => chain({ data: null, error: { code: "23505" } }));
  const { mensaje, duplicado } = await lineaDm.create(ORG, { waMessageId: "wamid-repetido" });
  assert.strictEqual(duplicado, true);
  assert.strictEqual(mensaje, null);
});

test("create se degrada limpio si la tabla todavia no existe (falta la migracion)", async (t) => {
  t.mock.method(supabase, "from", () => chain({ data: null, error: { code: "42P01" } }));
  const { mensaje, duplicado } = await lineaDm.create(ORG, { waMessageId: "wamid-x" });
  assert.strictEqual(mensaje, null);
  assert.strictEqual(duplicado, false);
});

test("historialDe sin telefono no consulta la base", async (t) => {
  const espia = t.mock.method(supabase, "from", () => chain({ data: [], error: null }));
  const h = await lineaDm.historialDe(ORG, null);
  assert.deepStrictEqual(h, []);
  assert.strictEqual(espia.mock.callCount(), 0);
});

test("historialDe devuelve el hilo en orden cronologico (mas viejo primero)", async (t) => {
  t.mock.method(supabase, "from", () => chain({
    data: [
      { id: "m3", texto: "c", created_at: "2026-08-21T10:02:00Z" },
      { id: "m2", texto: "b", created_at: "2026-08-21T10:01:00Z" },
      { id: "m1", texto: "a", created_at: "2026-08-21T10:00:00Z" },
    ],
    error: null,
  }));
  const h = await lineaDm.historialDe(ORG, "573001112222");
  assert.deepStrictEqual(h.map((m) => m.texto), ["a", "b", "c"]);
});

test("ultimaCitaAlertada usa la fecha si la hay, o el tipo de avance si no", async (t) => {
  t.mock.method(supabase, "from", () => chain({ data: { cita_fecha_hora_iso: "2026-08-25T15:00:00-05:00", avance_tipo: "cita_confirmada" }, error: null }));
  assert.strictEqual(await lineaDm.ultimaCitaAlertada(ORG, "573001112222"), "2026-08-25T15:00:00-05:00");
});

test("ultimaCitaAlertada cae al tipo cuando no hay fecha (ej interes_avanzado)", async (t) => {
  t.mock.method(supabase, "from", () => chain({ data: { cita_fecha_hora_iso: null, avance_tipo: "interes_avanzado" }, error: null }));
  assert.strictEqual(await lineaDm.ultimaCitaAlertada(ORG, "573001112222"), "interes_avanzado");
});

test("ultimaCitaAlertada sin nada alertado devuelve null", async (t) => {
  t.mock.method(supabase, "from", () => chain({ data: null, error: null }));
  assert.strictEqual(await lineaDm.ultimaCitaAlertada(ORG, "573001112222"), null);
});
