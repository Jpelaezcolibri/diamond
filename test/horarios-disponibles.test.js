// Horarios ofrecidos (spec 2026-10-21-sofi-super-agente §2.1): Sofi ofrece dos
// espacios libres de verdad en vez de preguntar "¿que dia y hora te sirve?".
// Anticipacion (Juan, 2026-10-21, reemplaza §2.2): 24 h para toda visita,
// venta o arriendo, para confirmar con el propietario; lo ofrecido lleva 2 h
// de colchon encima (>= 26 h).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const advisors = require("../src/data/advisors");
const r = require("../src/lib/agenda-reglas");
const { executeTool, TOOL_DEFINITIONS } = require("../src/agent/tools");
const { buildSystemPrompt } = require("../src/agent/prompts");

const AHORA = new Date("2026-10-07T15:00:00Z"); // martes 10:00 Bogotá
const H = { dias: [0, 1, 2, 3, 4, 5, 6], desde: "08:00", hasta: "18:00" };

test("anticipación: 24 h para venta y para arriendo (la operación ya no la baja)", () => {
  const iso = "2026-10-07T22:00:00Z"; // martes 17:00 Bogotá, 7 h despues
  const h19 = { ...H, hasta: "19:00" };
  assert.strictEqual(r.validarHora({ fechaHoraIso: iso, ahora: AHORA, horario: h19, operacion: "arriendo" }).motivo, "anticipacion");
  assert.strictEqual(r.validarHora({ fechaHoraIso: iso, ahora: AHORA, horario: h19 }).motivo, "anticipacion");
  // 23 h 30 tampoco; 24 h si.
  assert.strictEqual(r.validarHora({ fechaHoraIso: "2026-10-08T14:30:00Z", ahora: AHORA, horario: H, operacion: "arriendo" }).motivo, "anticipacion");
  assert.deepStrictEqual(r.validarHora({ fechaHoraIso: "2026-10-08T15:00:00Z", ahora: AHORA, horario: H, operacion: "arriendo" }), { ok: true });
  assert.strictEqual(r.anticipacionMin("alquiler"), 24 * 60);
  assert.strictEqual(r.anticipacionMin("Venta"), 24 * 60);
  assert.strictEqual(r.anticipacionMin(null), 24 * 60);
  assert.strictEqual(r.ANTICIPACION_ARRIENDO_MIN, undefined, "ya no hay regla de arriendo");
});

test("alternativas de arriendo y de venta arrancan las dos a las 24 h", () => {
  const arr = r.alternativas({ ahora: AHORA, horario: H, operacion: "arriendo" });
  const ven = r.alternativas({ ahora: AHORA, horario: H });
  assert.strictEqual(ven[0], "2026-10-08T15:00:00.000Z");
  assert.deepStrictEqual(arr, ven);
});

// --- La tool ---------------------------------------------------------------

const A1 = { id: "a1", org_id: "org-1", name: "Daiana Zea", phone: "573011880668", alias_publico: "Asesor 1", activo: true, recibe_citas: true, orden_citas: 1, auth_user_id: "u1", horario: H };
const A2 = { id: "a2", org_id: "org-1", name: "Claudia Valencia", phone: "573000008113", alias_publico: "Asesor 2", activo: true, recibe_citas: true, orden_citas: 2, auth_user_id: null, horario: H };
const PROPS = [
  { org_id: "org-1", ref: "ARR1", operacion: "Arriendo", disponible: true },
  { org_id: "org-1", ref: "VEN1", operacion: "Venta", disponible: true },
];
const ctx = (lead = {}) => ({ org: { id: "org-1", name: "Diamond" }, lead: { id: "l1", org_id: "org-1", phone: "573125550000", ...lead } });
const conColchon = () => new Date(Date.now() + 120 * 60 * 1000); // COLCHON_OFERTA_MIN
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

test("arriendo por la ref, por lead.categoria o sin nada: todos desde 26 h (24 + 2 de colchón)", async () => {
  const casos = [
    await horarios({ ref: "ARR1" }),
    await horarios({}, ctx({ categoria: "alquiler" })),
    await horarios({}, ctx()),
    await horarios({ ref: "VEN1" }),
  ];
  const esperado = r.alternativas({ ahora: conColchon(), horario: H })[0];
  for (const out of casos) {
    assert.strictEqual(out.horarios.length, 3);
    for (const h of out.horarios) assert.ok(new Date(h.iso).getTime() - Date.now() >= 26 * 3600 * 1000 - 1000, "24 h + 2 h de colchon");
    assert.strictEqual(out.horarios[0].iso, esperado);
  }
});

test("la tool le recuerda a Sofi que es desde el día siguiente por el propietario", async () => {
  const out = await horarios({ ref: "ARR1" });
  assert.match(out.nota, /dia siguiente/);
  assert.match(out.nota, /confirmar la visita con el propietario/);
  const tool = TOOL_DEFINITIONS.find((x) => x.name === "horarios_disponibles");
  assert.match(tool.description, /24 h, venta o arriendo, para confirmar con el propietario/);
  assert.strictEqual(tool.input_schema.properties.operacion, undefined);
  assert.strictEqual(TOOL_DEFINITIONS.find((x) => x.name === "agendar_cita").input_schema.properties.operacion, undefined);
});

