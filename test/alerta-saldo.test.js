// 2026-09-25 -> 2026-10-07: la cuenta de Anthropic se quedo sin saldo y Sofi y
// el radar callaron 12 dias. Nadie se entero porque las alertas tecnicas iban
// a la linea de la asesora y ASESORA_SOLO_VISITAS las apaga.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const alerta = require("../src/lib/alerta-saldo");

const SALDO = Object.assign(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'), { status: 400 });
const TOPE = new Error("400 You have reached your specified API usage limits. You will regain access on 2026-10-01");
const OTRO = new Error("529 overloaded");

let enviados;
const enviar = async (texto) => { enviados.push(texto); return true; };
beforeEach(() => { enviados = []; alerta._reset(); });

test("reconoce saldo agotado y tope de gasto, y nada mas", () => {
  assert.strictEqual(alerta.esErrorDeSaldo(SALDO), true);
  assert.strictEqual(alerta.esErrorDeSaldo(TOPE), true);
  assert.strictEqual(alerta.esErrorDeSaldo(OTRO), false);
  assert.strictEqual(alerta.esErrorDeSaldo(null), false);
});

test("avisa una vez y no repite durante el enfriamiento", async () => {
  const t0 = new Date("2026-10-07T12:00:00Z");
  assert.strictEqual(await alerta.observarError(SALDO, { ahora: t0, enviar }), true);
  assert.strictEqual(await alerta.observarError(SALDO, { ahora: new Date(t0.getTime() + 60 * 60 * 1000), enviar }), false);
  assert.strictEqual(enviados.length, 1);
  assert.match(enviados[0], /sin saldo|tope de gasto/i);
  assert.match(enviados[0], /Sofi y el radar/);
});

test("pasado el enfriamiento (6 h) vuelve a avisar", async () => {
  const t0 = new Date("2026-10-07T12:00:00Z");
  await alerta.observarError(SALDO, { ahora: t0, enviar });
  await alerta.observarError(SALDO, { ahora: new Date(t0.getTime() + 6 * 60 * 60 * 1000 + 1), enviar });
  assert.strictEqual(enviados.length, 2);
});

test("un error que no es de saldo no avisa", async () => {
  assert.strictEqual(await alerta.observarError(OTRO, { enviar }), false);
  assert.strictEqual(enviados.length, 0);
});

test("el cliente compartido observa los errores y los vuelve a lanzar", async () => {
  const anthropic = require("../src/lib/anthropic");
  const vistos = [];
  const original = alerta.observarError;
  alerta.observarError = async (e) => { vistos.push(e); return true; };
  try {
    anthropic._setClientForTests({ messages: { create: async () => { throw SALDO; } } });
    await assert.rejects(() => anthropic.getClient().messages.create({}), /credit balance/);
    assert.strictEqual(vistos.length, 1);
  } finally {
    alerta.observarError = original;
    anthropic._setClientForTests(null);
  }
});
