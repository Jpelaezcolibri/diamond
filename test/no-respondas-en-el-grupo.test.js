// Invariante estructural: ningun modulo puede decirle a un asesor/colega que
// responda EN EL GRUPO gremial.
//
// POR QUE EXISTE. Juan fijo la norma el 2026-08-22: el gremio pide no llenar
// los grupos de informacion, asi que los pedidos se responden al PRIVADO del
// colega, nunca en el grupo. El primer commit que aplico la norma
// (alerta-asesor.js, aviso-cercano.js) lo dice explicito en su propio
// comentario: "cada motivo nuevo era un hueco nuevo". Una revision posterior
// (2026-08-24) encontro que la frase vieja seguia viva en OTROS TRES caminos
// (resumen-equipo.js, y dos avisos en notifications/advisor.js) que nadie
// habia tocado porque el fix original solo paso por los dos archivos donde
// arranco el problema.
//
// Un grep manual no alcanza: hace falta que quede en la suite, igual que
// group-canal.test.js hace con la garantia de "el canal no tiene via de
// salida propia" (ver la nota ahi). Sin esto, el proximo aviso que alguien
// escriba a mano puede reintroducir "respondele en el grupo" y nadie se
// entera hasta que el gremio se queje de nuevo.
//
// Se recorre TODO src/, no una lista de archivos: la garantia es "en ningun
// modulo", y una lista fija se desactualiza el dia que aparece un aviso
// nuevo en un archivo que hoy no existe.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "src");

// Mismo criterio que group-canal.test.js#soloCodigo: solo se pisan lineas
// que son comentario de punta a punta. Las notas historicas de arriba (y las
// de contacto.js, alerta-asesor.js, advisor.js, resumen-equipo.js que
// explican el cambio citando la frase vieja entre comillas) quedan afuera del
// analisis sin falsos positivos.
function soloCodigo(fuente) {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

// Sin tildes: cubre "respondele", "responde", "respondé" (y cualquier otra
// conjugacion) seguido de "en el grupo", venga con o sin acento.
function sinTildes(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const PROHIBIDO = /responde\w*\s+en el grupo/i;

function archivosJs(dir) {
  let resultado = [];
  for (const nombre of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, nombre.name);
    if (nombre.isDirectory()) resultado = resultado.concat(archivosJs(p));
    else if (nombre.isFile() && nombre.name.endsWith(".js")) resultado.push(p);
  }
  return resultado;
}

test("ningun modulo de src/ le dice al asesor que responda en el grupo (fuera de comentarios historicos)", () => {
  const infractores = [];
  for (const archivo of archivosJs(SRC)) {
    const codigo = sinTildes(soloCodigo(fs.readFileSync(archivo, "utf8")));
    if (PROHIBIDO.test(codigo)) infractores.push(path.relative(path.join(__dirname, ".."), archivo));
  }
  assert.deepStrictEqual(
    infractores,
    [],
    `Norma de Juan (2026-08-22): los pedidos se responden al privado del colega, nunca en el grupo. ` +
      `Usa tocarNombreEnGrupo() de src/lib/contacto.js en vez de escribir la instruccion a mano. ` +
      `Archivo(s) con la frase prohibida: ${infractores.join(", ")}`
  );
});

// ── Extension (C1, revision 2026-08-24) ─────────────────────────────────────
//
// "responde en el grupo" no fue el unico hueco: promptAsesor (src/agent/
// prompts.js) mapeaba un simple "dale"/"mandalo" respondiendo al aviso del
// radar a "usa aprobar_pedido_radar — publica DIRECTO en el grupo". El aviso
// real ya no pregunta "¿lo publicamos?" (norma del gremio, Juan 2026-08-22),
// asi que ese "dale" es la asesora confirmando que ELLA le va a escribir al
// colega por privado — no una autorizacion para que Sofi publique. El grep de
// "responde... en el grupo" no lo vio porque el verbo ahi es "publica", no
// "responde".
//
// Por que esto se limita a prompts + descripciones de tools (no a TODO src/
// como el test de arriba): el motor determinista de grupos (src/groups/*.js)
// SI publica de verdad en modo automatico, y sus comentarios/strings de
// runtime dicen "publica en el grupo" por decenas en un sentido legitimo
// (describen lo que el motor hace, no le ordenan nada a ningun modelo). Un
// grep de "publica...grupo" sobre TODO src/ contra ese texto es puro ruido.
// Lo que sí hay que blindar es el texto que un modelo LEE COMO INSTRUCCION:
// los prompts de src/agent/prompts.js y src/agent/sofi-comando-prompts.js, y
// las "description" de las tools que ofrecen publicar (src/agent/tools.js,
// src/agent/sofi-comando-tools.js).
//
// Publicar en el grupo NO es en si mismo el problema — aprobar_pedido_radar
// existe justo para eso, como ACCION EXCEPCIONAL (aprobarManual desde el CRM,
// o el admin pidiendolo explicito en Sofi-Comando). Por eso solo se marca
// infractor si la orden de publicar NO viene acompañada, cerca, de una marca
// que la encuadre como excepcion deliberada (excepcional/explicit*/"el
// admin") — sin esa marca es una orden lisa y llana para el caso normal, que
// es exactamente el patron que rompio la norma.
const ARCHIVOS_PROMPTS_LLM = ["src/agent/prompts.js", "src/agent/sofi-comando-prompts.js"];
const ARCHIVOS_TOOLS_DEF = ["src/agent/tools.js", "src/agent/sofi-comando-tools.js"];

// Imperativo "publica"/"publicalo"/"publicala" (NO "publicar" infinitivo, que
// en este codigo se usa casi siempre para describir umbrales o el motor
// automatico, nunca para ordenarle algo a un modelo).
const ORDENA_PUBLICAR = /\bpublica(?:lo|la)?\b[^.\n]{0,60}\ben (?:el|ese|un) grupo/gi;
const MARCA_EXCEPCION = /excepcional|explicit|el admin/i;
// "esa NUNCA se publica en un grupo" es una PROHIBICION, no una orden — sin
// esto el mismo verbo ("publica") que sirve para prohibir se marcaria como
// si estuviera ordenando lo contrario.
const NEGACION_PREVIA = /\b(nunca|jamas|no|sin)\b[^.\n]{0,25}$/i;
const VENTANA_EXCEPCION = 400;

function ordenesDePublicarSinCalificar(texto) {
  const encontradas = [];
  let m;
  ORDENA_PUBLICAR.lastIndex = 0;
  while ((m = ORDENA_PUBLICAR.exec(texto))) {
    const antes = texto.slice(Math.max(0, m.index - 30), m.index);
    if (NEGACION_PREVIA.test(antes)) continue;
    const desde = Math.max(0, m.index - VENTANA_EXCEPCION);
    const hasta = Math.min(texto.length, m.index + m[0].length + VENTANA_EXCEPCION);
    if (!MARCA_EXCEPCION.test(texto.slice(desde, hasta))) encontradas.push(m[0]);
  }
  return encontradas;
}

// Extrae solo el texto de los campos "description" de TOOL_DEFINITIONS: es lo
// unico de estos dos archivos que el modelo lee como instruccion. El resto
// (executeTool, mensajes de resultado) son respuestas sobre un hecho ya
// ocurrido, no ordenes.
function descripcionesDeTools(codigo) {
  const out = [];
  const re = /description:\s*\n?\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(codigo))) out.push(m[1]);
  return out;
}

