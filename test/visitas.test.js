// Cruce de "que pudimos capturar como visita agendada" (Juan, 2026-08-21):
// "todo lo que pase por Diamond que se pueda poner como agendada la pones y
// la mides, lo que esta por fuera de manera manual lo hacemos despues".
// Dos fuentes: leads.cita (cliente directo) y linea_dm (colega con avance).

const { test } = require("node:test");
const assert = require("node:assert");

// src/data/supabase.js NO crea el cliente real bajo test (guard 2026-08-24,
// ver ese archivo). Este test SI necesita un cliente truthy para poder
// mockear su metodo from() por tabla, asi que se inyecta un doble en el
// cache del modulo antes de cargar visitas.js — mismo patron que
// test/colegas-data.test.js y test/directorio.test.js usan para forzar null.
const supabasePath = require.resolve("../src/data/supabase");
delete require.cache[supabasePath];
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: { from: () => { throw new Error("from() sin mockear en este test"); } },
};

const visitas = require("../src/data/visitas");
const supabase = require("../src/data/supabase");

const ORG = "org-1";

function chain(resultado) {
  const c = {
    select: () => c, eq: () => c, not: () => c, gte: () => c, in: () => c,
    insert: () => c, maybeSingle: () => Promise.resolve(resultado),
    then: (resolve) => resolve(resultado),
  };
  return c;
}

function mockPorTabla(t, tablas) {
  t.mock.method(supabase, "from", (nombre) => chain(tablas[nombre] || { data: [], error: null }));
}

test("una cita de cliente directo (leads.cita) SI entra si tiene ref y fecha reciente", async (t) => {
  mockPorTabla(t, {
    leads: {
      data: [{ id: "l1", nombre: "Maria", phone: "573001112222", property_ref_origen: "AP001", cita: { fecha_hora: new Date().toISOString(), tipo: "visita" } }],
      error: null,
    },
    linea_dm: { data: [], error: null },
  });

  const r = await visitas.recientes(ORG, { dias: 30 });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].ref, "AP001");
  assert.strictEqual(r[0].origen, "cliente");
  assert.strictEqual(r[0].quien, "Maria");
});

test("una cita de cliente SIN ref de propiedad no se puede cruzar y se descarta", async (t) => {
  // El .not("property_ref_origen", "is", null) de la consulta real ya la
  // excluye del lado de la base — el mock simula ese filtro devolviendo la
  // lista vacia, igual que haria Supabase.
  mockPorTabla(t, { leads: { data: [], error: null }, linea_dm: { data: [], error: null } });
  const r = await visitas.recientes(ORG, { dias: 30 });
  assert.strictEqual(r.length, 0);
});

test("un avance de colega resuelve el ref via el pedido de grupo que publico", async (t) => {
  const ahora = new Date().toISOString();
  t.mock.method(supabase, "from", (nombre) => {
    if (nombre === "leads") return chain({ data: [], error: null });
    if (nombre === "linea_dm") {
      return chain({
        data: [{ id: "dm1", remitente_nombre: "Felipe", remitente_telefono: "573001112222", senal_id: "sig-1", cita_fecha_hora_iso: ahora, created_at: ahora }],
        error: null,
      });
    }
    if (nombre === "group_signals") {
      return chain({ data: [{ id: "sig-1", matches: [{ ref: "9100417" }, { ref: "9999999" }] }], error: null });
    }
    return chain({ data: [], error: null });
  });

  const r = await visitas.recientes(ORG, { dias: 30 });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].ref, "9100417", "usa el PRIMER match del pedido, el de mejor puntaje");
  assert.strictEqual(r[0].origen, "colega");
  assert.strictEqual(r[0].quien, "Felipe");
});

test("un avance de colega sin senal_id resuelta (sin match de ref) se descarta", async (t) => {
  mockPorTabla(t, {
    leads: { data: [], error: null },
    linea_dm: { data: [{ id: "dm1", remitente_nombre: "Felipe", senal_id: null, cita_fecha_hora_iso: new Date().toISOString() }], error: null },
  });
  const r = await visitas.recientes(ORG, { dias: 30 });
  assert.strictEqual(r.length, 0);
});

test("yaAlertada distingue si el ref ya tiene aviso registrado", async (t) => {
  mockPorTabla(t, { visita_venta_alertas: { data: { id: "a1" }, error: null } });
  assert.strictEqual(await visitas.yaAlertada(ORG, "AP001"), true);
});

test("yaAlertada sin registro devuelve false", async (t) => {
  mockPorTabla(t, { visita_venta_alertas: { data: null, error: null } });
  assert.strictEqual(await visitas.yaAlertada(ORG, "AP001"), false);
});

test("yaAlertada se degrada a false si la tabla no existe (migracion pendiente)", async (t) => {
  mockPorTabla(t, { visita_venta_alertas: { data: null, error: { code: "42P01" } } });
  assert.strictEqual(await visitas.yaAlertada(ORG, "AP001"), false);
});

test("marcarAlertada trata el choque de indice unico (23505) como exito, no como fallo", async (t) => {
  mockPorTabla(t, { visita_venta_alertas: { data: null, error: { code: "23505" } } });
  assert.strictEqual(await visitas.marcarAlertada(ORG, "AP001"), true);
});
