const { test } = require("node:test");
const assert = require("node:assert");
const organizations = require("../src/data/organizations");
const canalWhatsapp = require("../src/channels/whatsapp");
const {
  notificarFalloComando, textoSinConfirmar, textoFallo,
} = require("../src/agent/notificar-fallo-comando");

test("textoSinConfirmar: arma un mensaje claro con quien, que pidio y que contesto Sofi", () => {
  const texto = textoSinConfirmar({
    userName: "Juan",
    textoUsuario: "guardalas como mandatos de compra",
    reply: "Guardado ✅ MANDATO DE COMPRA #1",
  });
  assert.match(texto, /posible acci[oó]n no confirmada/i);
  assert.match(texto, /Juan/);
  assert.match(texto, /guardalas como mandatos de compra/);
  assert.match(texto, /Guardado ✅/);
});

test("textoSinConfirmar: recorta textos muy largos, no manda el chat completo", () => {
  const texto = textoSinConfirmar({ userName: "Juan", textoUsuario: "x".repeat(500), reply: "y".repeat(500) });
  assert.ok(texto.length < 700, "el mensaje deberia quedar acotado, no crecer sin limite");
});

test("textoFallo: lista cada herramienta que fallo con su resultado", () => {
  const texto = textoFallo({
    userName: "Juan",
    fallos: [{ nombre: "registrar_mandato_compra", resultado: "No pude guardar el mandato — avisale a Juan." }],
  });
  assert.match(texto, /fallo real de herramienta/i);
  assert.match(texto, /registrar_mandato_compra/);
  assert.match(texto, /No pude guardar el mandato/);
});

test("notificarFalloComando: sin RADAR_WATCHDOG_TO configurado, no intenta mandar nada", async (t) => {
  delete process.env.RADAR_WATCHDOG_TO;
  let llamado = false;
  t.mock.method(canalWhatsapp, "sendWhatsApp", async () => { llamado = true; return { ok: true }; });

  await notificarFalloComando(
    { orgId: "org-1" },
    { userName: "Juan", textoUsuario: "x", reply: "y", auditoria: { sinConfirmar: true, fallos: [], notificar: true } }
  );

  assert.strictEqual(llamado, false);
});

test("notificarFalloComando: con destino configurado, manda el mensaje de 'sin confirmar'", async (t) => {
  process.env.RADAR_WATCHDOG_TO = "573001112233";
  t.mock.method(organizations, "findById", async () => ({ id: "org-1", name: "Diamond" }));
  const enviados = [];
  t.mock.method(canalWhatsapp, "sendWhatsApp", async (org, to, texto) => {
    enviados.push({ org, to, texto });
    return { ok: true, wamid: "wm-1" };
  });

  await notificarFalloComando(
    { orgId: "org-1" },
    { userName: "Juan", textoUsuario: "guardalos", reply: "Guardado ✅", auditoria: { sinConfirmar: true, fallos: [], notificar: true } }
  );

  assert.strictEqual(enviados.length, 1);
  assert.strictEqual(enviados[0].to, "573001112233");
  assert.match(enviados[0].texto, /posible acci[oó]n no confirmada/i);
  t.after(() => { delete process.env.RADAR_WATCHDOG_TO; });
});

test("notificarFalloComando: manda los DOS mensajes si hay sospecha Y fallos a la vez", async (t) => {
  process.env.RADAR_WATCHDOG_TO = "573001112233";
  t.mock.method(organizations, "findById", async () => ({ id: "org-1", name: "Diamond" }));
  const enviados = [];
  t.mock.method(canalWhatsapp, "sendWhatsApp", async (org, to, texto) => {
    enviados.push(texto);
    return { ok: true };
  });

  await notificarFalloComando(
    { orgId: "org-1" },
    {
      userName: "Juan", textoUsuario: "guardalos", reply: "Guardado ✅",
      auditoria: {
        sinConfirmar: true,
        fallos: [{ nombre: "registrar_mandato_compra", resultado: "No pude guardar el mandato." }],
        notificar: true,
      },
    }
  );

  assert.strictEqual(enviados.length, 2);
  t.after(() => { delete process.env.RADAR_WATCHDOG_TO; });
});

test("notificarFalloComando: sin org resuelta, no revienta -- solo no manda nada", async (t) => {
  process.env.RADAR_WATCHDOG_TO = "573001112233";
  t.mock.method(organizations, "findById", async () => null);
  let llamado = false;
  t.mock.method(canalWhatsapp, "sendWhatsApp", async () => { llamado = true; return { ok: true }; });

  await notificarFalloComando(
    { orgId: "org-inexistente" },
    { userName: "Juan", textoUsuario: "x", reply: "y", auditoria: { sinConfirmar: true, fallos: [], notificar: true } }
  );

  assert.strictEqual(llamado, false);
  t.after(() => { delete process.env.RADAR_WATCHDOG_TO; });
});
