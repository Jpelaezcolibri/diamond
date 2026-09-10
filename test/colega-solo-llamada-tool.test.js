// Sofi marca de verdad al colega que pide solo llamada (Juan, 2026-09-10).
// Caso Angela Moscoso: Sofi le dijo "ya esta anotado" sin llamar ninguna
// herramienta, y dos horas despues el radar le mando un DM. Lo que se fija:
// que la marca quede guardada, que la asesora se entere, y que Sofi NUNCA
// reciba un texto que la invite a decir "anotado" si no se pudo guardar.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const memory = require("../src/data/memory");
const { executeTool, TOOL_DEFINITIONS } = require("../src/agent/tools");
const advisors = require("../src/data/advisors");
const mensajeAsesor = require("../src/lib/mensaje-asesor");

const ctxColega = () => ({
  org: { id: "org-1", name: "Diamond" },
  lead: { id: "lead-1", phone: "573146399667" },
  colega: { lid: "266150634110990", telefono: "573146399667", nombre: "tengotuinmueblecomercial1" },
});

let avisos;
beforeEach(() => {
  memory.colegasGrupos.length = 0;
  avisos = [];
});

function mockAviso(t) {
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => ({ id: "adv-natalia", name: "Natalia Velez", phone: "573001878024" }));
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, telefono, texto) => {
    avisos.push({ telefono, texto });
    return { ok: true };
  });
}

test("la tool esta declarada", () => {
  const def = TOOL_DEFINITIONS.find((d) => d.name === "marcar_colega_solo_llamada");
  assert.ok(def);
  assert.match(def.description, /solo por llamada|únicamente por llamada/);
});

test("con un colega que esta en los grupos: lo marca, avisa a la asesora y Sofi puede confirmarlo", async (t) => {
  mockAviso(t);
  memory.colegasGrupos.push({ id: "c1", org_id: "org-1", lid: "266150634110990", telefono: "573146399667", nombre: "tengotuinmueblecomercial1", grupos: [], solo_llamada: false });

  const out = await executeTool("marcar_colega_solo_llamada", { detalle: "que la llamen, no mensajes" }, ctxColega());

  assert.strictEqual(memory.colegasGrupos[0].solo_llamada, true);
  assert.match(out, /quedó guardado/);
  assert.strictEqual(avisos.length, 1);
  assert.strictEqual(avisos[0].telefono, "573001878024");
  assert.match(avisos[0].texto, /SOLO por llamada/);
  assert.match(avisos[0].texto, /\+573146399667/);
  assert.match(avisos[0].texto, /que la llamen, no mensajes/);
});

test("si no lo encuentra, NO le da a Sofi un texto para decir 'anotado', y avisa igual a la asesora", async (t) => {
  mockAviso(t);
  const out = await executeTool("marcar_colega_solo_llamada", {}, ctxColega());
  assert.match(out, /NO se pudo guardar/);
  assert.match(out, /NO le digas que quedó anotado/);
  assert.doesNotMatch(out, /quedó guardado/);
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].texto, /NO pude guardar la marca/);
  assert.match(avisos[0].texto, /no aparece entre los colegas de los grupos/);
  assert.doesNotMatch(avisos[0].texto, /\blo encuentro\b/, "copy neutro: sin 'lo' referido al colega");
});

test("con alguien que no es colega, no aplica", async (t) => {
  mockAviso(t);
  const out = await executeTool("marcar_colega_solo_llamada", {}, { ...ctxColega(), colega: null });
  assert.match(out, /No aplica/);
  assert.strictEqual(avisos.length, 0);
});