test("el primer horario ofrecido tiene colchon: sigue valido 40 min despues", async () => {
  const out = await horarios({ ref: "VEN1" });
  const despues = new Date(Date.now() + 40 * 60 * 1000);
  const v = r.validarHora({ fechaHoraIso: out.horarios[0].iso, ahora: despues, horario: H, ocupadas: [] });
  assert.deepStrictEqual(v, { ok: true });
  assert.ok(new Date(out.horarios[0].iso).getTime() - Date.now() >= (24 * 60 + 120) * 60 * 1000 - 1000);
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
  assert.deepStrictEqual(out.horarios.map((h) => h.iso), r.espaciar(r.alternativas({ ahora: conColchon(), horario: principal.horario, n: 1000 })));
});

test("sin espacios en 14 días: lista vacía y un motivo", async () => {
  memory.advisors.forEach((a) => (a.horario = { dias: [], desde: "08:00", hasta: "18:00" }));
  const out = await horarios({ ref: "VEN1" });
  assert.deepStrictEqual(out.horarios, []);
  assert.match(out.motivo, /14 dias/);
});

// --- agendar_cita: 24 h para todos ---------------------------------------

// La hora de 8 h adelante cae fuera del horario segun a que hora corra el
// test; con un horario de 24 h el unico filtro que cuenta es la anticipacion.
function horario24h() {
  memory.advisors.forEach((a) => (a.horario = { dias: [0, 1, 2, 3, 4, 5, 6], desde: "00:00", hasta: "23:59" }));
}

test("agendar_cita: arriendo a 8 h ya no sale, igual que venta, y dice 24 horas por el propietario", async () => {
  horario24h();
  const iso = new Date(Math.ceil(enHoras(8).getTime() / 1800000) * 1800000).toISOString();
  for (const [id, input, lead] of [["l1", { ref: "ARR1" }, {}], ["l2", { ref: "VEN1" }, {}], ["l3", {}, { categoria: "alquiler" }]]) {
    memory.leads.length = 0;
    const c = ctx({ id, ...lead });
    const out = await executeTool("agendar_cita", { descripcion: "visita", tipo: "visita", fecha_hora_iso: iso, ...input }, c);
    assert.match(out, /No se pudo agendar: necesitamos al menos 24 horas de anticipación para confirmarla con el propietario/, id);
    assert.strictEqual(c.lead.cita, undefined, id);
  }
});

test("agendar_cita de arriendo a 25 h sale, con corte y sin guardar operación", async () => {
  horario24h();
  const c = ctx({ categoria: "alquiler" });
  const iso = new Date(Math.ceil(enHoras(25).getTime() / 1800000) * 1800000).toISOString();
  const out = await executeTool("agendar_cita", { descripcion: "visita", tipo: "visita", fecha_hora_iso: iso, ref: "ARR1" }, c);
  assert.strictEqual(c.lead.cita.estado, "propuesta");
  assert.strictEqual(c.lead.cita.operacion, undefined);
  assert.ok(c.lead.cita.corte_at, "con plazo para confirmar");
  assert.ok(new Date(c.lead.cita.corte_at).getTime() >= Date.now() + 2 * 3600 * 1000 - 5000, "nunca antes de 2 h despues del pedido");
  assert.ok(new Date(c.lead.cita.corte_at).getTime() < new Date(iso).getTime());
  assert.match(out, /SOLICITADA/);
  assert.match(out, /con el propietario/);
  assert.match(out, /a más tardar (hoy|mañana|el )/);
  assert.doesNotMatch(out, /qued[oó] confirmada|queda confirmada/i);
});

test("la escalera rota una cita de arriendo vieja (creada con 6 h): la anticipación se midió al crearla", () => {
  const { pasoDeEscalera } = require("../src/scheduler/citas-escalera");
  const creada = "2026-10-07T13:00:00Z"; // 08:00 Bogota
  const lead = {
    id: "lv",
    cita: { estado: "propuesta", asesor_id: "a1", creada_at: creada, asignada_at: creada, fecha_hora: "2026-10-07T21:00:00Z", corte_at: "2026-10-07T17:00:00Z", operacion: "arriendo" },
  };
  const p = pasoDeEscalera({ lead, ciclo: [{ ...A1 }, { ...A2 }], citasOrg: [], ahora: new Date("2026-10-07T14:30:00Z") });
  assert.strictEqual(p.accion, "rotar");
  assert.strictEqual(p.nuevo.id, "a2");
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
  // Juan, 2026-10-21: desde el dia siguiente porque se confirma con el propietario.
  for (const [quien, p] of [["cliente", cliente], ["colega", colega]]) {
    assert.match(p, /necesitamos confirmar con el propietario, por eso te propongo desde mañana/, quien);
    assert.match(p, /ahora confirmamos la disponibilidad con el propietario/, quien);
    assert.match(p, /a mas tardar en el plazo que te devuelve agendar_cita/, quien);
  }
  assert.match(cliente, /36\. Registrar la cita NO la confirma: queda SOLICITADA\. .*propietario/);
});

test("la descripción de agendar_cita ya no dice que Sofi no ofrece horarios", () => {
  const tool = TOOL_DEFINITIONS.find((x) => x.name === "agendar_cita");
  assert.doesNotMatch(tool.description, /no escoges un espacio/);
  assert.match(tool.description, /horarios_disponibles/);
});
