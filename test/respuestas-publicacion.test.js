// test/respuestas-publicacion.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const datos = require("../src/data/respuestas-publicacion");
const rp = require("../src/groups/respuestas-publicacion");

const ORG = { id: "org-1" };
const POST = { id: "pub-1", property_ref: "10505566", group_id: "g-1", created_at: "2026-10-20T20:16:00Z" };

test("refDeTexto encuentra una ref de Wasi o de asesor", () => {
  assert.strictEqual(rp.refDeTexto("Hola, el de la ref 10505566 sigue?"), "10505566");
  assert.strictEqual(rp.refDeTexto("me interesa la D1004"), "D1004");
  assert.strictEqual(rp.refDeTexto("tel 3001234567"), null); // un celular no es ref
  assert.strictEqual(rp.refDeTexto("hola"), null);
});

test("linea: ref explicita publicada -> registra via linea", async (t) => {
  t.mock.method(datos, "postReciente", async () => POST);
  const reg = t.mock.method(datos, "registrar", async () => ({ id: "r-1", nueva: true }));
  const r = await rp.deLinea(ORG, { texto: "¿la 10505566 tiene parqueadero?", senalId: null, identidad: { lid: "1@lid", telefono: null }, nombre: "Laura" });
  assert.deepStrictEqual(r, { id: "r-1", nueva: true, ref: "10505566", via: "linea" });
  const a = reg.mock.calls[0].arguments[1];
  assert.strictEqual(a.via, "linea");
  assert.strictEqual(a.publicacionId, "pub-1");
  assert.strictEqual(a.lid, "1@lid");
});

test("linea: sin ref, colega en un grupo con post en 48 h y sin pedido ligado -> el post mas reciente", async (t) => {
  t.mock.method(datos, "colegaGrupos", async () => ["ARRIENDOS 7AM 8PM"]);
  t.mock.method(datos, "postsEnGrupos", async () => [POST]);
  t.mock.method(datos, "registrar", async () => ({ id: "r-2", nueva: true }));
  const r = await rp.deLinea(ORG, { texto: "buenas, ¿sigue disponible?", senalId: null, identidad: { lid: "1@lid" }, nombre: null });
  assert.strictEqual(r.ref, "10505566");
});

test("linea: un mensaje ligado a un pedido del radar no se atribuye por grupo", async (t) => {
  const grupos = t.mock.method(datos, "colegaGrupos", async () => ["X"]);
  const r = await rp.deLinea(ORG, { texto: "gracias", senalId: "sig-1", identidad: { lid: "1@lid" } });
  assert.strictEqual(r, null);
  assert.strictEqual(grupos.mock.callCount(), 0);
});

test("sofi: 'vi en un grupo la Ref' publicada -> via sofi atendida", async (t) => {
  t.mock.method(datos, "postReciente", async () => POST);
  const reg = t.mock.method(datos, "registrar", async () => ({ id: "r-3", nueva: true }));
  const r = await rp.deSofi(ORG, { texto: "Hola, vi en un grupo la Ref 10505566", telefono: "573001112222", nombre: "Ana", leadId: "lead-1" });
  assert.strictEqual(r.via, "sofi");
  assert.strictEqual(reg.mock.calls[0].arguments[1].atendida, true);
  assert.strictEqual(reg.mock.calls[0].arguments[1].leadId, "lead-1");
});

test("sofi: ref no publicada en 7 dias -> nada", async (t) => {
  t.mock.method(datos, "postReciente", async () => null);
  assert.strictEqual(await rp.deSofi(ORG, { texto: "vi en un grupo la Ref 9999999", telefono: "57300" }), null);
});

test("grupo: cita a nuestro post -> via grupo", async (t) => {
  t.mock.method(datos, "postPorWamid", async (o, w) => (w === "3EB0WAMID" ? POST : null));
  const reg = t.mock.method(datos, "registrar", async () => ({ id: "r-4", nueva: true }));
  const r = await rp.deGrupo(ORG, { replyToId: "3EB0WAMID", autorId: "9@lid", nombre: "Pedro", texto: "info al privado" });
  assert.strictEqual(r.via, "grupo");
  assert.strictEqual(reg.mock.calls[0].arguments[1].lid, "9@lid");
  assert.strictEqual(await rp.deGrupo(ORG, { replyToId: null, autorId: "9@lid", texto: "x" }), null);
});