test("ningun prompt ni descripcion de tool le ordena al modelo publicar en un grupo sin marcarlo como excepcion deliberada", () => {
  const infractores = [];

  for (const rel of ARCHIVOS_PROMPTS_LLM) {
    const codigo = soloCodigo(fs.readFileSync(path.join(__dirname, "..", rel), "utf8"));
    if (ordenesDePublicarSinCalificar(codigo).length > 0) infractores.push(rel);
  }

  for (const rel of ARCHIVOS_TOOLS_DEF) {
    const codigo = soloCodigo(fs.readFileSync(path.join(__dirname, "..", rel), "utf8"));
    const infractorAqui = descripcionesDeTools(codigo).some((d) => ordenesDePublicarSinCalificar(d).length > 0);
    if (infractorAqui) infractores.push(rel);
  }

  assert.deepStrictEqual(
    infractores,
    [],
    `Norma de Juan (2026-08-22): publicar en un grupo es una accion EXCEPCIONAL, nunca la respuesta por ` +
      `defecto a un "si"/"dale". Si de verdad hace falta ofrecer esa accion, marcala explicitamente como ` +
      `excepcional/explicita (ver aprobar_pedido_radar en src/agent/tools.js). ` +
      `Archivo(s) con una orden de publicar sin calificar: ${infractores.join(", ")}`
  );
});

// Regresion puntual: el texto exacto que tenia el bug de C1 (2026-08-24) tiene
// que seguir marcandose como infractor si alguna vez vuelve.
test("el texto viejo de C1 ('publica DIRECTO en el grupo' sobre un simple sí) se sigue detectando", () => {
  const viejo = `CUANDO RESPONDE A UN AVISO (ej "si", "mandalo", "dale", "publicalo"): usa aprobar_pedido_radar — publica DIRECTO en el grupo por la via del bot, citando el pedido original.`;
  assert.ok(ordenesDePublicarSinCalificar(viejo).length > 0, "el detector deberia marcar este texto como infractor");
});
