// Un asesor de la casa escribiéndole a Sofi por WhatsApp.
//
// Caso real (2026-07-29): Natalia escribió "hola buenas tardes" y Sofi le
// contestó "¿Qué tipo de propiedad estás buscando hoy?" — le habló como si
// fuera una clienta que vio un anuncio, y le dejó un lead falso en el embudo.
// Por ese mismo chat le llegan los avisos de los pedidos de los grupos, así
// que confundirla con una clienta rompe el circuito entero.
const { test } = require("node:test");
const assert = require("node:assert");
const { buildSystemPrompt } = require("../src/agent/prompts");
const { mismoTelefono, buscarEnLista } = require("../src/data/advisors");

const org = { id: "org-1", name: "Diamond Inmobiliaria" };
const lead = { id: "l1", estado: "nuevo" };
const natalia = { id: "a1", name: "Natalia Velez", especialidad: "venta" };

const texto = (bloques) => bloques.map((b) => b.text).join("\n");

test("con un asesor, Sofi NO arranca el discurso de ventas", () => {
  const p = texto(buildSystemPrompt({ org, lead, qualified: false, now: null, advisor: natalia }));
  assert.match(p, /NO es un cliente/);
  assert.match(p, /NUNCA le ofrezcas propiedades/);
  assert.match(p, /en que lo podes ayudar/i);
  // Lo que rompía el caso real: pedir presupuesto y ofrecer un asesor.
  assert.match(p, /NUNCA le preguntes presupuesto/);
  assert.match(p, /NUNCA le ofrezcas "conectarlo con un asesor"/);
  assert.doesNotMatch(p, /ESTADO DE CALIFICACION/);
});

test("el asesor se nombra en el prompt: Sofi lo saluda por su nombre", () => {
  const p = texto(buildSystemPrompt({ org, lead, qualified: false, now: null, advisor: natalia }));
  assert.match(p, /Natalia Velez/);
});

test("sin asesor, el prompt de cliente de siempre queda intacto", () => {
  const p = texto(buildSystemPrompt({ org, lead, qualified: false, now: null }));
  assert.match(p, /ESTADO DE CALIFICACION/);
  assert.doesNotMatch(p, /NO es un cliente/);
});

test("el bloque estable sigue cacheado (el prompt de asesor no rompe el ahorro)", () => {
  const b = buildSystemPrompt({ org, lead, qualified: false, now: null, advisor: natalia });
  assert.deepStrictEqual(b[0].cache_control, { type: "ephemeral" });
});

// ── Reconocimiento del número ────────────────────────────────────────────
//
// Se prueba la regla pura: es la que decide si Sofi te habla como cliente o
// como compañero, y no puede depender de que haya base de datos.

const equipo = [
  { id: "a1", name: "Natalia", phone: "+57 300 187 8024", activo: true },
  { id: "a2", name: "Andres", phone: "3009998877", activo: true },
  { id: "a3", name: "Ex asesor", phone: "573001112233", activo: false },
];

test("BUG: el teléfono se compara por los últimos 10 dígitos, no como string", () => {
  // La tabla guarda el número como lo cargó cada quien; WhatsApp siempre manda
  // el internacional sin signos. Comparar tal cual fallaba justo con los
  // asesores más viejos, que es a quienes peor les cae el trato de cliente.
  assert.strictEqual(buscarEnLista(equipo, "573001878024").name, "Natalia");
  assert.strictEqual(buscarEnLista(equipo, "573009998877").name, "Andres");
  assert.ok(mismoTelefono("+57 300 187 8024", "573001878024"));
  assert.ok(mismoTelefono("3001878024", "57 300 187 8024"));
});

test("un cliente cualquiera NO se confunde con un asesor", () => {
  assert.strictEqual(buscarEnLista(equipo, "573155554444"), null);
});

test("un asesor inactivo tampoco es un cliente", () => {
  assert.strictEqual(buscarEnLista(equipo, "573001112233").name, "Ex asesor");
});

test("BUG real 2026-08-18: dos filas con el mismo telefono (una activa, una no) — gana la activa, no la que aparezca primero", () => {
  // Catherine Uribe tenia dos filas con +573028536489: una vieja (creada en
  // julio, sin recibe_transferencias) y una nueva con login de CRM que es la
  // que de verdad recibe los avisos del radar. La consulta a Supabase
  // devolvia la vieja primero, sin ningun criterio de por medio — asi que
  // cuando ELLA le escribia a Sofi, ctx.advisor.id nunca coincidia con el id
  // guardado en sus avisos y registrar_resultado_radar siempre decia "no
  // tengo nada pendiente". Remediado con datos (se desactivo la fila vieja)
  // + este fix de codigo, para que la ambiguedad no dependa solo del dato.
  const conDuplicado = [
    { id: "vieja", name: "Catherine Uribe", phone: "573028536489", activo: false },
    { id: "nueva", name: "Catherine Uribe", phone: "573028536489", activo: true },
  ];
  assert.strictEqual(buscarEnLista(conDuplicado, "573028536489").id, "nueva");

  // Aunque la vieja quedara primera en la lista (orden de la consulta, no
  // garantizado), sigue ganando la activa.
  assert.strictEqual(buscarEnLista([...conDuplicado].reverse(), "573028536489").id, "nueva");
});

test("un número corto, vacío o nulo no matchea nada", () => {
  for (const v of ["", null, undefined, "123", "8024"]) {
    assert.strictEqual(buscarEnLista(equipo, v), null, `matcheó con ${JSON.stringify(v)}`);
    assert.strictEqual(mismoTelefono(v, "573001878024"), false);
  }
});

test("dos números distintos que terminan parecido no colisionan", () => {
  assert.strictEqual(mismoTelefono("573001878024", "573001878025"), false);
});

test("el prompt desarma el historial viejo donde Sofi le hablaba como clienta", () => {
  // Verificado en produccion: Claudia (sin historial) recibio "¡Hola Claudia!
  // ¿En que te puedo ayudar?", pero Natalia —con 12 mensajes previos de trato
  // comercial— siguio recibiendo "¿que estas buscando?". El modelo imita su
  // propio historial, asi que hay que decirle explicitamente que lo ignore.
  const p = texto(buildSystemPrompt({ org, lead, qualified: false, now: null, advisor: natalia }));
  assert.match(p, /HISTORIAL CONTAMINADO/);
  assert.match(p, /NO los continues/);
});
