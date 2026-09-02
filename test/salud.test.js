// Los chequeos de salud (src/data/salud.js). Cada uno nace de una falla real
// del 2026-09-02 que nadie vio hasta que alguien noto un sintoma.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const RUTA = (m) => require.resolve(path.join("..", "src", m));
const memory = require("../src/data/memory");

const ORG = "org-1";
const AHORA = new Date("2026-09-02T20:00:00Z");
const hace = (horas) => new Date(AHORA.getTime() - horas * 3600 * 1000).toISOString();

let equipo = [];
// advisors se mockea: listElegibles en memoria tiene reglas propias (activo,
// recibe_transferencias) que no son lo que se prueba aca.
require.cache[RUTA("data/advisors.js")] = { exports: { listElegibles: async () => equipo } };
delete require.cache[RUTA("data/salud.js")];
const salud = require("../src/data/salud");

function limpiar() {
  memory.leads.length = 0;
  memory.conversations.length = 0;
  memory.messages.length = 0;
  memory.groupSignals.length = 0;
  equipo = [];
}

function conversacion(id, phone, modo = "bot") {
  memory.leads.push({ id: `lead-${id}`, org_id: ORG, phone });
  memory.conversations.push({ id, org_id: ORG, lead_id: `lead-${id}`, modo });
  return id;
}
function mensaje(conversation_id, role, content, horasAtras, extra = {}) {
  memory.messages.push({ conversation_id, role, content, created_at: hace(horasAtras), ...extra });
}

beforeEach(limpiar);

// 1. Conversacion muda — caso 573245934862, 49 dias.
test("conversacionesMudas: modo humano con el cliente esperando mas de 2 h", async () => {
  const c = conversacion("c1", "573245934862", "humano");
  mensaje(c, "assistant", "te comunico con el asesor", 50);
  mensaje(c, "user", "Hola", 3);
  mensaje(c, "user", "Tienes propiedades en Envigado", 2.5);

  const r = await salud.conversacionesMudas(ORG, { ahora: AHORA });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].phone, "573245934862");
  assert.ok(r[0].horas >= 2);
});

test("conversacionesMudas: si el asesor ya respondio, o el cliente escribio hace poco, no es noticia", async () => {
  const a = conversacion("c1", "573000000001", "humano");
  mensaje(a, "user", "hola", 5);
  mensaje(a, "assistant", "ya te atiendo", 4);
  const b = conversacion("c2", "573000000002", "humano");
  mensaje(b, "user", "hola", 0.5);
  const c = conversacion("c3", "573000000003", "bot");
  mensaje(c, "user", "hola", 10);

  assert.deepStrictEqual(await salud.conversacionesMudas(ORG, { ahora: AHORA }), []);
});

// 2. Ventanas — caso Catherine, 7 dias cerrada, 45 mensajes al vacio.
test("ventanasAsesoras: avisa a las 20 h y marca cerrada a las 24 h", async () => {
  equipo = [
    { id: "a1", name: "Natalia", phone: "573001878024" },
    { id: "a2", name: "Catherine", phone: "573028536489" },
    { id: "a3", name: "Danna", phone: "573011880668" },
  ];
  mensaje(conversacion("cn", "573001878024"), "user", "Sofy", 2);
  mensaje(conversacion("cc", "573028536489"), "user", "hola", 22);
  mensaje(conversacion("cd", "573011880668"), "user", "hola", 171);

  const r = await salud.ventanasAsesoras(ORG, { ahora: AHORA });
  assert.deepStrictEqual(
    r.map((v) => [v.name, v.cerrada]),
    [["Catherine", false], ["Danna", true]],
    "Natalia (2 h) no aparece; Catherine (22 h) esta por cerrar; Danna (171 h) esta cerrada"
  );
});

test("ventanasAsesoras: una asesora que nunca escribio esta cerrada", async () => {
  equipo = [{ id: "a1", name: "Nueva", phone: "573009999999" }];
  const r = await salud.ventanasAsesoras(ORG, { ahora: AHORA });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].cerrada, true);
  assert.strictEqual(r[0].horas, null);
});

// 3. Duplicados — caso David Holguin, 0,26 s.
test("duplicadosRecientes: dos identicos al mismo numero en menos de 2 min", async () => {
  const c = conversacion("c1", "573001878024");
  mensaje(c, "assistant", "🎯 Oportunidad en un grupo", 0.2);
  mensaje(c, "assistant", "🎯 Oportunidad en un grupo", 0.199);
  mensaje(c, "assistant", "Otro aviso distinto", 0.1);

  const r = await salud.duplicadosRecientes(ORG, { ahora: AHORA });
  assert.strictEqual(r.length, 1);
});

