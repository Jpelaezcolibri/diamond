// CANCELAR SIEMPRE CAMBIA EL REGISTRO (Juan, 2026-09-04), aunque el aviso al
// colega falle. Una agenda que miente es el problema que esto viene a
// arreglar: no se puede dejar sin cancelar porque no pudimos escribir.
//
// La cascada del aviso: linea oficial de Sofi (donde el colega ya habla,
// sujeta a la ventana de 24 h de Meta) -> linea de Natalia por WAHA (sin
// ventana, y un numero que el colega conoce de los grupos) -> alerta al
// equipo.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const RUTA = (m) => require.resolve(path.join("..", "src", m));

let leadGuardado = null;
let busquedas = [];
let enviosOficial = [];
let enviosWaha = [];
let alertas = [];
let oficialFalla = false;
let wahaFalla = false;

// El doble de `leads` esconde por construccion si la funcion real existe y con
// que firma — de ahi que test/leads-find-by-id.test.js cargue el modulo de
// verdad. Aca solo se verifica lo que ESTE modulo controla: que llame con las
// dos partes (orgId, leadId).
function instalar(citaInicial, { telefono = "573147815403" } = {}) {
  // La alerta al equipo sale a RADAR_WATCHDOG_TO — el mismo canal que ya usan
  // src/lib/mensaje-asesor.js y src/scheduler/radar-watchdog.js. Bajo `node
  // --test` nadie carga el .env (config.js, que es quien llama a dotenv, no
  // entra en el grafo de este modulo) y ademas el .env local no trae la
  // variable: sin esta linea la cascada llega hasta el final y no alerta a
  // nadie. Se fija aca por lo mismo que lo hacen test/radar-watchdog.test.js y
  // test/notificar-fallo-comando.test.js. Un solo numero: el test cuenta 1.
  process.env.RADAR_WATCHDOG_TO = "573001112233";

  leadGuardado = null;
  busquedas = [];
  enviosOficial = [];
  enviosWaha = [];
  alertas = [];

  require.cache[RUTA("data/leads.js")] = {
    exports: {
      findById: async (orgId, id) => {
        busquedas.push({ orgId, id });
        return { id: "lead-1", nombre: "Miguel", phone: telefono, cita: citaInicial };
      },
      update: async (id, patch) => { leadGuardado = patch; return { id, ...patch }; },
    },
  };
  require.cache[RUTA("channels/whatsapp.js")] = {
    exports: {
      sendWhatsApp: async (org, to, texto) => {
        enviosOficial.push({ to, texto });
        return oficialFalla ? { ok: false, error: "ventana cerrada" } : { ok: true, wamid: "wm-1" };
      },
    },
  };
  require.cache[RUTA("lib/waha.js")] = {
    exports: {
      enviarDm: async (sesion, telefono, texto, opts) => {
        enviosWaha.push({ telefono, texto, lid: opts && opts.lid });
        return wahaFalla ? { ok: false, error: "sin sesion" } : { ok: true, wamid: "wm-2" };
      },
    },
  };
  require.cache[RUTA("lib/mensaje-asesor.js")] = {
    exports: { enviarYRegistrar: async (org, to, texto) => { alertas.push({ to, texto }); return { ok: true }; } },
  };

  delete require.cache[RUTA("groups/cancelar-cita.js")];
  return require("../src/groups/cancelar-cita");
}

beforeEach(() => { oficialFalla = false; wahaFalla = false; });

const ORG = { id: "org-1", name: "Diamond" };
const CITA = { fecha_hora: "2026-09-10T15:00:00-05:00", tipo: "visita", estado: "confirmada", ref: "9702941" };

test("cancela, deja el estado en cancelada y avisa por la linea oficial", async () => {
  const mod = instalar(CITA);
  const r = await mod.cancelar(ORG, "lead-1", { motivo: "la propiedad ya no esta disponible" });
  assert.strictEqual(r.resultado, "cancelada");
  assert.strictEqual(r.aviso, "oficial");
  assert.strictEqual(leadGuardado.cita.estado, "cancelada");
  assert.strictEqual(enviosOficial.length, 1);
  assert.match(enviosOficial[0].texto, /cancel/i);
  assert.strictEqual(enviosWaha.length, 0, "no se molesta a la linea de Natalia si la oficial funciono");
});

