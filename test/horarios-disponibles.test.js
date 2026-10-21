// Horarios ofrecidos y anticipacion por operacion (spec
// 2026-10-21-sofi-super-agente §2.1-2.2): Sofi ofrece dos espacios libres de
// verdad en vez de preguntar "¿que dia y hora te sirve?", y el arriendo pide
// 6 h de anticipacion en vez de 24.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const advisors = require("../src/data/advisors");
const r = require("../src/lib/agenda-reglas");
const { executeTool, TOOL_DEFINITIONS } = require("../src/agent/tools");
const { buildSystemPrompt } = require("../src/agent/prompts");

const AHORA = new Date("2026-10-07T15:00:00Z"); // martes 10:00 Bogotá
const H = { dias: [0, 1, 2, 3, 4, 5, 6], desde: "08:00", hasta: "18:00" };

test("anticipación por operación: venta 24 h, arriendo 6 h, sin operación como siempre", () => {
  const iso = "2026-10-07T22:00:00Z"; // martes 17:00 Bogotá, 7 h despues
  assert.strictEqual(r.validarHora({ fechaHoraIso: iso, ahora: AHORA, horario: { ...H, hasta: "19:00" }, operacion: "arriendo" }).ok, true);
  assert.strictEqual(r.validarHora({ fechaHoraIso: iso, ahora: AHORA, horario: { ...H, hasta: "19:00" }, operacion: "venta" }).motivo, "anticipacion");
  assert.strictEqual(r.validarHora({ fechaHoraIso: iso, ahora: AHORA, horario: { ...H, hasta: "19:00" } }).motivo, "anticipacion");
  // A 5 h ni el arriendo.
  assert.strictEqual(r.validarHora({ fechaHoraIso: "2026-10-07T20:00:00Z", ahora: AHORA, horario: H, operacion: "Arriendo" }).motivo, "anticipacion");
  assert.strictEqual(r.anticipacionMin("alquiler"), 6 * 60);
  assert.strictEqual(r.anticipacionMin("Venta"), 24 * 60);
  assert.strictEqual(r.anticipacionMin(null), 24 * 60);
});

test("alternativas de arriendo arrancan a las 6 h; las de venta a las 24 h", () => {
  const arr = r.alternativas({ ahora: AHORA, horario: H, operacion: "arriendo" });
  assert.strictEqual(arr[0], "2026-10-07T21:00:00.000Z"); // 16:00 Bogotá
  const ven = r.alternativas({ ahora: AHORA, horario: H, operacion: "venta" });
  assert.strictEqual(ven[0], "2026-10-08T15:00:00.000Z");
  assert.deepStrictEqual(r.alternativas({ ahora: AHORA, horario: H }), ven);
});

// --- La tool ---------------------------------------------------------------

const A1 = { id: "a1", org_id: "org-1", name: "Daiana Zea", phone: "573011880668", alias_publico: "Asesor 1", activo: true, recibe_citas: true, orden_citas: 1, auth_user_id: "u1", horario: H };
const A2 = { id: "a2", org_id: "org-1", name: "Claudia Valencia", phone: "573000008113", alias_publico: "Asesor 2", activo: true, recibe_citas: true, orden_citas: 2, auth_user_id: null, horario: H };
const PROPS = [
  { org_id: "org-1", ref: "ARR1", operacion: "Arriendo", disponible: true },
  { org_id: "org-1", ref: "VEN1", operacion: "Venta", disponible: true },
];
const ctx = (lead = {}) => ({ org: { id: "org-1", name: "Diamond" }, lead: { id: "l1", org_id: "org-1", phone: "573125550000", ...lead } });
const enHoras = (h) => new Date(Date.now() + h * 3600 * 1000);
// Primer instante a las 10:00 Bogota (15:00Z) al menos `h` horas adelante.
const aLas10 = (d) => { const x = new Date(d); x.setUTCHours(15, 0, 0, 0); return x.toISOString(); };

beforeEach(() => {
  memory.leads.length = 0;
  memory.advisors.length = 0;
  memory.properties.length = 0;
  memory.advisors.push({ ...A1 }, { ...A2 });
  memory.properties.push(...PROPS.map((p) => ({ ...p })));
});

const horarios = async (input, c = ctx()) => JSON.parse(await executeTool("horarios_disponibles", input, c));

test("la tool está declarada al final de la lista, sin desordenar las demás", () => {
  assert.strictEqual(TOOL_DEFINITIONS[TOOL_DEFINITIONS.length - 1].name, "horarios_disponibles");
  assert.strictEqual(TOOL_DEFINITIONS[0].name, "buscar_propiedades");
});

