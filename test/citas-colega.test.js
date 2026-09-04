// Una visita que pide un COLEGA de otra inmobiliaria.
//
// Caso real 2026-09-03: un colega pidio ver un inmueble y Sofi le agendo las
// 4pm. El aviso que salio decia literalmente "Tienes una visita con Fulano
// (+57...) el jueves a las 4:00 p.m." — sin ref, sin direccion, sin precio y
// sin decir siquiera que quien pedia era un colega. Con eso la visita se
// pierde: nadie sabe a que inmueble ir.
//
// Dos causas: la cita no podia llevar propiedad (ctx.propertyInteres esta
// bloqueado a proposito para colegas, y un colega no tiene
// property_ref_origen), y promptColega le decia a Sofi que "no existe una
// herramienta" cuando agendar_cita si estaba en TOOL_DEFINITIONS.
//
// Juan, 2026-09-04: "que todo llegue a Natalia con una alerta enorme con la
// hora y el dia de la visita y copia a catherine, me parece mejor por que
// natalia sera la encargada de todo en esa linea".
//
// Mismo criterio de mock que test/agendar-cita.test.js: advisors/appointments/
// properties/leads tocan Supabase real, se mockean sus metodos desde el
// consumidor (tools.js y advisor.js ven el mismo objeto de modulo por require).

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { executeTool, TOOL_DEFINITIONS } = require("../src/agent/tools");
const { buildColegaAppointmentAlert } = require("../src/notifications/advisor");
const { buildSystemPrompt } = require("../src/agent/prompts");
const advisors = require("../src/data/advisors");
const appointments = require("../src/data/appointments");
const properties = require("../src/data/properties");
const leads = require("../src/data/leads");

const ORG = { id: "org-1", name: "Diamond Inmobiliaria" };
// Natalia: la asesora principal del radar (RADAR_REVISOR_PHONE). Catherine:
// la copia (RADAR_ESCALADO_PHONE).
const NATALIA = { id: "adv-natalia", name: "Natalia Velez", phone: "573001878024", auth_user_id: "uid-natalia", especialidad: "venta", activo: true };
const CATHERINE_PHONE = "573028536489";
const OTRO_ASESOR = { id: "adv-camila", name: "Camila Ruiz", phone: "573009990000", auth_user_id: "uid-camila", especialidad: "venta", activo: true };
const PROPIEDAD = {
  ref: "9702941",
  titulo: "Apartamento en Laureles con balcon",
  zona: "Laureles, Medellin",
  precio: "$460.000.000",
  area: "82m2",
  habitaciones: 3,
  operacion: "Venta",
  link: "https://diamondinmobiliaria.com/inmueble/9702941",
  disponible: true,
};

function ctxColega() {
  return {
    org: ORG,
    lead: { id: "lead-colega", phone: "573112223344", nombre: null, estado: "en_conversacion", score: 0, source: "colega" },
    advisor: null,
    colega: { lid: "123@lid", telefono: "573112223344", nombre: "Esteban Higuita" },
    propertyInteres: null,
    transfer: null,
    cita: null,
    allyMatch: null,
    allyAlert: null,
    appointmentAlert: null,
    captadorAlert: null,
    lastUserMessage: "puedo llevar a mi cliente el jueves a las 4?",
  };
}

function ctxCliente() {
  return {
    org: ORG,
    lead: { id: "lead-1", phone: "573001112233", nombre: "Marta", categoria: "compra", intencion: "comprar", estado: "en_conversacion", score: 0, property_ref_origen: "9702941" },
    advisor: null,
    colega: null,
    propertyInteres: { ref: "9702941", operacion: "Venta" },
    transfer: null,
    cita: null,
    allyMatch: null,
    allyAlert: null,
    appointmentAlert: null,
    captadorAlert: null,
    lastUserMessage: "quiero ver el apto manana a las 3",
  };
}

function mockearAgenda(t, { propiedad = PROPIEDAD, escalado = CATHERINE_PHONE } = {}) {
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => NATALIA);
  t.mock.method(advisors, "findForTransfer", async () => OTRO_ASESOR);
  t.mock.method(appointments, "checkAvailability", async () => ({ disponible: true }));
  t.mock.method(leads, "update", async (id, fields) => ({ id, ...fields }));
  const refsBuscadas = [];
  t.mock.method(properties, "findByRef", async (org, ref) => {
    refsBuscadas.push(ref);
    return propiedad;
  });
  const previo = process.env.RADAR_ESCALADO_PHONE;
  process.env.RADAR_ESCALADO_PHONE = escalado;
  t.after(() => {
    if (previo === undefined) delete process.env.RADAR_ESCALADO_PHONE;
    else process.env.RADAR_ESCALADO_PHONE = previo;
  });
  return { refsBuscadas };
}

