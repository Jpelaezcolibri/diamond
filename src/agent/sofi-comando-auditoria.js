// Auditoria de honestidad del Centro de Comando: dos chequeos deterministas,
// sin IA ni I/O, sobre lo que paso en UN turno del loop de tool-use de
// src/agent/sofi-comando.js#processMessage. Mismo patron que
// src/groups/politica.js: funciones puras, testeables exhaustivamente.
//
// SOLO para Sofi-Comando (chat interno). src/agent/engine.js (clientes) y
// src/groups/vivo.js (colegas) NUNCA importan este archivo -- ver
// docs/superpowers/specs/2026-09-01-sofi-comando-auditoria-honestidad-design.md.

// Los cinco patrones que terminan en vocal acentuada usan la forma
// ACENTUADA SOLA (nunca [eé]/[ií]): Sofi siempre escribe español con tildes,
// y la forma sin tilde es casi siempre OTRA palabra real -- "guarde"/
// "envie"/"registre"/"mande" son subjuntivo/imperativo ("¿querés que lo
// guarde?"), no una confirmacion. Revision post-merge (2026-09-01): esto
// paso dos rondas de fix sin que nadie lo notara porque los tests solo
// probaban la forma acentuada -- una pregunta real del propio prompt de
// Sofi-Comando ("preguntale si no dio el nombre") caia como falso positivo.
const PATRONES_CONFIRMACION = [
  /✅/,
  /\bguardé(?!\w)/i,
  /\bguardado\b/i,
  /\benvié(?!\w)/i,
  /\bregistré(?!\w)/i,
  /\bregistrado\b/i,
  /listo,?\s+le\s+mandé(?!\w)/i,
  /ya\s+le\s+escribí(?!\w)/i,
];

// Negaciones cercanas (revision 2026-09-01): "aun no lo he guardado" o "no
// se lo envie todavia" NO son una confirmacion -- son Sofi siendo honesta
// sobre que NO hizo algo, justo el comportamiento que esta auditoria quiere
// premiar, no castigar. Se mira una ventana corta ANTES del match (no
// anclada al final: el pronombre clitico -- "no SE LO envie" -- casi
// siempre se mete entre la negacion y el verbo). Deliberadamente amplia:
// ante la duda de si es una negacion real, se prefiere NO notificar a Juan
// (mismo criterio que src/groups/politica.js: "callar es gratis").
const NEGACION_CERCANA = /\b(no|nunca|sin)\b/i;
const VENTANA_NEGACION = 30;

function pareceConfirmacion(texto) {
  const t = String(texto || "");
  for (const patron of PATRONES_CONFIRMACION) {
    const m = patron.exec(t);
    if (!m) continue;
    const antes = t.slice(Math.max(0, m.index - VENTANA_NEGACION), m.index);
    if (NEGACION_CERCANA.test(antes)) continue;
    return true;
  }
  return false;
}

// "No pude..." / "No se pudo..." (sinonimos ya usados indistintamente en
// ~15 lugares de src/agent/tools.js y sofi-comando-tools.js) y el prefijo
// generico de excepcion que arma sofi-comando.js ("Error ejecutando la
// herramienta: ...") son las tres formas en que el codigo ya dice "algo se
// rompio de nuestro lado". Deliberadamente NO cuentan "Falta...",
// "Esto solo...", "Esta herramienta..." -- son la herramienta pidiendo mas
// info o rechazando el uso, un flujo normal.
function esFalloDeHerramienta(resultado) {
  const r = String(resultado || "").trim();
  return /^No pude\b/.test(r) || /^No se pudo\b/.test(r) || /^Error ejecutando la herramienta:/.test(r);
}

// `huboLlamadaDeLectura` (Juan, 2026-09-01): true si en el turno se llamo AL
// MENOS una tool que NO es mutante (consultar_seguimientos,
// trazabilidad_radar, etc.). Distingue el bug original (Sofi confirma sin
// llamar NADA) de Sofi contando la verdad sobre algo de OTRO turno despues
// de consultarlo (recuerdo honesto) -- las dos "suenan" a confirmacion pero
// son casos opuestos, y solo el primero merece molestar a Juan.
function auditar({ textoFinal, llamadasMutantes = [], huboLlamadaDeLectura = false } = {}) {
  const fallos = llamadasMutantes.filter((l) => esFalloDeHerramienta(l.resultado));
  const huboExitoMutante = llamadasMutantes.length > fallos.length;
  const confirma = pareceConfirmacion(textoFinal);

  // El texto confirma y NINGUNA mutante salio bien este turno -- el bug
  // original: nadie ejecuto nada de verdad.
  const sinAccionMutante = confirma && !huboExitoMutante;

  // El texto confirma "de mas" (Juan, 2026-09-01): alguna mutante salio bien
  // pero OTRA fallo, y el texto no lo reconoce -- "les envie a los tres" con
  // uno que fallo. Mas honesto avisar en el chat tambien, no solo por
  // WhatsApp aparte.
  const confirmaDeMas = confirma && fallos.length > 0 && huboExitoMutante;

  const sinConfirmar = sinAccionMutante || confirmaDeMas;

  // Recuerdo honesto (Juan, 2026-09-01): CERO mutantes llamadas pero SI una
  // de lectura, y el texto suena a confirmacion -- Sofi esta contando algo
  // que YA paso (via trazabilidad_radar, consultar_recordatorios, etc.), no
  // mintiendo sobre este turno. El disclaimer del chat se deja igual (barato
  // de mostrar, por las dudas), pero no se molesta a Juan por WhatsApp.
  const esRecuerdo = sinAccionMutante && llamadasMutantes.length === 0 && huboLlamadaDeLectura;

  return {
    sinConfirmar,
    fallos,
    notificar: (sinAccionMutante && !esRecuerdo) || fallos.length > 0,
  };
}

module.exports = { pareceConfirmacion, esFalloDeHerramienta, auditar };
