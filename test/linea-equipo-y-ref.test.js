// Linea del radar, 2026-10-27 (caso Luna del Campo): Catherine le escribio a
// Daiana "listo confirmada cita en Luna del Campo en Robledo" y quedo como una
// cita de un colega, con la ref de una casa en Alto de las Palmas.
const { test } = require("node:test");
const assert = require("node:assert");
const equipo = require("../src/groups/equipo-linea");
const visitaLinea = require("../src/groups/visita-linea");
const advisors = require("../src/data/advisors");
const properties = require("../src/data/properties");
const directorio = require("../src/groups/directorio");

const ORG = { id: "org-1", name: "Diamond" };
const CATHERINE = { id: "adv-cath", name: "Catherine Uribe", phone: "573028536489", activo: true };

function asesoras(t) {
  t.mock.method(advisors, "findByPhone", async (orgId, tel) => (String(tel).endsWith("3028536489") ? CATHERINE : null));
  t.mock.method(directorio, "telefonoDe", async () => null);
}

test("equipo: una asesora que llega solo con lid se reconoce por el autor del pedido", async (t) => {
  asesoras(t);
  const a = await equipo.esDelEquipo(ORG, { lid: "269230108872829@lid", señal: { autor_telefono: "573028536489" } });
  assert.strictEqual(a && a.name, "Catherine Uribe");
});

test("equipo: un colega no es del equipo", async (t) => {
  asesoras(t);
  assert.strictEqual(await equipo.esDelEquipo(ORG, { lid: "1@lid", señal: { autor_telefono: "573001112233" } }), null);
  assert.strictEqual(await equipo.esDelEquipo(ORG, { telefono: "573001112233" }), null);
});

test("dm.procesarMensaje: el mensaje de una asesora no se guarda como colega", async (t) => {
  const dm = require("../src/groups/dm");
  const eco = require("../src/groups/eco-sofi");
  const lineaDm = require("../src/data/linea-dm");
  const groupSignals = require("../src/data/group-signals");
  asesoras(t);
  t.mock.method(eco, "esEcoDeSofi", async () => false);
  t.mock.method(groupSignals, "buscarPorLid", async () => ({ id: "sig-1", autor_telefono: "573028536489", respuesta_refs: ["9805628"] }));
  const create = t.mock.method(lineaDm, "create", async () => ({ mensaje: { id: "dm-1" }, duplicado: false }));
  const r = await dm.procesarMensaje(ORG, {
    waMessageId: "w-1", sesion: "DaianaDiamond", remitenteLid: "269230108872829@lid", remitenteTelefono: null,
    remitenteNombre: "cathe Uribe relator", texto: "Cathe listo confirmada cita en Luna del campo en robledo", fechaMensaje: "2026-10-27T15:54:00Z",
  });
  assert.strictEqual(r.resultado, "equipo");
  assert.strictEqual(create.mock.callCount(), 0);
});

const FICHAS = {
  9805628: { ref: "9805628", zona: "Alto de las Palmas", titulo: "Venta Casa Campestre de Lujo Alto de las Palmas" },
  10013440: { ref: "10013440", zona: "Robledo", titulo: "Apartamento en venta Luna del Campo" },
  10229646: { ref: "10229646", zona: "Las Palmas", titulo: "Casa Campestre en Venta en Las Palmas" },
};

test("ref: la que el hilo describe, no la primera que se le mando", async (t) => {
  t.mock.method(properties, "findByRef", async (org, ref) => FICHAS[ref] || null);
  const señal = { respuesta_refs: ["9805628", "10013440"] };
  assert.strictEqual(await visitaLinea.refDe(ORG, señal, ["listo confirmada cita en Luna del campo en robledo"]), "10013440");
});

test("ref: la que el hilo nombra manda; con una sola enviada, esa", async (t) => {
  t.mock.method(properties, "findByRef", async (org, ref) => FICHAS[ref] || null);
  assert.strictEqual(await visitaLinea.refDe(ORG, { respuesta_refs: ["9805628", "10013440"] }, ["el cliente quiere ver la 10013440 el jueves"]), "10013440");
  assert.strictEqual(await visitaLinea.refDe(ORG, { respuesta_refs: ["9805628"] }, ["listo, el jueves a las 3"]), "9805628");
});

test("ref: si no se puede saber, queda sin ref en vez de una equivocada", async (t) => {
  t.mock.method(properties, "findByRef", async (org, ref) => FICHAS[ref] || null);
  // Las dos son de Las Palmas: el hilo no dice cual.
  assert.strictEqual(await visitaLinea.refDe(ORG, { respuesta_refs: ["9805628", "10229646"] }, ["confirmada la visita en las palmas"]), null);
  assert.strictEqual(await visitaLinea.refDe(ORG, { respuesta_refs: ["9805628", "10013440"] }, ["listo, mañana a las 10"]), null);
});

test("dm.procesarMensaje: si el hilo es de un contestador automatico no se clasifica ni se avisa", async (t) => {
  const dm = require("../src/groups/dm");
  const eco = require("../src/groups/eco-sofi");
  const lineaDm = require("../src/data/linea-dm");
  const groupSignals = require("../src/data/group-signals");
  const sofiLinea = require("../src/groups/sofi-linea");
  const puente = require("../src/groups/puente-sofi");
  const prev = process.env.RADAR_DM_CLASIFICAR;
  process.env.RADAR_DM_CLASIFICAR = "true";
  t.after(() => { if (prev === undefined) delete process.env.RADAR_DM_CLASIFICAR; else process.env.RADAR_DM_CLASIFICAR = prev; });
  t.mock.method(advisors, "findByPhone", async () => null);
  t.mock.method(directorio, "telefonoDe", async () => null);
  t.mock.method(eco, "esEcoDeSofi", async () => false);
  t.mock.method(groupSignals, "buscarPorLid", async () => ({ id: "sig-1", respuesta_refs: ["10488315"] }));
  t.mock.method(lineaDm, "create", async () => ({ mensaje: { id: "dm-1", created_at: "2026-10-27T22:08:33Z" }, duplicado: false }));
  t.mock.method(lineaDm, "faltaColumnaLid", () => false);
  t.mock.method(lineaDm, "historialDe", async () => [
    { texto: "He conectado tu mensaje con nuestro equipo para que lo revisen." },
    { texto: "Perfecto Diamond, gracias por avisar. Quedamos atentos a Sofi por el WhatsApp que compartiste para coordinar la visita." },
  ]);
  t.mock.method(sofiLinea, "activo", () => false);
  t.mock.method(puente, "tenderPuente", async () => ({ resultado: "sin_senal" }));
  const avisar = t.mock.method(visitaLinea, "avisar", async () => ({ ok: true }));
  const r = await dm.procesarMensaje(ORG, {
    waMessageId: "w-2", sesion: "DaianaDiamond", remitenteLid: "243344424886478@lid", remitenteTelefono: null,
    remitenteNombre: "elizabeth muriel", texto: "Perfecto Diamond, gracias por avisar. Quedamos atentos a Sofi por el WhatsApp que compartiste para coordinar la visita.", fechaMensaje: "2026-10-27T22:08:33Z",
  });
  assert.strictEqual(r.resultado, "autorespuesta");
  assert.strictEqual(avisar.mock.callCount(), 0);
});