// ── (a) Colega que agenda CON ref ─────────────────────────────────────────

test("colega agenda con ref: el aviso va a Natalia con la ficha completa y copia a Catherine", async (t) => {
  mockearAgenda(t);

  const ctx = ctxColega();
  const out = await executeTool(
    "agendar_cita",
    { descripcion: "el jueves a las 4 de la tarde", fecha_hora_iso: "2026-09-10T16:00:00-05:00", tipo: "visita", ref: "9702941" },
    ctx
  );

  assert.match(out, /Cita registrada/);
  assert.ok(ctx.appointmentAlert, "la cita de un colega tambien tiene que avisar");
  assert.strictEqual(ctx.appointmentAlert.advisorPhone, NATALIA.phone, "Natalia es la encargada de esta linea");
  assert.notStrictEqual(ctx.appointmentAlert.advisorPhone, OTRO_ASESOR.phone, "no puede caer en la rotacion normal");
  assert.deepStrictEqual(ctx.appointmentAlert.copias, [CATHERINE_PHONE], "Catherine va en copia del MISMO mensaje");

  const aviso = ctx.appointmentAlert.advisorAlert;
  // Dia y hora bien visibles arriba ("una alerta enorme con la hora y el dia").
  const encabezado = aviso.split("\n").slice(0, 5).join("\n");
  assert.match(encabezado, /jueves/i, "el dia va arriba del todo");
  assert.match(encabezado, /4:00/, "la hora va arriba del todo");
  // Quien pide es un colega, no un cliente propio.
  assert.match(aviso, /COLEGA/);
  assert.match(aviso, /Esteban Higuita/);
  assert.match(aviso, /573112223344/);
  // Ficha completa de la propiedad.
  assert.match(aviso, /9702941/);
  assert.match(aviso, /Apartamento en Laureles con balcon/);
  assert.match(aviso, /Laureles, Medellin/);
  assert.match(aviso, /\$460\.000\.000/);
  assert.match(aviso, /82m2/);
  assert.match(aviso, /3/);
  assert.match(aviso, /diamondinmobiliaria\.com\/inmueble\/9702941/);
  assert.doesNotMatch(aviso, /sin propiedad indicada/);
});

test("colega agenda con ref: la ref queda en la cita, para que no se pierda al persistirla", async (t) => {
  mockearAgenda(t);
  const ctx = ctxColega();
  await executeTool(
    "agendar_cita",
    { descripcion: "el jueves a las 4", fecha_hora_iso: "2026-09-10T16:00:00-05:00", tipo: "visita", ref: "9702941" },
    ctx
  );
  assert.strictEqual(ctx.cita.ref, "9702941");
});

// ── (b) Colega que agenda SIN ref ─────────────────────────────────────────

test("colega agenda sin ref: el aviso sale igual y dice que no hay propiedad indicada", async (t) => {
  const { refsBuscadas } = mockearAgenda(t);

  const ctx = ctxColega();
  await executeTool(
    "agendar_cita",
    { descripcion: "el jueves a las 4 de la tarde", fecha_hora_iso: "2026-09-10T16:00:00-05:00", tipo: "asesoria" },
    ctx
  );

  assert.ok(ctx.appointmentAlert, "sin ref el aviso NO se omite");
  assert.strictEqual(ctx.appointmentAlert.advisorPhone, NATALIA.phone);
  assert.match(ctx.appointmentAlert.advisorAlert, /sin propiedad indicada/i);
  assert.strictEqual(refsBuscadas.length, 0, "sin ref no hay nada que buscar");
});

test("colega agenda con una ref que no existe: lo dice, no inventa la ficha", async (t) => {
  mockearAgenda(t, { propiedad: null });

  const ctx = ctxColega();
  await executeTool(
    "agendar_cita",
    { descripcion: "el jueves a las 4", fecha_hora_iso: "2026-09-10T16:00:00-05:00", tipo: "visita", ref: "0000000" },
    ctx
  );

  assert.ok(ctx.appointmentAlert);
  assert.match(ctx.appointmentAlert.advisorAlert, /sin propiedad indicada/i);
  assert.match(ctx.appointmentAlert.advisorAlert, /0000000/, "igual dice que ref intento el colega");
});

