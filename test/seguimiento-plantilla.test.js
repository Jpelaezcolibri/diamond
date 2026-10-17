// Fase 2 del seguimiento de Sofi (Juan, 2026-10-17: "necesitamos que se
// haga seguimiento a todos los mensajes que enviemos"). Pasada la ventana de
// 24 h solo se puede escribir con plantilla: un toque a las 48 h de silencio y
// otro a los 7 dias, nunca a quien dijo que no, nunca de noche.

const { test } = require("node:test");
const assert = require("node:assert");
const seg = require("../src/scheduler/seguimiento-plantilla");

const H = 3600e3;
const ahora = new Date("2026-10-20T15:00:00Z"); // 10 a. m. Bogota

const conv = (extra = {}) => ({
  id: "conv-1", whatsapp_phone_id: null,
  lead: { id: "lead-1", phone: "573123460960", source: "whatsapp", estado: "en_conversacion", property_ref_origen: "10414675", seguimiento: {} },
  ultimo: { role: "assistant", created_at: new Date(ahora - 50 * H).toISOString() },
  ultimoCliente: { content: "Hola, me interesa la propiedad 10414675", created_at: new Date(ahora - 10 * 24 * H).toISOString() },
  ...extra,
});

test("a las 48 h de silencio toca el primer seguimiento", () => {
  assert.strictEqual(seg.pasoPendiente(conv(), ahora), "t48");
});

test("antes de 48 h no toca nada", () => {
  assert.strictEqual(seg.pasoPendiente(conv({ ultimo: { role: "assistant", created_at: new Date(ahora - 30 * H).toISOString() } }), ahora), null);
});

test("si el cliente hablo de ultimo, Sofi le debe respuesta: no es seguimiento", () => {
  assert.strictEqual(seg.pasoPendiente(conv({ ultimo: { role: "user", created_at: new Date(ahora - 50 * H).toISOString() } }), ahora), null);
});

test("el segundo toque va 7 dias despues del primero, y despues nada mas", () => {
  const t48 = new Date(ahora - 8 * 24 * H).toISOString();
  const c = conv({ lead: { ...conv().lead, seguimiento: { t48_sent_at: t48 } }, ultimo: { role: "assistant", created_at: t48 } });
  assert.strictEqual(seg.pasoPendiente(c, ahora), "t7d");
  const c2 = conv({ lead: { ...conv().lead, seguimiento: { t48_sent_at: t48, t7d_sent_at: new Date(ahora - H).toISOString() } } });
  assert.strictEqual(seg.pasoPendiente(c2, ahora), null);
});

test("nunca a quien dijo que no", () => {
  for (const no of ["Hola no mi estimada ya conseguí gracias", "No gracias", "I already have another apartment.", "ya no me interesa", "ya compré"]) {
    assert.strictEqual(seg.pasoPendiente(conv({ ultimoCliente: { content: no, created_at: conv().ultimoCliente.created_at } }), ahora), null, no);
  }
});

test("ni a colegas, ni a asesores, ni a chats transferidos o cerrados", () => {
  for (const lead of [{ source: "colega" }, { source: "asesor" }, { estado: "transferido" }, { estado: "cerrado" }, { estado: "perdido" }]) {
    assert.strictEqual(seg.pasoPendiente(conv({ lead: { ...conv().lead, ...lead } }), ahora), null, JSON.stringify(lead));
  }
});

test("el contexto de la plantilla sale de lo que pidio el cliente", () => {
  assert.strictEqual(seg.contextoDe({ property_ref_origen: "10414675" }), "la propiedad ref 10414675");
  assert.strictEqual(seg.contextoDe({ tipo_interes: "apartamento", zona_interes: "El Poblado" }), "apartamento en El Poblado");
  assert.strictEqual(seg.contextoDe({ zona_interes: "Envigado" }), "propiedad en Envigado");
  assert.strictEqual(seg.contextoDe({}), "tu próxima propiedad");
});

function deps(convs, extra = {}) {
  const llamadas = { plantillas: [], mensajes: [], marcas: [] };
  return {
    llamadas,
    d: {
      orgs: async () => [{ id: "org-1", name: "Diamond" }],
      candidatos: async () => convs,
      enviar: async (org, tel, plantilla) => { llamadas.plantillas.push({ tel, plantilla }); return { ok: true, wamid: "w1" }; },
      registrar: async (convId, texto) => { llamadas.mensajes.push({ convId, texto }); },
      marcar: async (leadId, paso) => { llamadas.marcas.push({ leadId, paso }); return true; },
      ...extra,
    },
  };
}

test("runOnce manda la plantilla, deja el mensaje en el chat y marca el paso", async () => {
  seg._reset();
  const { d, llamadas } = deps([conv()]);
  const r = await seg.runOnce({ ahora, deps: d });
  assert.strictEqual(r.enviados, 1);
  assert.strictEqual(llamadas.plantillas[0].tel, "573123460960");
  assert.strictEqual(llamadas.plantillas[0].plantilla.name, "seguimiento_cliente");
  assert.deepStrictEqual(llamadas.plantillas[0].plantilla.bodyParams, ["la propiedad ref 10414675"]);
  assert.match(llamadas.mensajes[0].texto, /la propiedad ref 10414675/);
  assert.deepStrictEqual(llamadas.marcas[0], { leadId: "lead-1", paso: "t48" });
});

test("si el envio falla no se marca (se reintenta en la proxima vuelta)", async () => {
  seg._reset();
  const { d, llamadas } = deps([conv()], { enviar: async () => ({ ok: false, error: "template not approved" }) });
  await seg.runOnce({ ahora, deps: d });
  assert.strictEqual(llamadas.marcas.length, 0);
  assert.strictEqual(llamadas.mensajes.length, 0);
});

test("de noche no sale nada", async () => {
  seg._reset();
  const { d, llamadas } = deps([conv()]);
  await seg.runOnce({ ahora: new Date("2026-10-21T03:00:00Z"), deps: d }); // 10 p. m. Bogota
  assert.strictEqual(llamadas.plantillas.length, 0);
});

test("con el interruptor apagado no sale nada", async (t) => {
  seg._reset();
  process.env.SOFI_SEGUIMIENTO_PLANTILLA = "false";
  t.after(() => delete process.env.SOFI_SEGUIMIENTO_PLANTILLA);
  const { d, llamadas } = deps([conv()]);
  await seg.runOnce({ ahora, deps: d });
  assert.strictEqual(llamadas.plantillas.length, 0);
});

// Caso real (dry-run 2026-10-17): +593980300880 dijo "ya consegui gracias" y
// despues "Ok listo gracias". Mirando solo el ultimo mensaje, le llegaba el
// seguimiento igual. El "no" puede estar en cualquiera de los ultimos.
test("un 'no' en cualquiera de los ultimos mensajes del cliente cierra el seguimiento", () => {
  const c = conv({
    ultimoCliente: { content: "Ok listo gracias", created_at: conv().ultimoCliente.created_at },
    ultimosCliente: [{ content: "Ok listo gracias" }, { content: "Hola no mi estimada ya conseguí gracias" }],
  });
  assert.strictEqual(seg.pasoPendiente(c, ahora), null);
});
