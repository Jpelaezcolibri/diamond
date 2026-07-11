// Sprint "Cero Leads Perdidos": cerrar_lead + embudo_ventas.
const { test } = require("node:test");
const assert = require("node:assert");
const { executeCommandTool } = require("../src/agent/sofi-comando-tools");
const command = require("../src/data/command");

function asesorScope(orgId = "org-1") {
  return Object.freeze({ orgId, viewerUid: "asesor-1", role: "asesor_ventas", isAdmin: false });
}

// ── calcularEmbudo (pura) ──────────────────────────────────────────────────
test("calcularEmbudo: cohorte por fuente con etapas acumulativas y valor ganado", () => {
  const leads = [
    { estado: "nuevo", source: "meta_ads" },
    { estado: "calificado", source: "meta_ads" },
    { estado: "transferido", source: "meta_ads" },
    { estado: "cerrado_ganado", source: "meta_ads", valor_cierre: 346000000 },
    { estado: "cerrado_perdido", source: "whatsapp" },
    { estado: "descartado", source: "whatsapp" },
  ];
  const { totales, por_fuente } = command.calcularEmbudo(leads);

  assert.strictEqual(totales.leads, 6);
  // Un cerrado (ganado o perdido) tambien alcanzo calificado y transferido.
  assert.strictEqual(totales.calificados, 4);
  assert.strictEqual(totales.transferidos, 3);
  assert.strictEqual(totales.ganados, 1);
  assert.strictEqual(totales.perdidos, 1);
  assert.strictEqual(totales.valor_ganado, 346000000);

  assert.strictEqual(por_fuente.meta_ads.leads, 4);
  assert.strictEqual(por_fuente.meta_ads.ganados, 1);
  assert.strictEqual(por_fuente.whatsapp.leads, 2);
  assert.strictEqual(por_fuente.whatsapp.valor_ganado, 0);
});

test("calcularEmbudo: sin leads devuelve totales en cero", () => {
  const { totales } = command.calcularEmbudo([]);
  assert.strictEqual(totales.leads, 0);
  assert.strictEqual(totales.valor_ganado, 0);
});

// ── camposDeCierre (pura) ──────────────────────────────────────────────────
test("camposDeCierre: ganado produce estado, closed_at y valor en pesos", () => {
  const f = command.camposDeCierre("ganado", { valor: "340 millones" });
  assert.strictEqual(f.estado, "cerrado_ganado");
  assert.strictEqual(f.valor_cierre, 340000000);
  assert.ok(f.closed_at);
  assert.strictEqual(f.motivo_perdida, undefined);
});

test("camposDeCierre: perdido guarda el motivo truncado y sin valor", () => {
  const f = command.camposDeCierre("perdido", { motivo: "no le salio el credito", valor: "999 millones" });
  assert.strictEqual(f.estado, "cerrado_perdido");
  assert.strictEqual(f.motivo_perdida, "no le salio el credito");
  assert.strictEqual(f.valor_cierre, undefined); // el valor solo aplica a ganado
});

test("camposDeCierre: ganado sin valor no inventa valor_cierre", () => {
  const f = command.camposDeCierre("ganado", {});
  assert.strictEqual(f.estado, "cerrado_ganado");
  assert.strictEqual(f.valor_cierre, undefined);
});

// ── cerrar_lead (tool) ─────────────────────────────────────────────────────
test("cerrar_lead: cierra el lead encontrado y pide confirmar al asesor", async (t) => {
  t.mock.method(command, "buscarLeads", async () => [{ id: "l-9", nombre: "Javier", estado: "transferido" }]);
  let recibido = null;
  t.mock.method(command, "cerrarLead", async (scope, leadId, opts) => {
    recibido = { scope, leadId, opts };
    return { id: leadId, nombre: "Javier", estado: "cerrado_ganado", valor_cierre: 340000000 };
  });

  const out = await executeCommandTool(
    "cerrar_lead",
    { cliente: "Javier", resultado: "ganado", valor: "340 millones" },
    { scope: asesorScope(), session: null }
  );

  assert.strictEqual(recibido.scope.viewerUid, "asesor-1");
  assert.strictEqual(recibido.opts.resultado, "ganado");
  assert.match(out, /GANADO/);
  assert.match(out, /340\.000\.000/);
});

test("cerrar_lead: con varios matches no cierra nada y pide desambiguar", async (t) => {
  t.mock.method(command, "buscarLeads", async () => [
    { id: "a", nombre: "Javier Gomez", estado: "nuevo" },
    { id: "b", nombre: "Javier Ruiz", estado: "calificado" },
  ]);
  let llamado = false;
  t.mock.method(command, "cerrarLead", async () => { llamado = true; return null; });

  const out = await executeCommandTool("cerrar_lead", { cliente: "Javier", resultado: "perdido" }, { scope: asesorScope(), session: null });

  assert.strictEqual(llamado, false);
  assert.match(out, /no cerre nada/);
});

test("cerrar_lead: un lead ya cerrado no se re-cierra", async (t) => {
  t.mock.method(command, "buscarLeads", async () => [{ id: "l-9", nombre: "Marta", estado: "cerrado_ganado" }]);
  let llamado = false;
  t.mock.method(command, "cerrarLead", async () => { llamado = true; return null; });

  const out = await executeCommandTool("cerrar_lead", { cliente: "Marta", resultado: "perdido" }, { scope: asesorScope(), session: null });

  assert.strictEqual(llamado, false);
  assert.match(out, /ya estaba cerrado/);
});

// ── embudo_ventas (tool) ───────────────────────────────────────────────────
test("embudo_ventas: pasa el scope del ctx y devuelve el embudo", async (t) => {
  let recibido = null;
  t.mock.method(command, "embudo", async (scope, opts) => {
    recibido = { scope, opts };
    return { desde: "d", hasta: "h", totales: { leads: 10, ganados: 2, valor_ganado: 600000000 }, por_fuente: {} };
  });

  const out = await executeCommandTool("embudo_ventas", { desde: "2026-07-01", is_admin: true }, { scope: asesorScope(), session: null });

  assert.strictEqual(recibido.scope.isAdmin, false); // el input no amplia el alcance
  assert.strictEqual(recibido.opts.desde, "2026-07-01");
  assert.match(out, /"ganados":\s*2/);
});