test("si la consulta de la propiedad revienta, el aviso sale igual (best-effort)", async (t) => {
  mockearAgenda(t);
  t.mock.method(properties, "findByRef", async () => {
    throw new Error("supabase caida");
  });

  const ctx = ctxColega();
  await executeTool(
    "agendar_cita",
    { descripcion: "el jueves a las 4", fecha_hora_iso: "2026-09-10T16:00:00-05:00", tipo: "visita", ref: "9702941" },
    ctx
  );

  assert.ok(ctx.appointmentAlert, "un fallo buscando la ficha no puede tumbar el aviso");
  assert.match(ctx.appointmentAlert.advisorAlert, /sin propiedad indicada/i);
});

// ── (c) Sin copia configurada ─────────────────────────────────────────────

test("RADAR_ESCALADO_PHONE vacio: el aviso a Natalia sale igual, sin copias", async (t) => {
  mockearAgenda(t, { escalado: "" });

  const ctx = ctxColega();
  await executeTool(
    "agendar_cita",
    { descripcion: "el jueves a las 4", fecha_hora_iso: "2026-09-10T16:00:00-05:00", tipo: "visita", ref: "9702941" },
    ctx
  );

  assert.ok(ctx.appointmentAlert, "una copia que no se puede mandar no tumba el aviso principal");
  assert.strictEqual(ctx.appointmentAlert.advisorPhone, NATALIA.phone);
  assert.deepStrictEqual(ctx.appointmentAlert.copias, []);
});

test("si la copia es el mismo telefono de Natalia, no se manda dos veces", async (t) => {
  mockearAgenda(t, { escalado: NATALIA.phone });

  const ctx = ctxColega();
  await executeTool(
    "agendar_cita",
    { descripcion: "el jueves a las 4", fecha_hora_iso: "2026-09-10T16:00:00-05:00", tipo: "visita", ref: "9702941" },
    ctx
  );

  assert.deepStrictEqual(ctx.appointmentAlert.copias, []);
});

test("colega sin dia/hora concretos: el aviso igual sale (nunca se lo transfiere, si no se pierde)", async (t) => {
  mockearAgenda(t);

  const ctx = ctxColega();
  await executeTool("agendar_cita", { descripcion: "la otra semana lleva al cliente", tipo: "visita", ref: "9702941" }, ctx);

  assert.ok(ctx.appointmentAlert, "un colega no pasa por transferir_a_asesor: sin este aviso no queda rastro");
  assert.strictEqual(ctx.appointmentAlert.advisorPhone, NATALIA.phone);
  assert.match(ctx.appointmentAlert.advisorAlert, /la otra semana/);
});

// ── (d) El cliente final no cambia ────────────────────────────────────────

test("cliente final: nada cambia — rotacion de siempre, aviso de siempre, sin copias", async (t) => {
  let radarLlamado = false;
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => {
    radarLlamado = true;
    return NATALIA;
  });
  t.mock.method(advisors, "findForTransfer", async () => OTRO_ASESOR);
  t.mock.method(appointments, "checkAvailability", async () => ({ disponible: true }));
  t.mock.method(leads, "update", async (id, fields) => ({ id, ...fields }));
  const previo = process.env.RADAR_ESCALADO_PHONE;
  process.env.RADAR_ESCALADO_PHONE = CATHERINE_PHONE;
  t.after(() => {
    if (previo === undefined) delete process.env.RADAR_ESCALADO_PHONE;
    else process.env.RADAR_ESCALADO_PHONE = previo;
  });

  const ctx = ctxCliente();
  const out = await executeTool(
    "agendar_cita",
    { descripcion: "manana a las 3", fecha_hora_iso: "2026-07-24T15:00:00-05:00", tipo: "visita" },
    ctx
  );

  assert.strictEqual(radarLlamado, false, "el camino del cliente final no pasa por la linea de Natalia");
  assert.strictEqual(ctx.appointmentAlert.advisorPhone, OTRO_ASESOR.phone);
  assert.match(ctx.appointmentAlert.advisorAlert, /Nueva cita agendada/);
  assert.doesNotMatch(ctx.appointmentAlert.advisorAlert, /COLEGA/);
  assert.ok(!ctx.appointmentAlert.copias || ctx.appointmentAlert.copias.length === 0, "un cliente final no genera copias");
  assert.match(out, /Cita registrada/);
});

// ── El builder del aviso, aislado ─────────────────────────────────────────

test("buildColegaAppointmentAlert sin fecha_hora usa la descripcion tal como la dijo el colega", async (t) => {
  t.mock.method(properties, "findByRef", async () => PROPIEDAD);
  const aviso = await buildColegaAppointmentAlert({
    org: ORG,
    colega: { nombre: "Esteban Higuita", telefono: "573112223344" },
    lead: { phone: "573112223344" },
    cita: { descripcion: "el fin de semana", tipo: "visita" },
    ref: "9702941",
  });
  assert.match(aviso, /el fin de semana/);
  assert.match(aviso, /9702941/);
});

