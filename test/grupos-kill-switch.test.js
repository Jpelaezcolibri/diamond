// GROUPS_ENABLED tiene que apagar de verdad.
//
// El 2026-07-30 WhatsApp baneó la cuenta de la asesora cuya línea estaba
// vinculada. Al desconectar todo se descubrió que apagar GROUPS_ENABLED frenaba
// el webhook y el buffer, pero NO los endpoints: un clic en "Vincular línea"
// desde el CRM podía volver a parear el número mientras Meta revisaba la cuenta
// suspendida. Un interruptor que deja una puerta abierta no es un interruptor.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const fuente = fs.readFileSync(path.join(__dirname, "..", "src", "api", "crm.js"), "utf8");

// Todo lo que habla con WAHA — o sea, lo que puede tocar la línea de una
// persona real — va detrás del interruptor.
const TOCAN_WHATSAPP = [
  "/api/grupos/sesion",
  "/api/grupos/sesion/estado",
  "/api/grupos/sesion/revincular",
  "/api/grupos/importar",
];

for (const ruta of TOCAN_WHATSAPP) {
  test(`${ruta} exige que la escucha esté activa`, () => {
    assert.ok(
      fuente.includes(`router.post("${ruta}", requiereGruposActivos,`),
      `${ruta} puede tocar WhatsApp con la escucha apagada`
    );
  });
}

test("leer lo ya guardado NO exige la escucha activa", () => {
  // Marcar una señal como revisada o apagar un grupo no tocan la línea de
  // nadie: bloquearlos dejaría el CRM inservible sin ganar seguridad.
  for (const ruta of ["/api/grupos/senal/estado", "/api/grupos/metricas"]) {
    assert.ok(
      !fuente.includes(`router.post("${ruta}", requiereGruposActivos,`),
      `${ruta} no debería estar bloqueada`
    );
  }
});

test("el guard existe, devuelve 423 y explica por qué", () => {
  assert.match(fuente, /function requiereGruposActivos/);
  assert.match(fuente, /res\.status\(423\)/);
  assert.match(fuente, /GROUPS_ENABLED=false/);
});
