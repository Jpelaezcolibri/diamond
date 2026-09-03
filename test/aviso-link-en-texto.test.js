// El link viaja en el aviso: arriba en el aviso unico, y uno por pedido en el
// digest (Juan, 2026-09-02, opcion D). Tarea 2 del plan
// docs/superpowers/plans/2026-09-03-radar-link-en-el-aviso.md
const { test } = require("node:test");
const assert = require("node:assert");
const alerta = require("../src/groups/alerta-asesor");
const digest = require("../src/groups/digest-avisos");

const senal = { grupo_nombre: "PEDIDOS", autor_nombre: "Julieth", autor_telefono: "262396832686143", texto_original: "Busco apto" };
const matches = [{ ref: "9935585", titulo: "Fontanar", zona: "El Poblado", precio: "$1.250.000.000", operacion: "Venta", puntaje: 95 }];
const aprobado = { sirve_alguna: true, refs_utiles: ["9935585"], refs_dudosas: [], por_que: "Cumple." };

test("el aviso unico lleva el link arriba, antes del pedido", () => {
  const t = alerta.construir(senal, aprobado, matches, null, { id: "org-1" }, "sin_telefono", { link: "https://crm.x/aviso/abc" });
  const iLink = t.indexOf("👉 Ver la oportunidad: https://crm.x/aviso/abc");
  const iPedido = t.indexOf("Lo escribió así:") >= 0 ? t.indexOf("Lo escribió así:") : t.indexOf("Pidió:");
  assert.ok(iLink > 0, "el link esta en el aviso");
  assert.ok(iLink < iPedido, "y va antes del texto del pedido");
});

test("sin link, el aviso es el de siempre", () => {
  const t = alerta.construir(senal, aprobado, matches, null, { id: "org-1" }, "sin_telefono");
  assert.ok(!t.includes("Ver la oportunidad"));
});

test("el digest muestra un link por pedido, solo en los que lo tienen", () => {
  const t = digest.construir("Natalia", [
    { id: "s1", colega: "Julieth", operacion: "venta", tipo: "apartamento", zona: "El Poblado", utiles: 1, dudosas: 0, motivo: "sin_telefono", link: "https://crm.x/aviso/abc" },
    { id: "s2", colega: "Diego", operacion: "venta", tipo: "apartamento", zona: "Calasanz", utiles: 2, dudosas: 0, motivo: "limite_colega_alcanzado" },
  ], []);
  assert.ok(t.includes("👉 https://crm.x/aviso/abc"), t);
  assert.strictEqual((t.match(/👉/g) || []).length, 1, "solo el que tiene link");
});
