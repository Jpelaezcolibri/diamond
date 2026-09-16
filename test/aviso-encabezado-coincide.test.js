// El encabezado que Sofi espera tiene que ser el que el aviso manda.
//
// POR QUE EXISTE (auditoria del prompt, 2026-09-15). rechazar_pedido_radar se
// describia a si misma como la respuesta a un aviso "Tenés un match del radar
// que no salió solo". Ese texto no existe: aviso-cercano.js manda "Un pedido
// del radar no salió solo — te toca responder vos". Sofi elige la herramienta
// leyendo la descripcion, asi que una cita equivocada es un disparador que
// apunta a un mensaje que nunca llega.
//
// El test no fija el encabezado a mano: lo SACA del aviso real. Si mañana
// cambia la redaccion del aviso y nadie actualiza la descripcion, esto falla
// — que es justo lo que no paso la vez anterior.
const { test } = require("node:test");
const assert = require("node:assert");

const avisoCercano = require("../src/groups/aviso-cercano");
const { TOOL_DEFINITIONS } = require("../src/agent/tools");

const SEÑAL = { grupo_nombre: "PEDIDOS INMOBILIARIOS", autor_nombre: "Ricardo Hdz", texto_original: "Busco apto en Laureles" };
const CANDIDATA = { ref: "9778098", titulo: "Apartamento en Ciudad del Río", zona: "Ciudad Del Río", precio: "$780.000.000", habitaciones: 3 };

// La primera linea del aviso, sin el emoji: es lo que una persona reconoce y
// lo que la descripcion de la herramienta tiene que citar.
function encabezadoDelAviso() {
  const texto = avisoCercano.construir(SEÑAL, [CANDIDATA], null);
  assert.ok(texto, "el aviso tiene que construirse para poder leer su encabezado");
  return texto.split("\n")[0].replace(/^[^\p{L}]+/u, "").trim();
}

test("el encabezado del aviso es el que dice el aviso, no uno inventado", () => {
  assert.strictEqual(encabezadoDelAviso(), "Un pedido del radar no salió solo — te toca responder vos");
});

test("rechazar_pedido_radar cita el encabezado real del aviso", () => {
  const def = TOOL_DEFINITIONS.find((d) => d.name === "rechazar_pedido_radar");
  assert.ok(def, "rechazar_pedido_radar debe estar declarada");
  // Solo la parte antes del guion: la descripcion no tiene por que repetir la
  // linea entera, pero lo que cite tiene que existir en el aviso.
  const nucleo = encabezadoDelAviso().split(" — ")[0];
  assert.ok(
    def.description.includes(nucleo),
    `la descripcion cita un aviso que no existe. Esperaba encontrar "${nucleo}" en:\n${def.description}`
  );
});
