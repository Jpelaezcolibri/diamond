// El candado de los mensajes a asesores (Juan, 2026-09-02):
//   "quiero que me quites de los mensajes repetidos [...] mi numero
//    3016981200 retiralo de cualquier bug que este por que me estan llegando
//    mensajes y eso hace que la linea se vuelva mas vulnerable"
//
// Dos reglas, las dos en el unico punto por el que pasan TODOS los mensajes a
// un asesor, para que ninguna via nueva las pueda esquivar sin darse cuenta.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const memory = require("../src/data/memory");
const canalWhatsapp = require("../src/channels/whatsapp");
const mensajeAsesor = require("../src/lib/mensaje-asesor");

const ORG = { id: "org-1", name: "Diamond" };
const NATALIA = "573001878024";
const JUAN = "573016981200";      // dado de baja en advisors (activo=false)
const AVISO = "🎯 Oportunidad en un grupo\n\nGrupo: PEDIDOS 7:00A.M.8:00P.M.\nColega: David Holguín";

let enviados;

beforeEach(() => {
  memory.reset?.();
  // memory.reset() no vacia messages/conversations/leads, y el candado es
  // JUSTAMENTE una memoria de lo ya enviado: sin esto, el aviso de una prueba
  // bloquea el de la siguiente y los fallos parecen del producto.
  memory.messages.length = 0;
  memory.conversations.length = 0;
  memory.leads.length = 0;
  enviados = [];
  canalWhatsapp.sendWhatsApp = async (org, to, texto) => {
    enviados.push({ to, texto });
    return { ok: true, wamid: `wamid.${enviados.length}` };
  };
  memory.advisors.length = 0;
  memory.advisors.push(
    { id: "adv-nat", org_id: ORG.id, name: "Natalia Velez", phone: NATALIA, especialidad: "venta", activo: true },
    { id: "adv-juan", org_id: ORG.id, name: "Juan Carlos Pelaez", phone: JUAN, especialidad: "venta", activo: false }
  );
});

test("un asesor dado de baja NO recibe nada", async () => {
  const r = await mensajeAsesor.enviarYRegistrar(ORG, JUAN, AVISO);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.bloqueado, true);
  assert.strictEqual(enviados.length, 0, "no salio ni un mensaje a la linea dada de baja");
});

test("el mismo texto al mismo asesor no sale dos veces seguidas", async () => {
  const primero = await mensajeAsesor.enviarYRegistrar(ORG, NATALIA, AVISO);
  const segundo = await mensajeAsesor.enviarYRegistrar(ORG, NATALIA, AVISO);

  assert.strictEqual(primero.ok, true);
  assert.ok(primero.wamid, "el primero si sale");
  assert.strictEqual(segundo.duplicado, true, "el segundo se reconoce como repetido");
  assert.strictEqual(enviados.length, 1, "a WhatsApp solo se le mando UNA vez");
});

test("el duplicado tampoco deja una fila de mensaje de mas", async () => {
  await mensajeAsesor.enviarYRegistrar(ORG, NATALIA, AVISO);
  await mensajeAsesor.enviarYRegistrar(ORG, NATALIA, AVISO);
  const filas = memory.messages.filter((m) => m.role === "assistant" && m.content === AVISO);
  assert.strictEqual(filas.length, 1, "en el CRM se ve un solo aviso, no dos");
});

test("un texto DISTINTO al mismo asesor si sale", async () => {
  await mensajeAsesor.enviarYRegistrar(ORG, NATALIA, AVISO);
  await mensajeAsesor.enviarYRegistrar(ORG, NATALIA, AVISO + "\n\nOtra propiedad");
  assert.strictEqual(enviados.length, 2, "el candado es por texto identico, no por asesor");
});

test("el mismo texto a OTRO asesor si sale — el candado es por par (asesor, texto)", async () => {
  memory.advisors.push({ id: "adv-cat", org_id: ORG.id, name: "Catherine Uribe", phone: "573028536489", especialidad: "venta", activo: true });
  await mensajeAsesor.enviarYRegistrar(ORG, NATALIA, AVISO);
  await mensajeAsesor.enviarYRegistrar(ORG, "573028536489", AVISO);
  assert.strictEqual(enviados.length, 2, "cubrir a una companera no es un duplicado");
});

test("permitirRepetido deja pasar un reenvio deliberado", async () => {
  await mensajeAsesor.enviarYRegistrar(ORG, NATALIA, AVISO);
  await mensajeAsesor.enviarYRegistrar(ORG, NATALIA, AVISO, { permitirRepetido: true });
  assert.strictEqual(enviados.length, 2, "hay escape para cuando repetir es a proposito");
});
