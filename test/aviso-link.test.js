// El token, el visto y la gestion del link del aviso (Juan, 2026-09-02,
// opcion D). Plan: docs/superpowers/plans/2026-09-03-radar-link-en-el-aviso.md
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const groupSignals = require("../src/data/group-signals");
const linkAviso = require("../src/lib/link-aviso");

const ORG = "org-1";
beforeEach(() => {
  memory.groupSignals.length = 0;
  memory.groupSignals.push({ id: "s1", org_id: ORG, clase: "demanda", matches: [] });
  delete process.env.CRM_PUBLIC_URL;
});

test("asegurarToken crea uno y despues devuelve el mismo", async () => {
  const a = await groupSignals.asegurarToken(ORG, "s1");
  const b = await groupSignals.asegurarToken(ORG, "s1");
  assert.ok(a && a.length >= 24);
  assert.strictEqual(a, b);
});

test("asegurarToken de una señal que no existe devuelve null", async () => {
  assert.strictEqual(await groupSignals.asegurarToken(ORG, "nadie"), null);
});

test("obtenerPorToken trae la señal con su org", async () => {
  const t = await groupSignals.asegurarToken(ORG, "s1");
  const s = await groupSignals.obtenerPorToken(t);
  assert.strictEqual(s.id, "s1");
  assert.strictEqual(s.org_id, ORG);
  assert.strictEqual(await groupSignals.obtenerPorToken("no-existe"), null);
  assert.strictEqual(await groupSignals.obtenerPorToken(""), null);
});

test("marcarVisto escribe solo la primera vez", async () => {
  assert.strictEqual(await groupSignals.marcarVisto(ORG, "s1"), true);
  const primera = memory.groupSignals[0].visto_at;
  assert.strictEqual(await groupSignals.marcarVisto(ORG, "s1"), false);
  assert.strictEqual(memory.groupSignals[0].visto_at, primera);
});

test("marcarGestion guarda envio o no_sirve y rechaza otra cosa", async () => {
  assert.strictEqual(await groupSignals.marcarGestion(ORG, "s1", "envio"), true);
  assert.strictEqual(memory.groupSignals[0].gestion, "envio");
  assert.ok(memory.groupSignals[0].gestionado_at);
  await assert.rejects(() => groupSignals.marcarGestion(ORG, "s1", "otra"));
});

test("urlDeAviso: sin CRM_PUBLIC_URL no hay link; con ella, /aviso/<token>", () => {
  assert.strictEqual(linkAviso.urlDeAviso("abc"), null);
  process.env.CRM_PUBLIC_URL = "https://crm.ejemplo.com/";
  assert.strictEqual(linkAviso.urlDeAviso("abc"), "https://crm.ejemplo.com/aviso/abc");
  assert.strictEqual(linkAviso.urlDeAviso(null), null);
});
