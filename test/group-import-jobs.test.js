// Registro de importaciones en curso.
//
// Es solo la barra de progreso: el resultado que importa vive en
// `group_signals`. Pero el aislamiento entre orgs sí es real — un tenant no
// puede leer el progreso de otro pasando un id ajeno.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const jobs = require("../src/groups/import-jobs");

beforeEach(() => jobs._reset());

test("un job nace en curso, con el conteo de archivos", () => {
  const job = jobs.crear("org-1", { archivos: 3, dias: 30 });
  assert.match(job.id, /^[0-9a-f-]{36}$/);
  assert.strictEqual(job.estado, "en_curso");
  assert.strictEqual(job.total, 3);
  assert.strictEqual(job.dias, 30);
});

test("el progreso actualiza fase y contadores", () => {
  const { id } = jobs.crear("org-1", { archivos: 1 });
  jobs.progreso(id, { fase: "clasificando", procesados: 4, total: 10 });
  const e = jobs.estado(id, "org-1");
  assert.strictEqual(e.fase, "clasificando");
  assert.strictEqual(e.procesados, 4);
  assert.strictEqual(e.total, 10);
});

test("terminar guarda el resultado y cierra el job", () => {
  const { id } = jobs.crear("org-1", { archivos: 1 });
  jobs.terminar(id, { señales: 7, costoUsd: 0.12 });
  const e = jobs.estado(id, "org-1");
  assert.strictEqual(e.estado, "listo");
  assert.strictEqual(e.resultado.señales, 7);
  assert.ok(e.terminadoEn);
});

test("fallar guarda el mensaje y el código para que el CRM pueda explicarlo", () => {
  const { id } = jobs.crear("org-1", { archivos: 1 });
  const err = Object.assign(new Error("Acortá el rango de días"), { code: "DEMASIADOS_MENSAJES" });
  jobs.fallar(id, err);
  const e = jobs.estado(id, "org-1");
  assert.strictEqual(e.estado, "error");
  assert.strictEqual(e.error, "Acortá el rango de días");
  assert.strictEqual(e.codigo, "DEMASIADOS_MENSAJES");
});

test("una org no puede leer el progreso de otra", () => {
  const { id } = jobs.crear("org-1", { archivos: 1 });
  assert.ok(jobs.estado(id, "org-1"));
  assert.strictEqual(jobs.estado(id, "org-2"), null);
});

test("el estado no filtra el orgId hacia afuera", () => {
  const { id } = jobs.crear("org-1", { archivos: 1 });
  assert.strictEqual(jobs.estado(id, "org-1").orgId, undefined);
});

test("un job inexistente devuelve null en vez de reventar", () => {
  assert.strictEqual(jobs.estado("no-existe", "org-1"), null);
});

test("progresar o terminar un job que ya no está no lanza", () => {
  assert.doesNotThrow(() => jobs.progreso("fantasma", { fase: "listo" }));
  assert.doesNotThrow(() => jobs.terminar("fantasma", {}));
  assert.doesNotThrow(() => jobs.fallar("fantasma", new Error("x")));
});
