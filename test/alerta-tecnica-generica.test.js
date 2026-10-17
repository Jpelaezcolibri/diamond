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

// BUG (2026-10-17, prueba real con Juan): la expresion que junta espacios
// perdio la barra invertida y borraba las letras "s" ("la alerta tecnica de
// Diamond ya te llegan a e te numero").
test("enviarAlertaTecnica no le borra letras al texto", async () => {
  const prev = process.env.ALERTA_TECNICA_TO;
  delete process.env.ALERTA_TECNICA_TO;
  const errores = [];
  const original = console.error;
  console.error = (...a) => errores.push(a.join(" "));
  try {
    await alertaSaldo.enviarAlertaTecnica("Falló el sync de Wasi:   las   alertas", "seguimos sin saldo");
  } finally {
    console.error = original;
    if (prev !== undefined) process.env.ALERTA_TECNICA_TO = prev;
  }
  assert.ok(errores.some((e) => e.includes("Falló el sync de Wasi: las alertas seguimos sin saldo")), errores.join(" | "));
});
