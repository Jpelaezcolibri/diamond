// Digest diario del radar de grupos.
//
// El import y el reenvío dejan señales en la base, pero nadie vive mirando el
// CRM. Este worker cierra el circuito. Las reglas que se verifican acá son las
// que deciden si el canal sirve o se vuelve ruido: silencio cuando no hay
// nada, claim antes de enviar, y devolver las señales a la fila si nadie las
// recibió.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const digest = require("../src/scheduler/group-digest");
const groupSignals = require("../src/data/group-signals");
const organizations = require("../src/data/organizations");
const advisors = require("../src/data/advisors");
const whatsapp = require("../src/channels/whatsapp");
const config = require("../src/config");

const ORG = { id: "org-1", name: "Diamond" };
const NATALIA = { id: "adv-1", name: "Natalia Vélez", phone: "573001878024", activo: true, recibe_transferencias: true };

const demandaConMatch = (n = 1) => ({
  id: `sig-d${n}`, clase: "demanda", autor_nombre: "Marcela Ruiz", tipo: "apartamento", zona: "Laureles",
  matches: [{ ref: "9944723", puntaje: 75, zona: "Laureles", razones: ["Zona: Laureles"] }],
});
const demandaSinMatch = (n = 1) => ({
  id: `sig-s${n}`, clase: "demanda", autor_nombre: "Pedro Mesa", tipo: "local", zona: "El Poblado", matches: [],
});
const oferta = (n = 1) => ({
  id: `sig-o${n}`, clase: "oferta", autor_nombre: "Carlos Ruiz", tipo: "casa", zona: "Envigado", matches: [],
});

// La hora a la que el digest está configurado para salir, en Colombia.
function aLaHoraDelDigest() {
  const d = new Date();
  d.setUTCHours(config.groups.digest.hour + 5, 0, 0, 0); // Bogotá = UTC-5
  return d;
}

function mockTodo(t, { señales = [], equipo = [NATALIA], enviaOk = true } = {}) {
  const enviados = [];
  const marcados = [];
  const revertidos = [];

  t.mock.method(organizations, "listActive", async () => [ORG]);
  t.mock.method(advisors, "listElegibles", async () => equipo);
  t.mock.method(groupSignals, "pendientesDigest", async () => señales);
  t.mock.method(groupSignals, "marcarDigest", async (orgId, ids) => { marcados.push(...ids); });
  t.mock.method(groupSignals, "revertirDigest", async (orgId, ids) => { revertidos.push(...ids); });
  t.mock.method(whatsapp, "sendWhatsAppTemplate", async (org, to, payload) => {
    enviados.push({ to, ...payload });
    return enviaOk ? { ok: true } : { ok: false, error: "plantilla no aprobada" };
  });

  return { enviados, marcados, revertidos };
}

beforeEach(() => digest._reset());

// ══ El texto del digest ══════════════════════════════════════════════════

test("sin nada que contar NO arma digest — un digest vacío entrena a ignorarlo", () => {
  assert.strictEqual(digest.buildDigest([], NATALIA), null);
  // Una demanda sin match tampoco cuenta: es la fatiga de alertas.
  assert.strictEqual(digest.buildDigest([demandaSinMatch()], NATALIA), null);
});

test("cuenta los pedidos con match y las ofertas por separado", () => {
  const d = digest.buildDigest([demandaConMatch(1), demandaConMatch(2), oferta(1)], NATALIA);
  assert.strictEqual(d.bodyParams[0], "Natalia", "va el nombre de pila, no el completo");
  assert.strictEqual(d.bodyParams[1], "2");
  assert.strictEqual(d.bodyParams[2], "1");
});

test("la línea destacada nombra el mejor match concreto, no un resumen abstracto", () => {
  const linea = digest.lineaDestacada([demandaConMatch()]);
  assert.match(linea, /Marcela Ruiz/);
  assert.match(linea, /apartamento en Laureles/);
  assert.match(linea, /9944723/);
});

