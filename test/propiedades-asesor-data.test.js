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
  const sb = falso([{ data: [], error: null }, { data: [{ ref: "D1003" }], error: null }, { data: { id: "p1", ref: "D1004" }, error: null }]);
  t.mock.method(datos, "_supabase", () => sb);
  const org = { id: "org-1", landing_base_url: "https://diamondinmobiliaria.com" };
  const fila = { titulo: "Apartamento amoblado en arriendo en Laureles", zona: "Laureles" };
  const r = await datos.crear(org, { id: "adv-1" }, fila, ["https://x.supabase.co/a.jpg"]);
  assert.strictEqual(r.ref, "D1004");
  const insert = sb.llamadas[2].ops.find(([op]) => op === "insert")[1];
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
  const sb = falso([{ data: [], error: null }, { data: [], error: null }, { data: null, error: { code: "PGRST204", message: "Could not find the 'origen' column of 'properties'" } }]);
  t.mock.method(datos, "_supabase", () => sb);
  await assert.rejects(datos.crear({ id: "o" }, { id: "a" }, { titulo: "x" }, ["f"]), (e) => e.code === "SIN_MIGRACION");
});

test("crear: si la ref choca (23505) reintenta con la siguiente", async (t) => {
  const sb = falso([
    { data: [], error: null },
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

const tiene = (q, ...args) => q.ops.some((o) => o.length === args.length + 1 && args.every((a, i) => o[i + 1] === a));

test("aplicarVigencia: la busqueda va acotada a org, origen, captador y ref en mayusculas; parches exactos", async () => {
  let sb = falso([{ data: { id: "p1", ref: "D1004" }, error: null }, { data: null, error: null }]);
  datos._supabase = () => sb;
  try {
    await datos.aplicarVigencia("org-1", "adv-1", "d1004", true);
    const [busca, upd] = sb.llamadas;
    for (const f of [["org_id", "org-1"], ["origen", "asesor"], ["captador_id", "adv-1"], ["ref", "D1004"]]) {
      assert.ok(tiene(busca, "eq", ...f) || busca.ops.some((o) => o[0] === "eq" && o[1] === f[0] && o[2] === f[1]), `eq ${f[0]}`);
    }
    const patch = upd.ops.find(([op]) => op === "update")[1];
    assert.strictEqual(patch.disponible, true);
    assert.strictEqual(patch.vigencia_preguntada_at, null);
    const dias = (new Date(patch.vence_at) - Date.now()) / 86400000;
    assert.ok(dias > 29.9 && dias <= 30);
    assert.ok(upd.ops.some((o) => o[0] === "eq" && o[1] === "id" && o[2] === "p1"));

    sb = falso([{ data: { id: "p1", ref: "D1004" }, error: null }, { data: null, error: null }]);
    await datos.aplicarVigencia("org-1", "adv-1", "D1004", false);
    const upd2 = sb.llamadas[1];
    assert.deepStrictEqual(upd2.ops.find(([op]) => op === "update")[1], { disponible: false });
    assert.ok(upd2.ops.some((o) => o[0] === "eq" && o[1] === "id" && o[2] === "p1"));
  } finally {
    delete datos._supabase;
    datos._supabase = () => require("../src/data/supabase");
  }
});

test("fotosRecientes: solo imagenes en orden, tope 10, filtra conversacion y rol", async (t) => {
  const filas = [
    { media_url: "a.jpg", media_mime: "image/jpeg" }, { media_url: "b.ogg", media_mime: "audio/ogg" },
    { media_url: "c.png", media_mime: "image/png" }, { media_url: "d", media_mime: null },
  ];
  let sb = falso([{ data: filas, error: null }]);
  t.mock.method(datos, "_supabase", () => sb);
  assert.deepStrictEqual(await datos.fotosRecientes("conv-1"), ["a.jpg", "c.png"]);
  const q = sb.llamadas[0];
  assert.ok(q.ops.some((o) => o[0] === "eq" && o[1] === "conversation_id" && o[2] === "conv-1"));
  assert.ok(q.ops.some((o) => o[0] === "eq" && o[1] === "role" && o[2] === "user"));
  const doce = Array.from({ length: 12 }, (_, i) => ({ media_url: `f${i}.jpg`, media_mime: "image/jpeg" }));
  sb = falso([{ data: doce, error: null }]);
  const r = await datos.fotosRecientes("conv-1");
  assert.strictEqual(r.length, 10);
  // Se quedan las 10 MAS NUEVAS (cambio de la revision final).
  assert.strictEqual(r[0], "f2.jpg");
  assert.strictEqual(r[9], "f11.jpg");
});

test("porPreguntar y vencidas: filtros de org, origen y disponibilidad", async (t) => {
  const ahora = new Date("2026-10-19T12:00:00Z");
  let sb = falso([{ data: [], error: null }]);
  t.mock.method(datos, "_supabase", () => sb);
  await datos.porPreguntar("org-1", ahora);
  let ops = sb.llamadas[0].ops;
  const has = (...a) => ops.some((o) => a.every((x, i) => o[i] === x));
  assert.ok(has("eq", "org_id", "org-1") && has("eq", "origen", "asesor") && has("eq", "disponible", true));
  assert.ok(has("is", "vigencia_preguntada_at", null));
  assert.ok(has("lte", "vence_at", new Date(ahora.getTime() + 5 * 86400000).toISOString()));
  sb = falso([{ data: [], error: null }]);
  await datos.vencidas("org-1", ahora);
  ops = sb.llamadas[0].ops;
  assert.ok(has("eq", "org_id", "org-1") && has("eq", "origen", "asesor") && has("eq", "disponible", true));
  assert.ok(has("lte", "vence_at", ahora.toISOString()));
});

test("fotosRecientes: la ventana empieza en el maximo entre las horas y `desde`", async (t) => {
  const sb = falso([{ data: [], error: null }, { data: [], error: null }]);
  t.mock.method(datos, "_supabase", () => sb);
  const reciente = new Date(Date.now() - 3600e3).toISOString();
  await datos.fotosRecientes("c", { desde: reciente });
  const gte = (q) => q.ops.find((o) => o[0] === "gte" && o[1] === "created_at")[2];
  assert.strictEqual(gte(sb.llamadas[0]), reciente);
  await datos.fotosRecientes("c", { desde: new Date(Date.now() - 30 * 3600e3).toISOString() });
  assert.ok(new Date(gte(sb.llamadas[1])) > new Date(Date.now() - 7 * 3600e3));
});

test("ultimaCreadaPor: created_at de la ultima del captador; error o vacio es null", async (t) => {
  let sb = falso([{ data: [{ created_at: "2026-10-19T10:00:00Z" }], error: null }]);
  t.mock.method(datos, "_supabase", () => sb);
  assert.strictEqual(await datos.ultimaCreadaPor("org-1", "adv-1"), "2026-10-19T10:00:00Z");
  const ops = sb.llamadas[0].ops;
  assert.ok(ops.some((o) => o[0] === "eq" && o[1] === "org_id" && o[2] === "org-1"));
  assert.ok(ops.some((o) => o[0] === "eq" && o[1] === "origen" && o[2] === "asesor"));
  assert.ok(ops.some((o) => o[0] === "eq" && o[1] === "captador_id" && o[2] === "adv-1"));
  sb = falso([{ data: null, error: { message: "boom" } }]);
  assert.strictEqual(await datos.ultimaCreadaPor("org-1", "adv-1"), null);
  sb = falso([{ data: [], error: null }]);
  assert.strictEqual(await datos.ultimaCreadaPor("org-1", "adv-1"), null);
});

test("crear: una confirmacion repetida devuelve la misma propiedad sin insertar", async (t) => {
  const sb = falso([{ data: [{ id: "p1", ref: "D1004", link: "l" }], error: null }]);
  t.mock.method(datos, "_supabase", () => sb);
  const r = await datos.crear({ id: "org-1" }, { id: "adv-1" }, { titulo: "x" }, ["a.jpg", "b.jpg"]);
  assert.strictEqual(r.ref, "D1004");
  assert.strictEqual(r.ya_existia, true);
  assert.strictEqual(sb.llamadas.length, 1);
  const ops = sb.llamadas[0].ops;
  assert.ok(ops.some((o) => o[0] === "contains" && o[1] === "images" && JSON.stringify(o[2]) === '["a.jpg"]'));
  assert.ok(ops.some((o) => o[0] === "eq" && o[1] === "captador_id" && o[2] === "adv-1"));
  assert.ok(ops.some((o) => o[0] === "gte" && o[1] === "created_at"));
});