test("atendidaPorLinea marca las abiertas del colega", async (t) => {
  const m = t.mock.method(datos, "marcarAtendidas", async () => 2);
  assert.strictEqual(await rp.atendidaPorLinea(ORG, { lid: "1@lid" }), 2);
  assert.deepStrictEqual(m.mock.calls[0].arguments, ["org-1", { lid: "1@lid" }, "linea"]);
});

// ---- Capa de datos con Supabase falso (patron de propiedades-asesor-data) ----
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
const op = (q, nombre) => q.ops.find(([o]) => o === nombre);

test("datos.registrar: fila nueva inserta con colega_clave y atendida", async (t) => {
  const sb = falso([{ data: null, error: null }, { data: { id: "n1" }, error: null }]);
  t.mock.method(datos, "_supabase", () => sb);
  const r = await datos.registrar("org-1", { ref: 10505566, publicacionId: "p", groupId: "g", via: "sofi", telefono: "573001112222", texto: "hola", atendida: true });
  assert.deepStrictEqual(r, { id: "n1", nueva: true });
  const fila = op(sb.llamadas[1], "insert")[1];
  assert.strictEqual(fila.colega_clave, "573001112222");
  assert.strictEqual(fila.property_ref, "10505566");
  assert.strictEqual(fila.atendida_por, "sofi");
  assert.ok(fila.atendida_at);
});

test("datos.registrar: fila existente suma un mensaje y no inserta", async (t) => {
  const sb = falso([{ data: { id: "e1", mensajes: 2 }, error: null }, { data: null, error: null }]);
  t.mock.method(datos, "_supabase", () => sb);
  const r = await datos.registrar("org-1", { ref: "D1004", via: "linea", lid: "1@lid", leadId: "lead-9" });
  assert.deepStrictEqual(r, { id: "e1", nueva: false });
  assert.strictEqual(sb.llamadas.length, 2);
  const patch = op(sb.llamadas[1], "update")[1];
  assert.strictEqual(patch.mensajes, 3);
  assert.strictEqual(patch.lead_id, "lead-9");
  assert.ok(!op(sb.llamadas[1], "insert"));
});

test("datos.marcarAtendidas: solo abiertas del colega, devuelve cuantas", async (t) => {
  const sb = falso([{ data: [{ id: 1 }, { id: 2 }], error: null }]);
  t.mock.method(datos, "_supabase", () => sb);
  assert.strictEqual(await datos.marcarAtendidas("org-1", { lid: "1@lid" }, "linea"), 2);
  const q = sb.llamadas[0];
  assert.strictEqual(op(q, "update")[1].atendida_por, "linea");
  assert.deepStrictEqual(op(q, "is"), ["is", "atendida_at", null]);
  assert.ok(q.ops.some(([o, c, v]) => o === "eq" && c === "colega_clave" && v === "1@lid"));
  assert.strictEqual(await datos.marcarAtendidas("org-1", {}, "linea"), 0);
});

test("datos.marcarPuente: solo filas con puente_at nulo del colega", async (t) => {
  const sb = falso([{ data: [{ id: 1 }], error: null }]);
  t.mock.method(datos, "_supabase", () => sb);
  assert.strictEqual(await datos.marcarPuente("org-1", { telefono: "573001112222" }), 1);
  const q = sb.llamadas[0];
  assert.ok(op(q, "update")[1].puente_at);
  assert.deepStrictEqual(op(q, "is"), ["is", "puente_at", null]);
  assert.ok(q.ops.some(([o, c, v]) => o === "eq" && c === "colega_clave" && v === "573001112222"));
  assert.strictEqual(await datos.marcarPuente("org-1", {}), 0);
});

test("datos.colegaGrupos: el lid se busca sin sufijo (colegas_grupos lo guarda en digitos)", async (t) => {
  const sb = falso([{ data: [{ grupos: ["ARRIENDOS 7AM 8PM"] }], error: null }]);
  t.mock.method(datos, "_supabase", () => sb);
  assert.deepStrictEqual(await datos.colegaGrupos("org-1", { lid: "123456789@lid" }), ["ARRIENDOS 7AM 8PM"]);
  assert.ok(sb.llamadas[0].ops.some(([o, c, v]) => o === "eq" && c === "lid" && v === "123456789"));
});
