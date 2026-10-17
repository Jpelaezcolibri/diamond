// Alerta tecnica cuando falla el sync de Wasi (Juan, 2026-10-17: "si, solo a
// mi numero"). El 16-oct la cuenta de Wasi estaba suspendida por falta de
// pago, el sync apago las 105 propiedades y nadie se entero hasta el dia
// siguiente. Ahora una corrida fallida le llega a ALERTA_TECNICA_TO (Juan),
// nunca a las asesoras, una sola vez por corrida.

const { test } = require("node:test");
const assert = require("node:assert");
const alerta = require("../src/scheduler/alerta-sync");

function deps(corrida) {
  const enviados = [];
  return {
    enviados,
    d: {
      ultimaCorrida: async () => corrida,
      enviar: async (resumen, detalle) => { enviados.push({ resumen, detalle }); return true; },
    },
  };
}

const fallida = { id: "run-1", status: "failed", started_at: new Date().toISOString(), error: "Wasi rechazo la consulta a /property/search: id_company or wasi_token is wrong." };

test("una corrida fallida avisa con el error de Wasi", async () => {
  alerta._reset();
  const { d, enviados } = deps(fallida);
  await alerta.runOnce({ deps: d });
  assert.strictEqual(enviados.length, 1);
  assert.match(enviados[0].resumen, /Wasi/);
  assert.match(enviados[0].detalle, /id_company or wasi_token is wrong/);
});

test("la misma corrida no se avisa dos veces", async () => {
  alerta._reset();
  const { d, enviados } = deps(fallida);
  await alerta.runOnce({ deps: d });
  await alerta.runOnce({ deps: d });
  assert.strictEqual(enviados.length, 1);
});

test("una corrida exitosa no avisa", async () => {
  alerta._reset();
  const { d, enviados } = deps({ ...fallida, status: "success", error: null });
  await alerta.runOnce({ deps: d });
  assert.strictEqual(enviados.length, 0);
});

test("una falla vieja (de hace mas de 2 dias) no se avisa al arrancar", async () => {
  alerta._reset();
  const { d, enviados } = deps({ ...fallida, started_at: new Date(Date.now() - 3 * 864e5).toISOString() });
  await alerta.runOnce({ deps: d });
  assert.strictEqual(enviados.length, 0);
});

test("una corrida 'exitosa' que retiro mas de la mitad del inventario tambien avisa", async () => {
  alerta._reset();
  const { d, enviados } = deps({ id: "run-2", status: "success", started_at: new Date().toISOString(), stats: { seen: 105, removed: 105 } });
  await alerta.runOnce({ deps: d });
  assert.strictEqual(enviados.length, 1);
  assert.match(enviados[0].detalle, /105/);
});
