// El informe de arranque (Juan, 2026-09-02, hallazgo #4): quien es quien,
// dicho una vez por despliegue, para que una variable vacia en Railway no
// apague una funcion sin que nadie se entere.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const RUTA = (m) => require.resolve(path.join("..", "src", m));

let revisora, equipo, enviados;

function instalar() {
  require.cache[RUTA("data/organizations.js")] = {
    exports: {
      getDefault: async () => ({ id: "org-1", name: "Diamond", radar_activo: true, grupos_respuesta_modo: "asistido", mandatos_activos: false }),
      radarEncendido: (o) => o.radar_activo !== false,
      modoDeRespuesta: (o) => o.grupos_respuesta_modo || "asistido",
      mandatosActivos: (o) => o.mandatos_activos !== false,
    },
  };
  require.cache[RUTA("data/advisors.js")] = {
    exports: {
      findAsesorPrincipalRadar: async () => revisora,
      listElegibles: async () => equipo,
    },
  };
  require.cache[RUTA("channels/whatsapp.js")] = {
    exports: { sendWhatsApp: async (org, to, texto) => { enviados.push({ to, texto }); return { ok: true }; } },
  };
  delete require.cache[RUTA("lib/arranque.js")];
  return require("../src/lib/arranque");
}

beforeEach(() => {
  revisora = { id: "nat", name: "Natalia Velez", phone: "573001878024" };
  equipo = [revisora, { id: "cat", name: "Catherine Uribe", phone: "573028536489" }];
  enviados = [];
  delete process.env.RADAR_ESCALADO_PHONE;
  delete process.env.RADAR_VISITAS_ALERTA_TO;
  delete process.env.RADAR_ALERTA_TO;
  process.env.RADAR_WATCHDOG_TO = "573016981200";
});

test("con todo configurado, dice quien es quien y no reporta faltantes", async () => {
  const arranque = instalar();
  const { texto, faltantes } = await arranque.informe({ id: "org-1", name: "Diamond", mandatos_activos: false });
  assert.deepStrictEqual(faltantes, []);
  assert.ok(texto.includes("Revisora: Natalia Velez"));
  assert.ok(texto.includes("Respaldo: Catherine Uribe"), "el respaldo sale de advisors, no de una env var");
  assert.ok(texto.includes("Vigilante: ***1200"));
  assert.ok(texto.includes("compra apagada"));
  assert.ok(!texto.includes("OJO"), "sin copias no hay advertencia");
});

test("sin revisora, sin respaldo y sin vigilante, lo dice con nombre", async () => {
  revisora = null;
  equipo = [];
  delete process.env.RADAR_WATCHDOG_TO;
  const arranque = instalar();
  const { texto, faltantes } = await arranque.informe({ id: "org-1" });
  assert.deepStrictEqual(faltantes, ["revisora del radar", "respaldo", "vigilante (RADAR_WATCHDOG_TO)"]);
  assert.ok(texto.includes("Sin configurar: revisora del radar, respaldo, vigilante"));
});

test("las copias (RADAR_ALERTA_TO) son lo unico que es peor si esta: se advierte", async () => {
  process.env.RADAR_ALERTA_TO = "573016981200";
  const arranque = instalar();
  const { texto } = await arranque.informe({ id: "org-1" });
  assert.ok(texto.includes("OJO: cada aviso se copia ademas a ***1200"));
});

test("anunciar lo manda al vigilante y nunca revienta", async () => {
  const arranque = instalar();
  await arranque.anunciar();
  assert.strictEqual(enviados.length, 1);
  assert.strictEqual(enviados[0].to, "573016981200");
  assert.ok(enviados[0].texto.startsWith("Sofi arranco"));
});
