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
  const h = await lineaDm.historialDe(ORG, { telefono: null, lid: null });
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
  const h = await lineaDm.historialDe(ORG, { telefono: "573001112222", lid: null });
  assert.deepStrictEqual(h.map((m) => m.texto), ["a", "b", "c"]);
});

test("ultimaCitaAlertada usa la fecha si la hay, o el tipo de avance si no", async (t) => {
  t.mock.method(supabase, "from", () => chain({ data: { cita_fecha_hora_iso: "2026-08-25T15:00:00-05:00", avance_tipo: "cita_confirmada" }, error: null }));
  assert.strictEqual(await lineaDm.ultimaCitaAlertada(ORG, { telefono: "573001112222", lid: null }), "2026-08-25T15:00:00-05:00");
});

test("ultimaCitaAlertada cae al tipo cuando no hay fecha (ej interes_avanzado)", async (t) => {
  t.mock.method(supabase, "from", () => chain({ data: { cita_fecha_hora_iso: null, avance_tipo: "interes_avanzado" }, error: null }));
  assert.strictEqual(await lineaDm.ultimaCitaAlertada(ORG, { telefono: "573001112222", lid: null }), "interes_avanzado");
});

test("ultimaCitaAlertada sin nada alertado devuelve null", async (t) => {
  t.mock.method(supabase, "from", () => chain({ data: null, error: null }));
  assert.strictEqual(await lineaDm.ultimaCitaAlertada(ORG, { telefono: "573001112222", lid: null }), null);
});

// ── Identidad por lid (Juan, 2026-09-08) ──────────────────────────────────
//
// Los DM del radar salen a <lid>@lid y la respuesta vuelve por ese chat. Un
// lid NUNCA va en remitente_telefono: es el error contra el que advierte
// db/migrations/2026-09-04_dm_destinatario.sql.

test("create guarda remitente_lid y deja remitente_telefono en null cuando el chat llego por lid", async (t) => {
  let recibido = null;
  t.mock.method(supabase, "from", () => {
    const c = chain({ data: null, error: null });
    c.insert = (row) => { recibido = row; return c; };
    c.single = () => Promise.resolve({ data: { id: "dm-2", ...recibido }, error: null });
    return c;
  });

  await lineaDm.create(ORG, {
    waMessageId: "wamid-2", remitenteTelefono: null, remitenteLid: "276467766300904@lid",
    remitenteNombre: "Carva", texto: "hola", fechaMensaje: "2026-09-08T10:00:00Z",
  });

  assert.strictEqual(recibido.remitente_lid, "276467766300904@lid");
  assert.strictEqual(recibido.remitente_telefono, null);
});

test("columnaDeIdentidad prefiere el lid, cae al telefono, y sin ninguno devuelve null", () => {
  assert.deepStrictEqual(
    lineaDm.columnaDeIdentidad({ telefono: null, lid: "276467766300904@lid" }),
    { columna: "remitente_lid", valor: "276467766300904@lid" }
  );
  assert.deepStrictEqual(
    lineaDm.columnaDeIdentidad({ telefono: "573001112222", lid: null }),
    { columna: "remitente_telefono", valor: "573001112222" }
  );
  assert.strictEqual(lineaDm.columnaDeIdentidad({ telefono: null, lid: null }), null);
  assert.strictEqual(lineaDm.columnaDeIdentidad(null), null);
});

test("historialDe por lid filtra por remitente_lid, no por telefono", async (t) => {
  const filtros = [];
  t.mock.method(supabase, "from", () => {
    const c = chain({ data: [{ id: "m1", texto: "a", created_at: "2026-09-08T10:00:00Z" }], error: null });
    c.eq = (col, val) => { filtros.push([col, val]); return c; };
    return c;
  });
  const h = await lineaDm.historialDe(ORG, { telefono: null, lid: "276467766300904@lid" });
  assert.deepStrictEqual(h.map((m) => m.texto), ["a"]);
  assert.ok(filtros.some(([c, v]) => c === "remitente_lid" && v === "276467766300904@lid"));
  assert.ok(!filtros.some(([c]) => c === "remitente_telefono"));
});

test("historialDe sin identidad no consulta la base", async (t) => {
  const espia = t.mock.method(supabase, "from", () => chain({ data: [], error: null }));
  assert.deepStrictEqual(await lineaDm.historialDe(ORG, { telefono: null, lid: null }), []);
  assert.strictEqual(espia.mock.callCount(), 0);
});

test("ultimaCitaAlertada por lid filtra por remitente_lid", async (t) => {
  const filtros = [];
  t.mock.method(supabase, "from", () => {
    const c = chain({ data: { cita_fecha_hora_iso: null, avance_tipo: "agendando" }, error: null });
    c.eq = (col, val) => { filtros.push([col, val]); return c; };
    return c;
  });
  const clave = await lineaDm.ultimaCitaAlertada(ORG, { telefono: null, lid: "276467766300904@lid" });
  assert.strictEqual(clave, "agendando");
  assert.ok(filtros.some(([c, v]) => c === "remitente_lid" && v === "276467766300904@lid"));
});
