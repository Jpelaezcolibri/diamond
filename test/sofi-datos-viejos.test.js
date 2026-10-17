// Caso real 2026-10-17 (+573245934862). El 2-sep el cliente pregunto "venta
// en Envigado hasta 400"; Sofi guardo presupuesto "hasta 400 millones". El
// 17-oct volvio con "Compra en poblado" y Sofi le contesto "no tengo en El
// Poblado con presupuesto hasta 400 millones": uso un dato de hace 45 dias
// como si se lo hubiera dicho hoy, sin preguntar. Ni los datos guardados ni
// el historial le llegaban con fecha.

const { test } = require("node:test");
const assert = require("node:assert");
const { diasDePausa } = require("../src/agent/pausa");
const { buildSystemPrompt } = require("../src/agent/prompts");

const ahora = new Date("2026-10-17T16:15:00Z");
const msg = (role, iso) => ({ role, content: "x", created_at: iso });

test("diasDePausa: una conversacion retomada despues de 45 dias", () => {
  const h = [msg("user", "2026-09-02T14:14:00Z"), msg("assistant", "2026-09-02T14:15:00Z"), msg("assistant", "2026-10-17T16:04:00Z"), msg("user", "2026-10-17T16:15:00Z")];
  assert.strictEqual(diasDePausa(h, ahora), 45);
});

test("diasDePausa: una conversacion continua no tiene pausa", () => {
  const h = [msg("user", "2026-10-16T14:00:00Z"), msg("assistant", "2026-10-16T14:01:00Z"), msg("user", "2026-10-17T16:15:00Z")];
  assert.strictEqual(diasDePausa(h, ahora), 0);
});

test("diasDePausa: sin fechas o sin historial no inventa pausa", () => {
  assert.strictEqual(diasDePausa([], ahora), 0);
  assert.strictEqual(diasDePausa([{ role: "user", content: "hola" }], ahora), 0);
});

const org = { id: "org-1", name: "Diamond" };
const lead = { presupuesto: "hasta 400 millones", zona_interes: "Envigado", intencion: "comprar" };
const textoDe = (bloques) => bloques.map((b) => b.text).join("\n");

test("con pausa larga, los datos guardados llegan marcados como de antes y para confirmar", () => {
  const t = textoDe(buildSystemPrompt({ org, lead, qualified: false, pausaDias: 45 }));
  assert.match(t, /45 días/);
  assert.match(t, /hasta 400 millones/);
  assert.match(t, /confirm/i);
  assert.doesNotMatch(t, /DATOS QUE YA CONOCES DEL CLIENTE:/);
});

test("sin pausa, los datos siguen llegando como siempre", () => {
  const t = textoDe(buildSystemPrompt({ org, lead, qualified: false }));
  assert.match(t, /DATOS QUE YA CONOCES DEL CLIENTE:/);
  assert.doesNotMatch(t, /conversación anterior/i);
});

// Juan, 2026-10-17: "necesito que todos los mensajes que tengan mas de 7
// dias no se tome el historial".
const { historialVigente } = require("../src/agent/pausa");

test("historialVigente deja afuera los mensajes de mas de 7 dias", () => {
  const h = [msg("user", "2026-09-02T14:14:00Z"), msg("assistant", "2026-09-02T14:15:00Z"), msg("user", "2026-10-16T10:00:00Z"), msg("user", "2026-10-17T16:15:00Z")];
  const v = historialVigente(h, ahora);
  assert.deepStrictEqual(v.map((m) => m.created_at), ["2026-10-16T10:00:00Z", "2026-10-17T16:15:00Z"]);
});

test("si lo vigente arranca con un mensaje de Sofi, se antepone una nota de usuario (la API exige empezar por el usuario)", () => {
  const h = [msg("user", "2026-09-02T14:14:00Z"), msg("assistant", "2026-10-17T16:04:00Z"), msg("user", "2026-10-17T16:15:00Z")];
  const v = historialVigente(h, ahora);
  assert.strictEqual(v[0].role, "user");
  assert.match(v[0].content, /más de 7 días/);
  assert.strictEqual(v[1].role, "assistant");
  assert.strictEqual(v.length, 3);
});

test("sin fechas (memoria en tests) no corta nada", () => {
  const h = [{ role: "user", content: "hola" }, { role: "assistant", content: "hola" }];
  assert.deepStrictEqual(historialVigente(h, ahora), h);
});
