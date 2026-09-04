// EL ENDPOINT DE SALUD TIENE QUE MEDIR CON LA MISMA REGLA QUE FRENA.
//
// Hallazgo 7 de la revision final (2026-09-04): `/webhook/grupos/estado`
// contaba los DMs desde la MEDIANOCHE LOCAL DEL SERVIDOR -- en un contenedor
// UTC, las 19:00 hora Colombia del dia anterior -- mientras el tope que de
// verdad frena (politica.js#decidirDm, alimentado por vivo.js) usa ventana
// movil de 24 h. El comentario mandaba contrastar ese numero contra la cuota
// de WhatsApp, que ademas es un contador de CICLO MENSUAL: tres relojes
// distintos presentados como si fueran comparables.
const { test } = require("node:test");
const assert = require("node:assert");

const config = require("../src/config");
config.groups.webhookSecret = "secreto-de-prueba";

const organizations = require("../src/data/organizations");
const whatsappGroups = require("../src/data/whatsapp-groups");
const groupSignals = require("../src/data/group-signals");
const waha = require("../src/lib/waha");
const vivo = require("../src/groups/vivo");
const router = require("../src/channels/whatsapp-group");

function rutaDe(path, metodo = "get") {
  const capa = router.stack.find((c) => c.route?.path === path && c.route.methods[metodo]);
  assert.ok(capa, `No existe ${metodo.toUpperCase()} ${path}`);
  return capa.route.stack[capa.route.stack.length - 1].handle;
}

function respuestaFalsa() {
  const r = { codigo: 200, cuerpo: null };
  r.status = (c) => { r.codigo = c; return r; };
  r.json = (b) => { r.cuerpo = b; return r; };
  return r;
}

const pedido = { headers: { "x-api-key": "secreto-de-prueba" } };

async function llamar(t, { cuota = null } = {}) {
  t.mock.method(organizations, "getDefault", async () => ({ id: "org-1", name: "Diamond" }));
  t.mock.method(organizations, "modoDeRespuesta", () => "asistido");
  t.mock.method(whatsappGroups, "listSessions", async () => [{ nombre: "RADA-NATALIA", estado: "activa" }]);
  t.mock.method(waha, "cuotaDeLinea", async () => cuota);
  const desdes = [];
  t.mock.method(groupSignals, "dmsHoyLinea", async (orgId, desde) => { desdes.push(desde); return 7; });

  const res = respuestaFalsa();
  await rutaDe("/webhook/grupos/estado")(pedido, res);
  return { res, desdes };
}

test("el conteo de DMs usa la ventana movil de 24 h, la misma que frena el envio", async (t) => {
  const antes = Date.now();
  const { res, desdes } = await llamar(t);
  const despues = Date.now();

  assert.strictEqual(desdes.length, 1);
  const desdeMs = new Date(desdes[0]).getTime();
  const ventanaMs = vivo.VENTANA_LIMITE_HORAS * 3600 * 1000;
  assert.ok(
    desdeMs >= antes - ventanaMs && desdeMs <= despues - ventanaMs,
    `esperaba hace ${vivo.VENTANA_LIMITE_HORAS} h y llego ${desdes[0]}`
  );
  // La medianoche local seria, casi siempre, mucho mas cerca que 24 h atras.
  const medianoche = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  assert.notStrictEqual(desdeMs, medianoche, "la medianoche local no es la ventana del enforcement");

  // El nombre del campo dice la ventana: nadie tiene que adivinarla.
  assert.strictEqual(res.cuerpo.dmsUltimas24h, 7);
  assert.strictEqual(res.cuerpo.dmsHoy, undefined, "'dmsHoy' no decia que ventana usaba");
  assert.strictEqual(res.cuerpo.dmsVentanaDesde, desdes[0]);
});

test("la cuota de WhatsApp se expone con su ciclo, que es lo que la hace legible", async (t) => {
  const cuota = { usados: 240, total: 300, fraccion: 0.8, cycleStart: "2026-09-01", cycleEnd: "2026-10-01" };
  const { res } = await llamar(t, { cuota });

  // Sin cycleStart/cycleEnd, "240/300" no dice si se gastaron hoy o en tres
  // semanas -- el dato que hay que observar.
  assert.strictEqual(res.cuerpo.cuotaWhatsapp.cycleStart, "2026-09-01");
  assert.strictEqual(res.cuerpo.cuotaWhatsapp.cycleEnd, "2026-10-01");
});