test("con la ventana cerrada cae a la linea de Natalia", async () => {
  oficialFalla = true;
  const mod = instalar(CITA);
  const r = await mod.cancelar(ORG, "lead-1", { motivo: "x", sesion: "RADA-NATALIA" });
  assert.strictEqual(r.resultado, "cancelada");
  assert.strictEqual(r.aviso, "linea_natalia");
  assert.strictEqual(enviosWaha.length, 1);
});

// Lo mas importante del modulo: el registro cambia IGUAL.
test("si los dos canales fallan, la cita queda cancelada y se alerta al equipo", async () => {
  oficialFalla = true;
  wahaFalla = true;
  const mod = instalar(CITA);
  const r = await mod.cancelar(ORG, "lead-1", { motivo: "x", sesion: "RADA-NATALIA" });
  assert.strictEqual(r.resultado, "cancelada");
  assert.strictEqual(r.aviso, "no_se_pudo");
  assert.strictEqual(leadGuardado.cita.estado, "cancelada", "el registro cambia aunque nadie se entere");
  assert.strictEqual(alertas.length, 1);
  assert.match(alertas[0].texto, /no le pudimos avisar/i);
});

test("una cita ya cancelada no se vuelve a cancelar ni se reavisa", async () => {
  const mod = instalar({ ...CITA, estado: "cancelada" });
  const r = await mod.cancelar(ORG, "lead-1", { motivo: "x" });
  assert.strictEqual(r.resultado, "ya_cancelada");
  assert.strictEqual(enviosOficial.length, 0);
});

// Multi-tenant: el lead se busca dentro de la org que pidio la cancelacion,
// nunca por id suelto (misma convencion que el resto de src/data).
test("busca el lead con (orgId, leadId)", async () => {
  const mod = instalar(CITA);
  await mod.cancelar(ORG, "lead-1", { motivo: "x" });
  assert.deepStrictEqual(busquedas, [{ orgId: "org-1", id: "lead-1" }]);
});

// EL FALLBACK EXISTE PARA ESTE CASO (medicion de produccion, 2026-09-04): 9 de
// cada 10 colegas de los grupos no exponen telefono, WhatsApp los presenta con
// un @lid. Sin pasarle { lid } a WAHA, el chatId sale como `<lid>@c.us` y el
// aviso no llega justo a la mayoria — el fallback quedaba decorativo.
test("si el phone del lead es un lid, el fallback sale por lid y no como telefono", async () => {
  oficialFalla = true;
  const mod = instalar(CITA, { telefono: "126493275858472" }); // 15 digitos: no es un celular colombiano
  const r = await mod.cancelar(ORG, "lead-1", { motivo: "x", sesion: "RADA-NATALIA" });
  assert.strictEqual(r.aviso, "linea_natalia");
  assert.strictEqual(enviosWaha.length, 1);
  assert.strictEqual(enviosWaha[0].lid, "126493275858472");
  // No se mandan los dos: la guarda de waha.js exige que un lid entre SOLO por
  // la opcion explicita, nunca por `telefono` (mismo criterio que vivo.js).
  assert.ok(!enviosWaha[0].telefono, `no puede ir tambien como telefono: ${enviosWaha[0].telefono}`);
});

test("con un celular colombiano real el fallback sigue saliendo por telefono", async () => {
  oficialFalla = true;
  const mod = instalar(CITA, { telefono: "573147815403" });
  await mod.cancelar(ORG, "lead-1", { motivo: "x", sesion: "RADA-NATALIA" });
  assert.strictEqual(enviosWaha[0].telefono, "573147815403");
  assert.strictEqual(enviosWaha[0].lid, undefined, "un telefono real no viaja como lid");
});

// Regla del mensaje blanqueado: al colega nunca se le nombra a Diamond.
test("el mensaje al colega no nombra a Diamond", async () => {
  const mod = instalar(CITA);
  await mod.cancelar(ORG, "lead-1", { motivo: "x" });
  assert.ok(!/diamond/i.test(enviosOficial[0].texto), enviosOficial[0].texto);
});
