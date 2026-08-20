// El aviso que recibe quien revisa lo que el radar NO publicó solo. Dos
// motivos posibles, unidos en un solo aviso (vivo.js#avisarCercano):
//
//   1. Match de calidad COMPLETA que no salió porque el grupo todavía está
//      en modo escucha (responde=false) — nunca porque el dato o el puntaje
//      fueran el problema.
//   2. Match que falló SOLO por quedar bajo el umbral de puntaje (nunca por
//      zona equivocada ni por ser propiedad de un aliado: esos jamás se
//      avisan, con o sin aprobación humana — ver publicable.js).
//
// Juan, 2026-08-20: "necesito que catherine uribe reciba que se envió y que
// no y por que no para que ella apruebe desde su celular" → después
// corregido a que sea el celular de Natalia Vélez, la misma línea vinculada
// al radar, "para no perder la trazabilidad" — si ella aprueba, se publica
// por la MISMA vía auditada (vivo.js#aprobarManual), no por una identidad
// distinta. Ampliado el mismo día: "tenemos que crear una norma que no se
// salte ninguno de los dos" — ni el camino automático ni el humano pueden
// dejar pasar un match real.
//
// Distinto de alerta-asesor.js (que depende del veredicto de Sofi en modo
// asistido, hoy apagado): acá no hay juicio de IA, solo el puntaje crudo del
// motor — el juicio lo pone la persona.

const formato = require("../lib/formato");

function ficha(match) {
  const titulo = formato.normalizarTitulo(match.titulo) || `Ref ${match.ref || "sin ref"}`;
  const datos = [match.zona, formato.formatearPrecio(match.precio)].filter(Boolean).join(" · ");
  return `▸ Ref ${match.ref} — ${titulo} (${match.puntaje}%)${datos ? `\n  ${datos}` : ""}`;
}

/**
 * @param señal      { grupo_nombre, autor_nombre, texto_original }
 * @param candidatas matches que fallaron SOLO por puntaje_bajo (dato limpio)
 * @returns el texto del aviso, o null si no hay nada que decir
 */
function construir(señal, candidatas) {
  if (!Array.isArray(candidatas) || candidatas.length === 0) return null;

  return [
    `🔔 Tenés un match del radar que no salió solo — ¿lo publicamos?`,
    ``,
    `Grupo: ${señal.grupo_nombre || "sin nombre"}`,
    `Colega: ${señal.autor_nombre || "un colega"}`,
    ``,
    `Pidió:`,
    `"${(señal.texto_original || "").trim()}"`,
    ``,
    candidatas.length === 1 ? `Lo que tenemos:` : `Lo que tenemos:`,
    candidatas.map(ficha).join("\n"),
    ``,
    `Si te parece que sirve, respondeme "sí" y lo publico en el grupo citando el pedido original.`,
  ].join("\n");
}

module.exports = { construir, ficha };
