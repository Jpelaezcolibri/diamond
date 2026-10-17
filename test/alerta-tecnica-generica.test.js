// alerta-saldo sabia mandar UNA alerta (Anthropic sin saldo). El vigilante
// del sync de Wasi (2026-10-17) necesita el mismo canal con otro texto.
const { test } = require("node:test");
const assert = require("node:assert");
const alertaSaldo = require("../src/lib/alerta-saldo");

test("enviarAlertaTecnica existe y sin ALERTA_TECNICA_TO no manda nada (queda en el log)", async () => {
  const prev = process.env.ALERTA_TECNICA_TO;
  delete process.env.ALERTA_TECNICA_TO;
  try {
    assert.strictEqual(typeof alertaSaldo.enviarAlertaTecnica, "function");
    assert.strictEqual(await alertaSaldo.enviarAlertaTecnica("Falló el sync de Wasi", "detalle"), false);
  } finally {
    if (prev !== undefined) process.env.ALERTA_TECNICA_TO = prev;
  }
});