test("duplicadosRecientes: el mismo texto a OTRO numero, o mas de 2 min despues, no cuenta", async () => {
  const a = conversacion("c1", "573001878024");
  const b = conversacion("c2", "573028536489");
  mensaje(a, "assistant", "igual", 0.5);
  mensaje(b, "assistant", "igual", 0.49);
  mensaje(a, "assistant", "igual", 0.3);

  assert.deepStrictEqual(await salud.duplicadosRecientes(ORG, { ahora: AHORA }), []);
});

// 4. Rechazos de Meta — caso pair rate limit, 4 avisos perdidos.
test("fallidosRecientes: agrupa por error en la ultima hora", async () => {
  const c = conversacion("c1", "573001878024");
  mensaje(c, "assistant", "a", 0.9, { delivery: "failed", delivery_error: "(#131056) pair rate limit hit" });
  mensaje(c, "assistant", "b", 0.8, { delivery: "failed", delivery_error: "(#131056) pair rate limit hit" });
  mensaje(c, "assistant", "c", 0.7, { delivery: "sent" });
  mensaje(c, "assistant", "d", 5, { delivery: "failed", delivery_error: "viejo, fuera de la hora" });

  const r = await salud.fallidosRecientes(ORG, { ahora: AHORA });
  assert.deepStrictEqual(r, [{ error: "(#131056) pair rate limit hit", cantidad: 2 }]);
});

// 5. Pedido atascado — Sofi encontro algo y no salio por ningun lado.
test("senalesAtascadas: con refs utiles, sin DM ni aviso, pasados 15 min", async () => {
  memory.groupSignals.push(
    { id: "s1", org_id: ORG, clase: "demanda", autor_nombre: "Melissa", created_at: hace(0.5), matches: [{ ref: "1" }],
      revalidacion: { refs_utiles: ["1"], refs_dudosas: [] }, respondida_at: null, aviso_wamid: null, enviado_at: null },
    // ya salio el aviso
    { id: "s2", org_id: ORG, clase: "demanda", autor_nombre: "Zully", created_at: hace(0.5), matches: [{ ref: "2" }],
      revalidacion: { refs_utiles: ["2"], refs_dudosas: [] }, respondida_at: null, aviso_wamid: "w", enviado_at: hace(0.4) },
    // Sofi no encontro nada: callarse es correcto
    { id: "s3", org_id: ORG, clase: "demanda", autor_nombre: "Jaime", created_at: hace(0.5), matches: [{ ref: "3" }],
      revalidacion: { refs_utiles: [], refs_dudosas: [] }, respondida_at: null, aviso_wamid: null, enviado_at: null },
    // muy reciente, todavia esta en curso
    { id: "s4", org_id: ORG, clase: "demanda", autor_nombre: "Nuevo", created_at: hace(0.05), matches: [{ ref: "4" }],
      revalidacion: { refs_utiles: ["4"], refs_dudosas: [] }, respondida_at: null, aviso_wamid: null, enviado_at: null }
  );

  const r = await salud.senalesAtascadas(ORG, { ahora: AHORA });
  assert.deepStrictEqual(r.map((s) => s.id), ["s1"]);
});

// El resumen redactado que consume el vigilante.
test("problemas: junta todo con claves estables por tipo", async () => {
  const c = conversacion("c1", "573245934862", "humano");
  mensaje(c, "user", "Hola", 3);
  equipo = [{ id: "a1", name: "Catherine", phone: "573028536489" }];
  mensaje(conversacion("cc", "573028536489"), "user", "hola", 22);

  const p = await salud.problemas(ORG, { ahora: AHORA });
  assert.deepStrictEqual(p.map((x) => x.clave).sort(), ["muda:c1", "ventana:573028536489"]);
  assert.ok(p.find((x) => x.clave === "ventana:573028536489").texto.includes("cierra en 2 h"));
});

test("problemas: un chequeo que revienta no calla a los demas", async () => {
  memory.groupSignals.push({ id: "roto", org_id: ORG, clase: "demanda", created_at: "no-es-fecha", matches: null, revalidacion: null });
  const c = conversacion("c1", "573245934862", "humano");
  mensaje(c, "user", "Hola", 3);

  const p = await salud.problemas(ORG, { ahora: AHORA });
  assert.ok(p.some((x) => x.clave === "muda:c1"));
});
