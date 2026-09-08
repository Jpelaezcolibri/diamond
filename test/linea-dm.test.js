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

// ── DEGRADACION SI FALTA LA COLUMNA (revision final, 2026-09-08) ──────────
//
// El caso real es desplegar ANTES de correr
// db/migrations/2026-09-08_linea_dm_lid.sql. PostgREST responde PGRST204 y
// Postgres 42703, y hasta hoy los dos caian en el `throw` final de create:
// la excepcion la atrapaba el .catch del webhook
// (src/channels/whatsapp-group.js), pero para entonces yaVisto() ya habia
// marcado el mensaje y a WAHA ya se le habia respondido 200 — o sea que la
// PRIMERA respuesta de un colega se perdia para siempre, sin reintento
// posible. Y el panel vacio mandaba a diagnosticar lo que no era ("el
// supuesto del @lid era falso") en vez de "falta una columna".
//
// Mismo blindaje que src/data/group-signals.js: se reintenta sin la columna
// nueva y se avisa UNA vez por proceso.

test("create reintenta sin remitente_lid si la columna todavia no existe (42703), en vez de perder la fila", async (t) => {
  const inserts = [];
  t.mock.method(supabase, "from", () => {
    const c = chain({ data: null, error: null });
    c.insert = (row) => {
      inserts.push(row);
      const esElPrimero = inserts.length === 1;
      c.single = () =>
        Promise.resolve(
          esElPrimero
            ? { data: null, error: { code: "42703", message: 'column "remitente_lid" of relation "linea_dm" does not exist' } }
            : { data: { id: "dm-3", ...row }, error: null }
        );
      return c;
    };
    return c;
  });
  const avisos = [];
  t.mock.method(console, "warn", (m) => avisos.push(String(m)));

  const { mensaje, duplicado } = await lineaDm.create(ORG, {
    waMessageId: "wamid-3", remitenteTelefono: null, remitenteLid: "276467766300904@lid",
    remitenteNombre: "Carva", texto: "si señor, mañana lo muestro", fechaMensaje: "2026-09-08T10:00:00Z",
  });

  // LA FILA NO SE PIERDE: es lo unico que importa de este test.
  assert.strictEqual(duplicado, false);
  assert.ok(mensaje, "la respuesta del colega tiene que quedar guardada igual");
  assert.strictEqual(mensaje.id, "dm-3");
  assert.strictEqual(mensaje.texto, "si señor, mañana lo muestro");
  assert.strictEqual(mensaje.wa_message_id, "wamid-3");

  assert.strictEqual(inserts.length, 2, "un intento con la columna y un reintento sin ella");
  assert.strictEqual(inserts[0].remitente_lid, "276467766300904@lid");
  assert.ok(!("remitente_lid" in inserts[1]), "el reintento va sin la columna que no existe");
  // Lo demas del row sobrevive intacto: se suelta UNA columna, no el registro.
  assert.strictEqual(inserts[1].wa_message_id, "wamid-3");
  assert.strictEqual(inserts[1].texto, "si señor, mañana lo muestro");

  // Un aviso por proceso, no uno por mensaje: mientras la migracion este
  // pendiente esto corre en CADA DM y taparia el log.
  await lineaDm.create(ORG, { waMessageId: "wamid-4", remitenteLid: "276467766300904@lid" });
  assert.strictEqual(avisos.filter((a) => a.includes("2026-09-08_linea_dm_lid.sql")).length, 1);
});

test("create tambien reconoce el PGRST204 de PostgREST como columna faltante", async (t) => {
  const inserts = [];
  t.mock.method(supabase, "from", () => {
    const c = chain({ data: null, error: null });
    c.insert = (row) => {
      inserts.push(row);
      const esElPrimero = inserts.length === 1;
      c.single = () =>
        Promise.resolve(
          esElPrimero
            ? { data: null, error: { code: "PGRST204", message: "Could not find the 'remitente_lid' column of 'linea_dm' in the schema cache" } }
            : { data: { id: "dm-5", ...row }, error: null }
        );
      return c;
    };
    return c;
  });

  const { mensaje } = await lineaDm.create(ORG, { waMessageId: "wamid-5", remitenteLid: "276467766300904@lid", texto: "listo" });
  assert.ok(mensaje, "PGRST204 es el mismo hecho que 42703: falta la columna");
  assert.strictEqual(mensaje.id, "dm-5");
  assert.strictEqual(inserts.length, 2);
});

test("un error que NO es de columna ni de tabla sigue explotando: no se traga cualquier fallo", async (t) => {
  t.mock.method(supabase, "from", () => chain({ data: null, error: { code: "08006", message: "connection failure" } }));
  // Se lanza el error crudo de supabase (un objeto, no un Error), asi que se
  // afirma sobre el codigo: lo que importa es que NO se lo trague.
  await assert.rejects(
    () => lineaDm.create(ORG, { waMessageId: "wamid-6" }),
    (e) => e.code === "08006"
  );
});

test("historialDe se degrada a vacio si falta la columna, en vez de tumbar el hilo", async (t) => {
  t.mock.method(supabase, "from", () => chain({ data: null, error: { code: "42703", message: 'column "remitente_lid" does not exist' } }));
  assert.deepStrictEqual(await lineaDm.historialDe(ORG, { telefono: null, lid: "276467766300904@lid" }), []);
});

test("ultimaCitaAlertada se degrada a null si falta la columna", async (t) => {
  t.mock.method(supabase, "from", () => chain({ data: null, error: { code: "PGRST204", message: "columna faltante" } }));
  assert.strictEqual(await lineaDm.ultimaCitaAlertada(ORG, { telefono: null, lid: "276467766300904@lid" }), null);
});