test("buildColegaAppointmentAlert deja el link de calendario cuando hay fecha_hora", async (t) => {
  t.mock.method(properties, "findByRef", async () => PROPIEDAD);
  const aviso = await buildColegaAppointmentAlert({
    org: ORG,
    colega: { nombre: "Esteban Higuita", telefono: "573112223344" },
    lead: { phone: "573112223344" },
    cita: { descripcion: "el jueves a las 4", fecha_hora: "2026-09-10T16:00:00-05:00", tipo: "visita" },
    ref: "9702941",
  });
  assert.match(aviso, /calendar\.google\.com/);
});

// ── La tool y el prompt ───────────────────────────────────────────────────

test("agendar_cita acepta ref, y es OPCIONAL (una asesoria general no tiene inmueble)", () => {
  const tool = TOOL_DEFINITIONS.find((t) => t.name === "agendar_cita");
  assert.ok(tool.input_schema.properties.ref, "sin este campo el aviso no puede llevar la ficha");
  assert.strictEqual(tool.input_schema.properties.ref.type, "string");
  assert.ok(!tool.input_schema.required.includes("ref"), "no puede ser obligatoria");
});

test("promptColega ya no dice que no existe herramienta: Sofi SI puede agendar", () => {
  const bloques = buildSystemPrompt({
    org: ORG,
    lead: { id: "l1", estado: "nuevo" },
    qualified: false,
    now: null,
    colega: { nombre: "Esteban Higuita" },
  });
  const p = bloques.map((b) => b.text).join("\n");
  assert.doesNotMatch(p, /no existe una herramienta/i);
  assert.match(p, /agendar_cita/);
  assert.match(p, /\bref\b/);
  // registrar_demanda_colega sigue existiendo para lo que no es una visita.
  assert.match(p, /registrar_demanda_colega/);
});

test("el contacto de quien coordina se INYECTA, no se hardcodea", () => {
  const bloques = buildSystemPrompt({
    org: ORG,
    lead: { id: "l1", estado: "nuevo" },
    qualified: false,
    now: null,
    colega: { nombre: "Esteban Higuita" },
    coordinador: { nombre: "Natalia Velez", telefono: "573001878024" },
  });
  const estable = bloques[0].text;
  const volatil = bloques[bloques.length - 1].text;
  assert.match(volatil, /Natalia Velez/, "va en el bloque volatil, como now y ultimoPedido");
  assert.match(volatil, /573001878024/);
  assert.doesNotMatch(estable, /Natalia/, "nada de Diamond hardcodeado en el bloque cacheado");
  assert.doesNotMatch(estable, /573001878024/);
});

test("sin coordinador resuelto, el contexto no trae ningun contacto que Sofi pueda leer", () => {
  const bloques = buildSystemPrompt({
    org: ORG,
    lead: { id: "l1", estado: "nuevo" },
    qualified: false,
    now: null,
    colega: { nombre: "Esteban Higuita" },
  });
  // El bloque estable NOMBRA la seccion (le dice a Sofi donde mirar y que
  // hacer si no esta); el que no puede existir es el dato en el volatil.
  const volatil = bloques[bloques.length - 1].text;
  assert.doesNotMatch(volatil, /COORDINA LAS VISITAS/);
  assert.match(bloques[0].text, /si abajo no aparece ninguno/i, "el prompt tiene que decirle que hacer cuando no hay contacto");
});

// ── El cableado (engine + canales) ────────────────────────────────────────

const leer = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

test("engine.js resuelve el coordinador con findAsesorPrincipalRadar y se lo pasa al prompt", () => {
  const fuente = leer("src", "agent", "engine.js");
  assert.match(fuente, /findAsesorPrincipalRadar/, "se reusa el resolutor que ya existe, no se inventa otro");
  const i = fuente.indexOf("buildSystemPrompt({");
  assert.ok(i > -1);
  assert.match(fuente.slice(i, i + 300), /coordinador/, "el prompt tiene que recibirlo");
});

test("los canales mandan las copias del aviso de cita", () => {
  for (const canal of ["whatsapp.js", "telegram.js"]) {
    const fuente = leer("src", "channels", canal);
    // `|| []` es la parte retrocompatible: un appointmentAlert viejo, sin
    // copias, tiene que seguir funcionando exactamente igual.
    assert.ok(
      /appointmentAlert\.copias\s*\|\|\s*\[\]/.test(fuente),
      `${canal} tiene que recorrer las copias y seguir funcionando sin ellas`
    );
  }
});
