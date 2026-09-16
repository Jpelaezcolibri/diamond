// El colega que quiere hablar con una persona sin pedirlo con esas palabras.
//
// POR QUE EXISTE (Juan, 2026-09-15): "si el colega da alguna señal de que solo
// quiere hablar con un asesor, inmediatamente le envias el mensaje a Daiana".
//
// El disparador de pedir_contacto_asesora ya existia, pero solo para el pedido
// EXPLICITO. Ampliarlo choca con la linea que estaba justo encima en el mismo
// prompt: "NUNCA le ofrezcas conectarlo con un asesor por tu cuenta". Frente a
// un colega frustrado que no pidio nada textualmente, ese NUNCA gana y Sofi no
// escala — asi que ampliar el disparador sin tocar esa linea no hace nada.
//
// Caso real del 2026-09-15: Jefferson escribio "Por que se ven fotos de dos
// propiedades diferentes" y agrego que Daiana no le habia respondido los
// mensajes. Ahi no pidio hablar con nadie: se quejo. Eso es una señal.
const { test } = require("node:test");
const assert = require("node:assert");
const { buildSystemPrompt } = require("../src/agent/prompts");

const org = { id: "org-1", name: "Diamond Inmobiliaria" };
const lead = { id: "l1", estado: "nuevo" };
const colega = { nombre: "Jefferson" };

const promptColega = () => buildSystemPrompt({ org, lead, qualified: false, now: null, colega }).map((b) => b.text).join("\n");

test("el prompt del colega lista las señales indirectas de que quiere una persona", () => {
  const p = promptColega();
  // La queja: el caso Jefferson.
  assert.match(p, /se queja de que no le responden/i);
  // La insistencia despues de un "no puedo".
  assert.match(p, /insiste/i);
  // El pedido fuera del alcance de Sofi: corregir un dato en Wasi, la comision.
  assert.match(p, /fuera de tu alcance/i);
});

test("ante la duda, el prompt le manda escalar y no callarse", () => {
  const p = promptColega();
  assert.match(p, /ante la duda,? escala/i);
});

test("la prohibicion de ofrecer asesor no puede seguir siendo absoluta", () => {
  const p = promptColega();
  // Esta es LA contradiccion. Un "NUNCA ... por tu cuenta" sin recorte le gana
  // a la regla de escalar ante una señal indirecta, porque la señal indirecta
  // es justamente el caso en que el colega NO lo pidio.
  assert.doesNotMatch(
    p,
    /NUNCA le ofrezcas "conectarlo con un asesor" por tu cuenta/,
    "la prohibicion tiene que quedar acotada a tratarlo como lead, no a escalar"
  );
  // Y lo que reemplaza: sigue prohibido tratarlo como cliente.
  assert.match(p, /como se le ofrece a un cliente/i);
  // La herramienta sigue siendo la unica via para decir que ya se aviso.
  assert.match(p, /pedir_contacto_asesora/);
  assert.match(p, /Nunca digas que ya avisaste sin haberla usado/);
});
