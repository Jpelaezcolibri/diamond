// El interruptor del motor de Radar.
//
// Existe porque Radar cuesta plata cada vez que corre: clasificar un export son
// llamadas a la IA y cada digest es una plantilla de WhatsApp cobrada. Lo que
// estos tests protegen no es que el boton se vea: es que apagado NO SE GASTE, y
// que apagarlo nunca le haga perder una oportunidad al asesor.

const { test } = require("node:test");
const assert = require("node:assert");

const { importar } = require("../src/groups/importar-export");
const organizations = require("../src/data/organizations");
const groupSignals = require("../src/data/group-signals");
const whatsappGroups = require("../src/data/whatsapp-groups");
const digest = require("../src/scheduler/group-digest");
const canalWhatsapp = require("../src/channels/whatsapp");
const anthropic = require("../src/lib/anthropic");

const ORG = { id: "org-1", name: "Diamond" };

const EXPORT = [
  "2/8/2026, 9:15 a. m. - Marcela: Tengo cliente para apto 3 alcobas en Laureles hasta 600 millones",
  "2/8/2026, 9:20 a. m. - Andres: Buenos dias a todos",
].join("\n");

// ── Import ────────────────────────────────────────────────────────────────

test("apagado, un export no llega a la IA ni deja señales", async (t) => {
  t.mock.method(organizations, "radarActivo", async () => false);

  // Si alguna de estas dos se llama, el interruptor no sirvio para nada: son
  // justo las que cuestan.
  const llamadasIA = t.mock.method(anthropic, "getClient", () => {
    throw new Error("El motor apagado no puede llamar a la IA");
  });
  const guardadas = t.mock.method(groupSignals, "create", async () => {
    throw new Error("El motor apagado no puede guardar señales");
  });

  await assert.rejects(
    () => importar(ORG, [{ nombre: "Chat de WhatsApp con Bodegas.txt", contenido: EXPORT }]),
    (e) => e.code === "RADAR_APAGADO"
  );

  assert.strictEqual(llamadasIA.mock.callCount(), 0);
  assert.strictEqual(guardadas.mock.callCount(), 0);
});

test("apagado, el error dice donde se prende — no es un 500 mudo", async (t) => {
  t.mock.method(organizations, "radarActivo", async () => false);
  await assert.rejects(
    () => importar(ORG, [{ nombre: "x.txt", contenido: EXPORT }]),
    /Grupos/
  );
});

test("el interruptor se consulta antes de tocar un solo archivo", async (t) => {
  // Se comprueba en importar() y no en el endpoint a proposito: la garantia
  // tiene que valer venga la llamada de donde venga.
  t.mock.method(organizations, "radarActivo", async () => false);
  const grupos = t.mock.method(whatsappGroups, "asegurarGrupoVirtual", async () => ({ id: "g1" }));

  await assert.rejects(() => importar(ORG, [{ nombre: "x.txt", contenido: EXPORT }]));
  assert.strictEqual(grupos.mock.callCount(), 0, "ni siquiera se registro el grupo");
});

// ── Digest ────────────────────────────────────────────────────────────────

function mockDigest(t, { radarActivo }) {
  t.mock.method(organizations, "listActive", async () => [{ ...ORG, radar_activo: radarActivo }]);
  const enviados = [];
  t.mock.method(canalWhatsapp, "sendWhatsAppTemplate", async (org, phone) => {
    enviados.push(phone);
    return { ok: true };
  });
  const marcadas = t.mock.method(groupSignals, "marcarDigest", async () => {});
  t.mock.method(groupSignals, "pendientesDigest", async () => ([
    {
      id: "sig-1", clase: "demanda", zona: "Laureles", tipo: "Apartamento",
      operacion: "venta", precio_max: 600000000, habitaciones: 3,
      matches: [{ ref: "123", fuente: "diamond" }], created_at: new Date().toISOString(),
    },
  ]));
  return { enviados, marcadas };
}

test("apagado, el digest no sale — no se paga ninguna plantilla", async (t) => {
  const { enviados } = mockDigest(t, { radarActivo: false });
  digest._reset();
  const r = await digest.runOnce({ forzar: true });
  assert.strictEqual(r.enviados, 0);
  assert.deepStrictEqual(enviados, []);
});

test("apagado, las señales NO se marcan como enviadas", async (t) => {
  // Es la diferencia entre pausar y perder: al volver a prender, el digest
  // tiene que salir con todo lo que se acumulo mientras estuvo apagado.
  const { marcadas } = mockDigest(t, { radarActivo: false });
  digest._reset();
  await digest.runOnce({ forzar: true });
  assert.strictEqual(marcadas.mock.callCount(), 0);
});

test("encendido, el digest sale normal", async (t) => {
  const { enviados } = mockDigest(t, { radarActivo: true });
  t.mock.method(require("../src/data/advisors"), "listElegibles", async () => ([
    { name: "Natalia", phone: "573001878024" },
  ]));
  digest._reset();
  const r = await digest.runOnce({ forzar: true });
  assert.strictEqual(r.enviados, 1);
  assert.deepStrictEqual(enviados, ["573001878024"]);
});

// ── El default no puede dejar a nadie sin Radar ───────────────────────────

test("si la columna no existe todavia, el motor se considera encendido", () => {
  // Una migracion sin correr no puede apagarle el producto a una organizacion
  // que nunca pidio apagarlo.
  assert.strictEqual(organizations.radarEncendido({ id: "org-1", name: "Diamond" }), true);
});

test("una org que no se pudo leer tampoco apaga el motor", () => {
  assert.strictEqual(organizations.radarEncendido(null), true);
});

test("solo un false explicito apaga", () => {
  assert.strictEqual(organizations.radarEncendido({ radar_activo: false }), false);
  assert.strictEqual(organizations.radarEncendido({ radar_activo: true }), true);
});