test("devuelve 3 horarios libres, con texto en español y hora de Bogotá, respetando anticipación de venta", async () => {
  const out = await horarios({ ref: "VEN1" });
  assert.strictEqual(out.horarios.length, 3);
  for (const h of out.horarios) {
    assert.ok(new Date(h.iso).getTime() - Date.now() >= 24 * 3600 * 1000 - 1000, "venta: 24 h");
    assert.match(h.texto, /^(lunes|martes|miércoles|jueves|viernes|sábado|domingo) \d{1,2} de [a-z]+, \d{1,2}:\d{2}\s[ap]\.\s?m\.$/);
  }
});

test("arriendo por la ref: el primer horario puede caer a menos de 24 h", async () => {
  const out = await horarios({ ref: "ARR1" });
  assert.strictEqual(out.horarios.length, 3);
  const primero = new Date(out.horarios[0].iso).getTime() - Date.now();
  assert.ok(primero >= 6 * 3600 * 1000 - 1000, "nunca menos de 6 h");
  // Lo mismo que calcula la regla pura con la operacion de arriendo.
  const esperado = r.alternativas({ ahora: new Date(), horario: H, operacion: "arriendo" })[0];
  assert.strictEqual(out.horarios[0].iso, esperado);
});

test("sin ref, la operación sale de lead.categoria (alquiler → arriendo)", async () => {
  const conCategoria = await horarios({}, ctx({ categoria: "alquiler" }));
  assert.strictEqual(conCategoria.horarios[0].iso, r.alternativas({ ahora: new Date(), horario: H, operacion: "arriendo" })[0]);
  const sinNada = await horarios({}, ctx());
  assert.strictEqual(sinNada.horarios[0].iso, r.alternativas({ ahora: new Date(), horario: H })[0]);
});

test("con los dos asesores ocupados a una hora, esa hora no se ofrece; con uno libre, sí", async () => {
  const libre = await horarios({ ref: "VEN1" });
  const primera = libre.horarios[0].iso;
  memory.leads.push({ id: "x1", org_id: "org-1", cita: { asesor_id: "a1", fecha_hora: primera, estado: "confirmada" } });
  const conUno = await horarios({ ref: "VEN1" });
  assert.strictEqual(conUno.horarios[0].iso, primera, "A2 sigue libre");
  memory.leads.push({ id: "x2", org_id: "org-1", cita: { asesor_id: "a2", fecha_hora: primera, estado: "propuesta" } });
  const conDos = await horarios({ ref: "VEN1" });
  assert.ok(!conDos.horarios.some((h) => h.iso === primera), "ninguno libre a esa hora");
  // Y el bloque de 60+90 min tambien: la media hora siguiente tampoco.
  const mediaHora = new Date(new Date(primera).getTime() + 30 * 60 * 1000).toISOString();
  assert.ok(!conDos.horarios.some((h) => h.iso === mediaHora));
});

test("respeta el horario de cada asesor", async () => {
  const tarde = { dias: [0, 1, 2, 3, 4, 5, 6], desde: "14:00", hasta: "16:00" };
  memory.advisors.forEach((a) => (a.horario = tarde));
  const out = await horarios({ ref: "VEN1" });
  assert.strictEqual(out.horarios.length, 3);
  for (const h of out.horarios) {
    assert.ok(r.dentroDeHorario(tarde, h.iso), `${h.iso} fuera de 14:00-16:00`);
    assert.match(h.texto, / (2|3):\d{2}\sp\.\s?m\.$/);
  }
});

test("sin ciclo de rotación usa a quien coordina las visitas", async (t) => {
  memory.advisors.forEach((a) => (a.recibe_citas = false));
  const principal = { id: "p1", name: "Daiana", phone: "573011880668", auth_user_id: "up1", horario: { dias: [0, 1, 2, 3, 4, 5, 6], desde: "09:00", hasta: "12:00" } };
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => principal);
  const out = await horarios({ ref: "VEN1" });
  assert.strictEqual(out.horarios.length, 3);
  assert.deepStrictEqual(out.horarios.map((h) => h.iso), r.alternativas({ ahora: new Date(), horario: principal.horario }));
});

test("sin espacios en 14 días: lista vacía y un motivo", async () => {
  memory.advisors.forEach((a) => (a.horario = { dias: [], desde: "08:00", hasta: "18:00" }));
  const out = await horarios({ ref: "VEN1" });
  assert.deepStrictEqual(out.horarios, []);
  assert.match(out.motivo, /14 dias/);
});

// --- agendar_cita con la operacion -----------------------------------------