test("la línea destacada elige el match de mayor puntaje", () => {
  const flojo = { ...demandaConMatch(1), autor_nombre: "Flojo", matches: [{ ref: "111", puntaje: 40, razones: [] }] };
  const fuerte = { ...demandaConMatch(2), autor_nombre: "Fuerte", matches: [{ ref: "999", puntaje: 90, razones: [] }] };
  assert.match(digest.lineaDestacada([flojo, fuerte]), /Fuerte/);
});

test("sin demandas con match, la línea habla de las propiedades nuevas", () => {
  assert.match(digest.lineaDestacada([oferta()]), /propiedades nuevas/);
});

test("los parámetros de plantilla no llevan saltos de línea — Meta los rechaza", () => {
  const d = digest.buildDigest([demandaConMatch(), oferta()], NATALIA);
  for (const p of d.bodyParams) assert.strictEqual(p.includes("\n"), false, `"${p}" tiene salto de línea`);
});

// ══ El worker ════════════════════════════════════════════════════════════

test("a la hora configurada envía la plantilla a los asesores elegibles", async (t) => {
  const { enviados } = mockTodo(t, { señales: [demandaConMatch(), oferta()] });
  const { enviados: n } = await digest.runOnce({ ahora: aLaHoraDelDigest() });

  assert.strictEqual(n, 1);
  assert.strictEqual(enviados.length, 1);
  assert.strictEqual(enviados[0].to, NATALIA.phone);
  assert.strictEqual(enviados[0].name, config.groups.digest.templateName);
});

test("fuera de la hora configurada no hace nada", async (t) => {
  const { enviados } = mockTodo(t, { señales: [demandaConMatch()] });
  const otraHora = new Date();
  otraHora.setUTCHours(config.groups.digest.hour + 5 + 3, 0, 0, 0);

  await digest.runOnce({ ahora: otraHora });
  assert.strictEqual(enviados.length, 0);
});

test("marca las señales ANTES de enviar — duplicar el digest es peor que perderlo", async (t) => {
  const orden = [];
  const { marcados } = mockTodo(t, { señales: [demandaConMatch()] });
  t.mock.method(groupSignals, "marcarDigest", async () => { orden.push("marca"); });
  t.mock.method(whatsapp, "sendWhatsAppTemplate", async () => { orden.push("envia"); return { ok: true }; });

  await digest.runOnce({ ahora: aLaHoraDelDigest() });
  assert.deepStrictEqual(orden, ["marca", "envia"]);
});

test("no se repite el mismo día", async (t) => {
  const { enviados } = mockTodo(t, { señales: [demandaConMatch()] });
  const ahora = aLaHoraDelDigest();

  await digest.runOnce({ ahora });
  await digest.runOnce({ ahora });
  assert.strictEqual(enviados.length, 1);
});

test("si ningún envío sale, las señales vuelven a la fila", async (t) => {
  // El caso real: la plantilla todavía no está aprobada por Meta.
  const { revertidos, marcados } = mockTodo(t, { señales: [demandaConMatch()], enviaOk: false });
  await digest.runOnce({ ahora: aLaHoraDelDigest() });

  assert.deepStrictEqual(marcados, ["sig-d1"]);
  assert.deepStrictEqual(revertidos, ["sig-d1"], "sin esto las señales se perderían en silencio");
});

test("si al menos uno recibe, no se revierte nada", async (t) => {
  const OTRO = { ...NATALIA, id: "adv-2", name: "Andrés", phone: "573009998877" };
  let n = 0;
  const { revertidos } = mockTodo(t, { señales: [demandaConMatch()], equipo: [NATALIA, OTRO] });
  t.mock.method(whatsapp, "sendWhatsAppTemplate", async () => (++n === 1 ? { ok: false, error: "x" } : { ok: true }));

  await digest.runOnce({ ahora: aLaHoraDelDigest() });
  assert.deepStrictEqual(revertidos, []);
});

test("sin señales pendientes no envía ni marca nada", async (t) => {
  const { enviados, marcados } = mockTodo(t, { señales: [] });
  await digest.runOnce({ ahora: aLaHoraDelDigest() });
  assert.strictEqual(enviados.length, 0);
  assert.strictEqual(marcados.length, 0);
});

