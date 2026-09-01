// Auditoria de honestidad del Centro de Comando: dos chequeos deterministas,
// sin IA ni I/O, sobre lo que paso en UN turno del loop de tool-use de
// src/agent/sofi-comando.js#processMessage. Mismo patron que
// src/groups/politica.js: funciones puras, testeables exhaustivamente.
//
// SOLO para Sofi-Comando (chat interno). src/agent/engine.js (clientes) y
// src/groups/vivo.js (colegas) NUNCA importan este archivo -- ver
// docs/superpowers/specs/2026-09-01-sofi-comando-auditoria-honestidad-design.md.

// Nota sobre (?!\w): en ECMAScript \b y \w son ASCII-only (identico en
// cualquier SO/version de Node, no es un tema de plataforma). Eso rompe
// \b justo despues de una vocal acentuada (e/i) -- "guard[eé]\b" nunca
// matchea "guarde"/"guardé" porque \b no ve la e/é como "letra". Sacar el
// \b final sin mas soluciona eso pero abre la puerta a falsos positivos por
// substring ("Enviemos", "guarderia"). (?!\w) evita ambos problemas: exige
// que lo que sigue a la vocal NO sea un caracter de palabra ASCII, sin
// depender de que \b reconozca la vocal acentuada como limite.
const PATRONES_CONFIRMACION = [
  /✅/,
  /\bguard[eé](?!\w)/i,
  /\bguardado\b/i,
  /\benvi[eé](?!\w)/i,
  /\bregistr[eé](?!\w)/i,
  /\bregistrado\b/i,
  /listo,?\s+le\s+mand[eé]/i,
  /ya\s+le\s+escrib[ií]/i,
];

function pareceConfirmacion(texto) {
  const t = String(texto || "");
  return PATRONES_CONFIRMACION.some((re) => re.test(t));
}

// "No pude..." (usado en ~15 lugares de src/agent/tools.js y
// sofi-comando-tools.js) y el prefijo generico de excepcion que arma
// sofi-comando.js ("Error ejecutando la herramienta: ...") son las dos formas
// en que el codigo ya dice "algo se rompio de nuestro lado". Deliberadamente
// NO cuentan "Falta...", "Esto solo...", "Esta herramienta..." -- son la
// herramienta pidiendo mas info o rechazando el uso, un flujo normal.
function esFalloDeHerramienta(resultado) {
  const r = String(resultado || "").trim();
  return /^No pude\b/.test(r) || /^Error ejecutando la herramienta:/.test(r);
}

function auditar({ textoFinal, llamadasMutantes = [] } = {}) {
  const fallos = llamadasMutantes.filter((l) => esFalloDeHerramienta(l.resultado));
  const huboExitoMutante = llamadasMutantes.length > fallos.length;
  const sinConfirmar = pareceConfirmacion(textoFinal) && !huboExitoMutante;

  return { sinConfirmar, fallos, notificar: sinConfirmar || fallos.length > 0 };
}

module.exports = { pareceConfirmacion, esFalloDeHerramienta, auditar };
