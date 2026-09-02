// Una sesion que YA estaba activa no se degrada sola.
//
// CASO REAL (2026-09-02): una llamada al endpoint de crear/vincular sobre la
// sesion que ya estaba trabajando dejo la fila en "pendiente". Nada fallo y
// nadie se entero, pero esa columna decide dos cosas: vivo.js#aprobarManual
// devuelve `sesion_ambigua` si ninguna esta activa (el CRM deja de poder
// publicar un pedido aprobado a mano) y el calentamiento del directorio deja
// de encontrar sesion, asi que el DM automatico se queda sin telefonos.
//
// El default de `estado` en upsertSession era "pendiente", asi que CUALQUIER
// llamada que no lo mandara la degradaba. Ahora es null y significa "no lo
// toques".

const { test } = require("node:test");
const assert = require("node:assert");

// Fuerza el store en memoria ANTES de cargar el modulo: esta maquina tiene un
// .env con credenciales reales de Supabase, y sin este mock el test escribiria
// en la base que comparten las 4 apps (mismo blindaje que directorio.test.js).
const supabasePath = require.resolve("../src/data/supabase");
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: null };

const memoria = require("../src/data/memory");
const grupos = require("../src/data/whatsapp-groups");

const ORG = "org-sesion-test";

test("una fila NUEVA arranca en pendiente", async () => {
  memoria.whatsappSessions.length = 0;
  const creada = await grupos.upsertSession(ORG, { nombre: "RADA-X" });
  assert.strictEqual(creada.estado, "pendiente");
});

test("vincular otra vez una sesion activa NO la degrada", async () => {
  memoria.whatsappSessions.length = 0;
  await grupos.upsertSession(ORG, { nombre: "RADA-X" });
  await grupos.upsertSession(ORG, { nombre: "RADA-X", estado: "activa" });

  // Esto es exactamente lo que hace el endpoint de crear/vincular: no manda
  // estado. Antes dejaba la fila en "pendiente".
  const tras = await grupos.upsertSession(ORG, { nombre: "RADA-X", rol: "dedicada" });
  assert.strictEqual(tras.estado, "activa");
});

test("bajarla sigue siendo posible, pero hay que pedirlo", async () => {
  memoria.whatsappSessions.length = 0;
  await grupos.upsertSession(ORG, { nombre: "RADA-X", estado: "activa" });
  const bajada = await grupos.upsertSession(ORG, { nombre: "RADA-X", estado: "pendiente" });
  assert.strictEqual(bajada.estado, "pendiente");
  memoria.whatsappSessions.length = 0;
});
