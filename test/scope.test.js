const { test } = require("node:test");
const assert = require("node:assert");
const { resolveScope } = require("../src/agent/scope");

// Se pasa orgId explicito para no tocar la base (el fallback por advisors se
// verifica aparte con el smoke SQL). Aqui se prueba la logica de rol/alcance.

test("resolveScope: admin obtiene isAdmin=true", async () => {
  const scope = await resolveScope({ orgId: "org-1", viewerUid: "u-1", role: "admin" });
  assert.strictEqual(scope.isAdmin, true);
  assert.strictEqual(scope.orgId, "org-1");
  assert.strictEqual(scope.viewerUid, "u-1");
});

test("resolveScope: super_admin se tolera como admin", async () => {
  const scope = await resolveScope({ orgId: "org-1", viewerUid: "u-1", role: "super_admin" });
  assert.strictEqual(scope.isAdmin, true);
});

test("resolveScope: un asesor NO es admin", async () => {
  for (const role of ["asesor_ventas", "asesor_arrendamientos", "asesor_vehiculos", "asesor_otros"]) {
    const scope = await resolveScope({ orgId: "org-1", viewerUid: "u-2", role });
    assert.strictEqual(scope.isAdmin, false, `rol ${role} no debe ser admin`);
  }
});

test("resolveScope: el alcance es inmutable (congelado)", async () => {
  const scope = await resolveScope({ orgId: "org-1", viewerUid: "u-1", role: "asesor_ventas" });
  assert.strictEqual(Object.isFrozen(scope), true);
  assert.throws(() => {
    "use strict";
    scope.isAdmin = true;
  });
});
