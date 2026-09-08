// EL CABLEADO REAL DEL WEBHOOK DE DM, DE PUNTA A PUNTA.
//
// Hallazgo I1 de la revision final (2026-09-08): toda la cobertura del
// camino DM era grep sobre el TEXTO del fuente
// (test/group-canal.test.js: `assert.ok(cuerpo.includes("remitenteLid:"))`).
// Se probo: cambiando `remitenteLid: quien.lid` por `remitenteLid: null` en
// src/channels/whatsapp-group.js, la suite entera quedaba en verde. Un grep
// que busca el NOMBRE de un campo pasa igual con el valor equivocado.
//
// Este test mete un body de webhook de WAHA de verdad por el handler del
// router y afirma sobre lo que le llega a dm.procesarMensaje: que el lid
// viaja CON su sufijo y que remitente_telefono queda null.
//
// El handler se saca del stack del router (mismo patron que
// test/radar-estado-ventana.test.js y test/senal-evento-endpoint.test.js) en
// vez de montarlo con supertest: no hay supertest en el repo, no se agrega
// una dependencia por un test, y sacar el handler del stack no agrega ni una
// linea de superficie publica al modulo -- que es lo que si haria exportar
// un `_handler` nuevo.

const { test } = require("node:test");
const assert = require("node:assert");

const config = require("../src/config");
config.groups.webhookSecret = "secreto-de-prueba";

const organizations = require("../src/data/organizations");
const whatsappGroups = require("../src/data/whatsapp-groups");
const dm = require("../src/groups/dm");
const router = require("../src/channels/whatsapp-group");

function rutaDe(path, metodo = "post") {
  const capa = router.stack.find((c) => c.route?.path === path && c.route.methods[metodo]);
  assert.ok(capa, `No existe ${metodo.toUpperCase()} ${path}`);
  return capa.route.stack[capa.route.stack.length - 1].handle;
}

function respuestaFalsa() {
  const r = { codigo: 200, cuerpo: null, headersSent: false };
  r.status = (c) => { r.codigo = c; return r; };
  r.json = (b) => { r.cuerpo = b; r.headersSent = true; return r; };
  return r;
}

// Un webhook de WAHA tal como llega: `from` ES el JID de quien escribe
// cuando el chat es 1 a 1 (no hay `participant` como en un grupo).
function webhook(from, { id, texto = "listo, mañana se la muestro al cliente" } = {}) {
  return {
    headers: { "x-api-key": "secreto-de-prueba" },
    body: {
      event: "message",
      session: "RADA-NATALIA",
      payload: {
        id,
        from,
        body: texto,
        fromMe: false,
        pushName: "Carva",
        // Reciente a proposito: esAnteriorAlCorte descarta todo lo que sea
        // anterior al corte de la sesion, y un mensaje sin fecha tambien.
        timestamp: Math.floor(Date.now() / 1000),
      },
    },
  };
}

// El handler responde 200 y procesa DESPUES, encolado (enqueue). Sin esperar
// a que la cola drene, el assert corre antes que el efecto y el test pasaria
// aunque el procesamiento nunca ocurriera. El doble de dm.procesarMensaje
// resuelve una promesa que el test espera.
async function entregar(t, pedido) {
  let visto;
  const llego = new Promise((resolve) => { visto = resolve; });
  const recibidos = [];

  t.mock.method(organizations, "getDefault", async () => ({ id: "org-1", name: "Diamond" }));
  t.mock.method(whatsappGroups, "sesionPorNombre", async () => ({
    id: "ses-1", nombre: "RADA-NATALIA", advisor_id: "adv-1",
    escucha_desde: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
  }));
  t.mock.method(whatsappGroups, "touchSession", async () => {});
  t.mock.method(dm, "procesarMensaje", async (org, mensaje) => {
    recibidos.push({ org, mensaje });
    visto();
    return { resultado: "guardado", dmId: "dm-1" };
  });

  const res = respuestaFalsa();
  await rutaDe("/webhook/grupos")(pedido, res);
  await llego;
  return { res, recibidos };
}

test("una respuesta por @lid llega a dm.procesarMensaje con el lid CON sufijo y sin telefono", async (t) => {
  const { res, recibidos } = await entregar(t, webhook("276467766300904@lid", { id: "wamid-lid-1" }));

  assert.strictEqual(res.cuerpo?.ok, true, "a WAHA se le responde 200 antes de procesar");
  assert.strictEqual(recibidos.length, 1, "el DM tiene que llegar al inbox pasivo");

  const { org, mensaje } = recibidos[0];
  assert.strictEqual(org.id, "org-1");
  // EL ASSERT QUE IMPORTA: el lid crudo, con su sufijo. Sin el sufijo no se
  // puede distinguir de un telefono, y buscarPorLid compara por igualdad
  // exacta contra group_signals.respuesta_destino_lid, que lo guarda crudo.
  assert.strictEqual(mensaje.remitenteLid, "276467766300904@lid");
  assert.strictEqual(mensaje.remitenteTelefono, null, "un lid NUNCA va donde dice telefono");
  assert.strictEqual(mensaje.remitenteId, "276467766300904@lid");
  assert.strictEqual(mensaje.waMessageId, "wamid-lid-1");
  assert.strictEqual(mensaje.sesion, "RADA-NATALIA");
  assert.strictEqual(mensaje.remitenteNombre, "Carva");
  assert.ok(mensaje.fechaMensaje, "la fecha del mensaje viaja: es de donde sale la antiguedad");
});

test("una respuesta por @c.us llega con el telefono puesto y el lid en null", async (t) => {
  const { recibidos } = await entregar(t, webhook("573001112222@c.us", { id: "wamid-cus-1" }));

  assert.strictEqual(recibidos.length, 1);
  const { mensaje } = recibidos[0];
  assert.strictEqual(mensaje.remitenteTelefono, "573001112222");
  assert.strictEqual(mensaje.remitenteLid, null, "un telefono NUNCA va donde dice lid");
  assert.strictEqual(mensaje.remitenteId, "573001112222@c.us");
});
