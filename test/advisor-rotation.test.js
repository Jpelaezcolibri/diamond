// Rotacion de transferencias organicas (decision 2026-07-25): solo los
// asesores con recibe_transferencias !== false entran al round-robin de su
// especialidad; el reparto es uno a uno segun el ultimo transferido.
const { test } = require("node:test");
const assert = require("node:assert");
const advisors = require("../src/data/advisors");
const memory = require("../src/data/memory");
const { rotationCandidates, nextInRotation } = advisors;

const NATALIA = { id: "adv-natalia", name: "Natalia", especialidad: "venta", activo: true };
const DANNA = { id: "adv-danna", name: "Danna", especialidad: "venta", activo: true };
const CLAUDIA = { id: "adv-claudia", name: "Claudia", especialidad: "venta", activo: true, recibe_transferencias: false };
const VIEJO = { id: "adv-viejo", name: "Asesor de Ventas Diamond", especialidad: "venta", activo: true, recibe_transferencias: false };
const ARRIENDO = { id: "adv-arr", name: "Arriendos", especialidad: "arriendo", activo: true };

const LIST = [VIEJO, CLAUDIA, NATALIA, DANNA, ARRIENDO];

test("rotationCandidates: excluye recibe_transferencias=false y otras especialidades", () => {
  const rot = rotationCandidates(LIST, "venta");
  assert.deepStrictEqual(rot.map((a) => a.id).sort(), ["adv-danna", "adv-natalia"]);
});

test("rotationCandidates: sin columna (undefined) cuenta como true — compatibilidad pre-migracion", () => {
  const rot = rotationCandidates([NATALIA, DANNA], "venta");
  assert.strictEqual(rot.length, 2);
});

test("nextInRotation: reparte uno a uno segun el ultimo transferido", () => {
  const rot = rotationCandidates(LIST, "venta");
  const primero = nextInRotation(rot, null);
  const segundo = nextInRotation(rot, primero.id);
  const tercero = nextInRotation(rot, segundo.id);
  assert.notStrictEqual(primero.id, segundo.id);
  assert.strictEqual(tercero.id, primero.id); // con 2 asesores, alterna
});

test("nextInRotation: lastId desconocido (asesor sacado de la rotacion) arranca del primero", () => {
  const rot = rotationCandidates(LIST, "venta");
  const pick = nextInRotation(rot, "adv-claudia");
  assert.ok(["adv-natalia", "adv-danna"].includes(pick.id));
});

test("nextInRotation: rotacion de uno siempre devuelve ese", () => {
  const rot = rotationCandidates(LIST, "arriendo");
  assert.strictEqual(nextInRotation(rot, null).id, "adv-arr");
  assert.strictEqual(nextInRotation(rot, "adv-arr").id, "adv-arr");
});

// findAsesorPrincipalRadar (Juan, 2026-08-25): Natalia (RADAR_REVISOR_PHONE)
// tiene que ser siempre la destinataria primaria del radar de grupos —esta
// dentro de los grupos gremiales y puede copiar el aviso directo al grupo—.
// Solo cae a la rotacion de siempre si esa linea no esta configurada o no
// resuelve a nadie, para que el sistema nunca se quede sin nadie a quien avisar.
test("findAsesorPrincipalRadar: con RADAR_REVISOR_PHONE configurada, resuelve por telefono sin pasar por la rotacion", async () => {
  const ORG = { id: "org-radar-principal-1" };
  memory.advisors.push({
    id: "adv-natalia-radar", org_id: ORG.id, name: "Natalia Velez",
    phone: "573001878024", especialidad: "venta", activo: true,
  });
  const previo = process.env.RADAR_REVISOR_PHONE;
  process.env.RADAR_REVISOR_PHONE = "573001878024";
  try {
    const r = await advisors.findAsesorPrincipalRadar(ORG);
    assert.strictEqual(r && r.id, "adv-natalia-radar");
  } finally {
    if (previo === undefined) delete process.env.RADAR_REVISOR_PHONE;
    else process.env.RADAR_REVISOR_PHONE = previo;
  }
});

test("findAsesorPrincipalRadar: sin RADAR_REVISOR_PHONE (o sin resolver a nadie), cae a la rotacion de siempre", async () => {
  const ORG = { id: "org-radar-principal-2" };
  memory.advisors.push({
    id: "adv-rotacion-fallback", org_id: ORG.id, name: "Danna",
    phone: "573000000099", especialidad: "venta", activo: true,
  });
  const previo = process.env.RADAR_REVISOR_PHONE;
  delete process.env.RADAR_REVISOR_PHONE;
  try {
    const r1 = await advisors.findAsesorPrincipalRadar(ORG);
    assert.strictEqual(r1 && r1.id, "adv-rotacion-fallback");

    // Con la env var seteada pero a un telefono que no resuelve a nadie: cae igual.
    process.env.RADAR_REVISOR_PHONE = "573099999999";
    const r2 = await advisors.findAsesorPrincipalRadar(ORG);
    assert.strictEqual(r2 && r2.id, "adv-rotacion-fallback");
  } finally {
    if (previo === undefined) delete process.env.RADAR_REVISOR_PHONE;
    else process.env.RADAR_REVISOR_PHONE = previo;
  }
});
