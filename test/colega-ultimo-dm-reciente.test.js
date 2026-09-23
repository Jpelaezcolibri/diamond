// Caso Freddy, 2026-09-22: el radar le mando la 9953099 y la 10013440 a las
// 3:08 p. m. por la linea del radar; a las 3:10 le escribio "Hola" a Sofi y
// ella le pregunto por "esas dos opciones" — las del 7-sep, que estaban en el
// historial del chat. Las refs nuevas estaban en el prompt, pero sin fecha y
// sin decir que eran lo mas reciente.

const { test } = require("node:test");
const assert = require("node:assert");
const { buildSystemPrompt } = require("../src/agent/prompts");

const org = { id: "org-1", name: "Diamond" };
const colega = { nombre: "Freddy" };

function contexto(ultimoPedido) {
  const bloques = buildSystemPrompt({ org, lead: {}, qualified: false, now: null, colega, ultimoPedido });
  return bloques[bloques.length - 1].text;
}

test("las refs del ultimo DM salen con la fecha y hora en Colombia", () => {
  const texto = contexto({
    texto_original: "Viva solicita apto 2 o 3 alcobas sector Robledo, presupuesto 230 millones",
    respuesta_refs: ["9953099", "10013440"],
    respondida_at: "2026-09-22T20:08:47.895Z",
  });
  assert.match(texto, /REFERENCIAS QUE LE RESPONDIMOS \(por DM desde la linea del radar, el 22 de septiembre a las 3:08\sp\.\sm\.\)/);
  assert.match(texto, /9953099, 10013440/);
  assert.match(texto, /MAS RECIENTE/);
});

test("sin respondida_at el bloque sale igual, sin fecha inventada", () => {
  const texto = contexto({ texto_original: "busco apto", respuesta_refs: ["123"], respondida_at: null });
  assert.match(texto, /REFERENCIAS QUE LE RESPONDIMOS: 123\./);
});

test("la regla estable le dice que el DM no esta en el historial y que manda sobre lo viejo", () => {
  const estable = buildSystemPrompt({ org, lead: {}, qualified: false, now: null, colega, ultimoPedido: null })[0].text;
  assert.match(estable, /NO estan en el historial de este chat/);
  assert.match(estable, /nunca de propiedades mas viejas/);
});
