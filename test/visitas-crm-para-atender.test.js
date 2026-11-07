// "Para atender" del CRM (caso Claudia, 2026-11-06): la tarjeta de la visita
// no tenia boton ni link al chat y mandaba a un "boton del WhatsApp" que ya
// no existe. Estas pruebas miran el fuente: el CRM no se ejecuta en la suite.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const leer = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

test("la tarjeta de visita en Para atender tiene Confirmar / Otro horario y link al chat", () => {
  const page = leer("crm", "app", "(dashboard)", "pendientes", "page.tsx");
  assert.match(page, /AccionesCita/);
  assert.match(page, /\/inbox\/\$\{/, "link al chat de la conversacion");
  assert.doesNotMatch(page, /botón del WhatsApp/);
});

test("el chat y Para atender comparten el mismo componente de acciones", () => {
  const chat = leer("crm", "components", "chat-atencion.tsx");
  assert.match(chat, /AccionesCita/);
  const comp = leer("crm", "components", "acciones-cita.tsx");
  assert.match(comp, /\/api\/citas\/accion/);
  assert.match(comp, /accion\("confirmar"\)/);
  assert.match(comp, /accion\("otro"\)/);
});

test("el motor le pasa a Sofi las visitas pendientes del asesor y el coordinador real", () => {
  const engine = leer("src", "agent", "engine.js");
  assert.match(engine, /citasPendientesDeConfirmar\(org\.id, advisor\)/);
  assert.match(engine, /citasPendientes,/);
  assert.match(engine, /resolverCoordinador\(/);
});