test("sin la migración corrida el worker se auto-desactiva en vez de spamear", async (t) => {
  const { enviados } = mockTodo(t, { señales: [] });
  t.mock.method(groupSignals, "pendientesDigest", async () => null);

  await digest.runOnce({ ahora: aLaHoraDelDigest() });
  assert.strictEqual(enviados.length, 0);

  // Y sigue desactivado aunque después haya señales.
  t.mock.method(groupSignals, "pendientesDigest", async () => [demandaConMatch()]);
  await digest.runOnce({ ahora: aLaHoraDelDigest() });
  assert.strictEqual(enviados.length, 0);
});

test("con señales pero sin asesores elegibles avisa y no revienta", async (t) => {
  const { enviados, marcados } = mockTodo(t, { señales: [demandaConMatch()], equipo: [] });
  await assert.doesNotReject(() => digest.runOnce({ ahora: aLaHoraDelDigest() }));
  assert.strictEqual(enviados.length, 0);
  assert.strictEqual(marcados.length, 0, "no se marcan señales que nadie recibió");
});

test("cada asesor recibe el digest con SU nombre", async (t) => {
  const OTRO = { ...NATALIA, id: "adv-2", name: "Andrés Gómez", phone: "573009998877" };
  const { enviados } = mockTodo(t, { señales: [demandaConMatch()], equipo: [NATALIA, OTRO] });

  await digest.runOnce({ ahora: aLaHoraDelDigest() });
  assert.strictEqual(enviados[0].bodyParams[0], "Natalia");
  assert.strictEqual(enviados[1].bodyParams[0], "Andrés");
});

// ══ El detalle bajo demanda ══════════════════════════════════════════════
//
// Cierra el circuito: la plantilla de las 7am solo lleva un resumen, así que
// el asesor responde "VER" y con la ventana de 24h ya abierta se le manda todo
// en texto libre.

const { executeTool, TOOL_DEFINITIONS } = require("../src/agent/tools");

const ctxAsesor = () => ({ org: ORG, lead: { id: "l1", phone: NATALIA.phone } });

test("la tool del radar está declarada y avisa que es interna", () => {
  const def = TOOL_DEFINITIONS.find((t) => t.name === "consultar_radar_grupos");
  assert.ok(def);
  assert.match(def.description, /NO la uses con un cliente final/);
});

test("el detalle lista pedidos con sus refs y propiedades de colegas", async (t) => {
  t.mock.method(groupSignals, "list", async () => [
    { ...demandaConMatch(), precio_max: 600000000, created_at: new Date().toISOString() },
    { ...oferta(), precio_max: 850000000, created_at: new Date().toISOString() },
  ]);

  const out = await executeTool("consultar_radar_grupos", {}, ctxAsesor());
  assert.match(out, /Marcela Ruiz busca apartamento en Laureles/);
  assert.match(out, /9944723/);
  assert.match(out, /casa en Envigado/);
  assert.match(out, /no escribis en ningun grupo/i);
});

test("el radar filtra por la fecha del MENSAJE, no por la de la subida", async (t) => {
  // En un export, created_at es el día en que se subió: sin esto, señales de
  // hace meses aparecerían como si fueran de esta semana.
  t.mock.method(groupSignals, "list", async () => [{
    ...demandaConMatch(),
    fecha_mensaje: new Date(Date.now() - 60 * 86400000).toISOString(),
    created_at: new Date().toISOString(),
  }]);

  const out = await executeTool("consultar_radar_grupos", { dias: 7 }, ctxAsesor());
  assert.match(out, /No hay nada nuevo/);
});

test("sin nada en el radar lo dice, no inventa", async (t) => {
  t.mock.method(groupSignals, "list", async () => []);
  const out = await executeTool("consultar_radar_grupos", {}, ctxAsesor());
  assert.match(out, /No hay nada nuevo en el radar/);
});

test("si la consulta falla manda al CRM en vez de reventar", async (t) => {
  t.mock.method(groupSignals, "list", async () => { throw new Error("sin tabla"); });
  const out = await executeTool("consultar_radar_grupos", {}, ctxAsesor());
  assert.match(out, /CRM/);
});
