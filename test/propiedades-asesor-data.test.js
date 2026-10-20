// test/propiedades-asesor-data.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const datos = require("../src/data/propiedades-asesor");

// Supabase falso y encadenable: graba la consulta y devuelve `respuesta`.
function falso(respuestas) {
  const llamadas = [];
  const cadena = (tabla) => {
    const q = { tabla, ops: [] };
    llamadas.push(q);
    const self = new Proxy({}, {
      get(_, op) {
        if (op === "then") {
          const r = respuestas.shift() || { data: null, error: null };
          return (ok) => Promise.resolve(r).then(ok);
        }
        return (...args) => { q.ops.push([op, ...args]); return self; };
      },
    });
    return self;
  };
  return { from: cadena, llamadas };
}

test("crear: ref D siguiente, link de la landing, captador y vigencia", async (t) => {
  const sb = falso([{ data: [{ ref: "D1003" }], error: null }, { data: { id: "p1", ref: "D1004" }, error: null }]);
  t.mock.method(datos, "_supabase", () => sb);
  const org = { id: "org-1", landing_base_url: "https://diamondinmobiliaria.com" };
  const fila = { titulo: "Apartamento amoblado en arriendo en Laureles", zona: "Laureles" };
  const r = await datos.crear(org, { id: "adv-1" }, fila, ["https://x.supabase.co/a.jpg"]);
  assert.strictEqual(r.ref, "D1004");
  const insert = sb.llamadas[1].ops.find(([op]) => op === "insert")[1];
  assert.strictEqual(insert.ref, "D1004");
  assert.strictEqual(insert.origen, "asesor");
  assert.strictEqual(insert.captador_id, "adv-1");
  assert.strictEqual(insert.disponible, true);
  assert.deepStrictEqual(insert.images, ["https://x.supabase.co/a.jpg"]);
  assert.strictEqual(insert.link, "https://diamondinmobiliaria.com/propiedades/apartamento-amoblado-en-arriendo-en-laureles-d1004");
  const dias = (new Date(insert.vence_at) - Date.now()) / 86400000;
  assert.ok(dias > 29.9 && dias <= 30);
});

test("crear: sin la migracion avisa con SIN_MIGRACION", async (t) => {
  const sb = falso([{ data: [], error: null }, { data: null, error: { code: "PGRST204", message: "Could not find the 'origen' column of 'properties'" } }]);
  t.mock.method(datos, "_supabase", () => sb);
  await assert.rejects(datos.crear({ id: "o" }, { id: "a" }, { titulo: "x" }, ["f"]), (e) => e.code === "SIN_MIGRACION");
});

test("crear: si la ref choca (23505) reintenta con la siguiente", async (t) => {
  const sb = falso([
    { data: [{ ref: "D1001" }], error: null }, { data: null, error: { code: "23505", message: "duplicate" } },
    { data: [{ ref: "D1001" }, { ref: "D1002" }], error: null }, { data: { id: "p", ref: "D1003" }, error: null },
  ]);
  t.mock.method(datos, "_supabase", () => sb);
  const r = await datos.crear({ id: "o" }, { id: "a" }, { titulo: "x" }, ["f"]);
  assert.strictEqual(r.ref, "D1003");
});

test("aplicarVigencia: renueva, da de baja o no la encuentra", async (t) => {
  t.mock.method(datos, "_supabase", () => falso([{ data: { id: "p1", ref: "D1004" }, error: null }, { data: null, error: null }]));
  assert.deepStrictEqual(await datos.aplicarVigencia("o", "a", "d1004", true), { estado: "renovada", ref: "D1004" });
  t.mock.method(datos, "_supabase", () => falso([{ data: { id: "p1", ref: "D1004" }, error: null }, { data: null, error: null }]));
  assert.deepStrictEqual(await datos.aplicarVigencia("o", "a", "D1004", false), { estado: "baja", ref: "D1004" });
  t.mock.method(datos, "_supabase", () => falso([{ data: null, error: null }]));
  assert.deepStrictEqual(await datos.aplicarVigencia("o", "a", "D9999", true), { estado: "no_encontrada", ref: "D9999" });
});