// La hora de 8 h adelante cae fuera del horario segun a que hora corra el
// test; con un horario de 24 h el unico filtro que cuenta es la anticipacion.
function horario24h() {
  memory.advisors.forEach((a) => (a.horario = { dias: [0, 1, 2, 3, 4, 5, 6], desde: "00:00", hasta: "23:59" }));
}

test("agendar_cita: arriendo a 8 h sale; venta a 8 h no", async () => {
  horario24h();
  const iso = new Date(Math.ceil(enHoras(8).getTime() / 1800000) * 1800000).toISOString();

  const arr = ctx();
  const outArr = await executeTool("agendar_cita", { descripcion: "visita", tipo: "visita", fecha_hora_iso: iso, ref: "ARR1" }, arr);
  assert.match(outArr, /SOLICITADA/);
  assert.strictEqual(arr.lead.cita.operacion, "arriendo", "queda en la cita para la escalera");
  assert.doesNotMatch(outArr, /queda confirmada/i);

  memory.leads.length = 0;
  const ven = ctx({ id: "l2" });
  const outVen = await executeTool("agendar_cita", { descripcion: "visita", tipo: "visita", fecha_hora_iso: iso, ref: "VEN1" }, ven);
  assert.match(outVen, /No se pudo agendar: necesitamos al menos 24 horas/);
  assert.strictEqual(ven.lead.cita, undefined);
});

test("agendar_cita de arriendo a 5 h: no sale y dice 6 horas", async () => {
  horario24h();
  const c = ctx({ categoria: "alquiler" });
  const out = await executeTool("agendar_cita", { descripcion: "visita", tipo: "visita", fecha_hora_iso: enHoras(5).toISOString() }, c);
  assert.match(out, /al menos 6 horas/);
  assert.strictEqual(c.lead.cita, undefined);
});

test("agendar_cita de venta en 72 h sigue igual y guarda la operación", async () => {
  const c = ctx();
  await executeTool("agendar_cita", { descripcion: "visita", tipo: "visita", fecha_hora_iso: aLas10(enHoras(72)), ref: "VEN1" }, c);
  assert.strictEqual(c.lead.cita.estado, "propuesta");
  assert.strictEqual(c.lead.cita.operacion, "venta");
});

test("la escalera rota una cita de arriendo con la regla de arriendo", () => {
  const rotacion = require("../src/data/rotacion-citas");
  const creada = new Date("2026-10-07T13:00:00Z"); // 08:00 Bogota
  const fecha = "2026-10-07T21:00:00Z"; // 16:00, 8 h despues
  const ciclo = [{ ...A1 }, { ...A2 }];
  assert.strictEqual(rotacion.siguiente({ ciclo, actualId: "a1", citasOrg: [], fechaHoraIso: fecha, ahora: creada, operacion: "arriendo" }).id, "a2");
  assert.strictEqual(rotacion.siguiente({ ciclo, actualId: "a1", citasOrg: [], fechaHoraIso: fecha, ahora: creada }).id, "a1", "con la de venta nadie mas podria");
});

// --- El prompt -------------------------------------------------------------

test("el prompt ofrece dos horarios de horarios_disponibles y ya no pide que la persona proponga", () => {
  const base = { org: { id: "org-1", name: "Diamond" }, lead: { id: "l1", estado: "nuevo" }, qualified: false, now: null };
  const cliente = buildSystemPrompt(base).map((b) => b.text).join("\n");
  const colega = buildSystemPrompt({ ...base, colega: { nombre: "Esteban" }, coordinador: { nombre: "Asesor 1" } }).map((b) => b.text).join("\n");
  for (const [quien, p] of [["cliente", cliente], ["colega", colega]]) {
    assert.match(p, /horarios_disponibles/, quien);
    assert.match(p, /DOS de esos horarios en un solo mensaje/, quien);
    assert.match(p, /Si propone otra hora, usa la suya/, quien);
    assert.doesNotMatch(p, /no escoges un espacio de la agenda/, quien);
  }
  // 34-A y 36 siguen.
  assert.match(cliente, /34-A\. .*Nunca conviertas una franja en una hora que el no dijo/);
  assert.match(cliente, /36\. Registrar la cita NO la confirma: queda SOLICITADA/);
  assert.doesNotMatch(cliente, /preguntale que dia y a que hora le sirve\. Vos no escoges/);
});

test("la descripción de agendar_cita ya no dice que Sofi no ofrece horarios", () => {
  const tool = TOOL_DEFINITIONS.find((x) => x.name === "agendar_cita");
  assert.doesNotMatch(tool.description, /no escoges un espacio/);
  assert.match(tool.description, /horarios_disponibles/);
});
