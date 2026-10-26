// POST /api/preguntas/responder y /descartar (spec 2026-10-25 §5.4).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const supabasePath = require.resolve("../src/data/supabase");
delete require.cache[supabasePath];
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: null };

const memory = require("../src/data/memory");
const organizations = require("../src/data/organizations");
const advisors = require("../src/data/advisors");
const pa = require("../src/lib/pregunta-asesor");
const router = require("../src/api/crm");

const ORG = { id: "org-1", name: "Diamond" };
function rutaDe(path) {
  const capa = router.stack.find((c) => c.route?.path === path && c.route.methods.post);
  assert.ok(capa, `No existe POST ${path}`);
  return capa.route.stack[capa.route.stack.length - 1].handle;
}
function respuestaFalsa() {
  const r = { codigo: 200, cuerpo: null };
  r.status = (c) => { r.codigo = c; return r; };
  r.json = (b) => { r.cuerpo = b; return r; };
  return r;
}
const llamar = async (path, body) => { const res = respuestaFalsa(); await rutaDe(path)({ body }, res); return res; };

let llamadas;
beforeEach(() => {
  llamadas = [];
  organizations.getDefault = async () => ORG;
  advisors.findByAuthUserId = async (_o, id) => (id === "u1" ? { id: "a1", name: "Daiana Zea", activo: true } : null);
  pa.responder = async (a) => { llamadas.push(["responder", a.preguntaId, a.respuesta, a.via]); return { ok: true, texto: "Listo: ya le pasé la respuesta." }; };
  pa.descartar = async (a) => { llamadas.push(["descartar", a.preguntaId, a.por]); return { ok: true }; };
});

test("responder: faltan datos 400, sin asesor 403, ok pasa por el bot", async () => {
  assert.strictEqual((await llamar("/api/preguntas/responder", { preguntaId: "p1" })).codigo, 400);
  assert.strictEqual((await llamar("/api/preguntas/responder", { preguntaId: "p1", respuesta: "450", authUserId: "zz" })).codigo, 403);
  const ok = await llamar("/api/preguntas/responder", { preguntaId: "p1", respuesta: "450", authUserId: "u1" });
  assert.strictEqual(ok.codigo, 200);
  assert.deepStrictEqual(llamadas[0], ["responder", "p1", "450", "crm"]);
});

test("responder: el código de error del módulo llega al CRM", async () => {
  pa.responder = async () => ({ ok: false, codigo: 409, error: "Esa pregunta ya está cerrada." });
  const r = await llamar("/api/preguntas/responder", { preguntaId: "p1", respuesta: "450", authUserId: "u1" });
  assert.deepStrictEqual([r.codigo, r.cuerpo.error], [409, "Esa pregunta ya está cerrada."]);
});

test("descartar: lo puede hacer un admin sin fila de asesor", async () => {
  assert.strictEqual((await llamar("/api/preguntas/descartar", { preguntaId: "p1", authUserId: "zz" })).codigo, 403);
  const r = await llamar("/api/preguntas/descartar", { preguntaId: "p1", authUserId: "zz", esAdmin: true });
  assert.strictEqual(r.codigo, 200);
  assert.deepStrictEqual(llamadas[0], ["descartar", "p1", "admin"]);
});
