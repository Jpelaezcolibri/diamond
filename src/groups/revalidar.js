// Sofi mira lo que el motor encontro y da su veredicto.
//
// POR QUE EXISTE. El motor de matching es determinista: compara zona por token,
// precio por banda, alcobas, area. Eso es bueno —es auditable y no alucina— pero
// no entiende matices: no sabe que "para inversion" cambia lo que sirve, ni que
// un pedido de finca en Llano Grande no se resuelve con un apartamento aunque el
// precio calce.
//
// Este modulo agrega una segunda opinion sobre las MISMAS candidatas, con dos
// propositos:
//
//   1. FILTRAR. A Catherine solo le llega lo que Sofi aprueba. El puntaje deja
//      de ser quien decide a quien se le escribe.
//   2. CALIBRAR. Sofi ve TODAS las candidatas, tambien las de puntaje bajo, y
//      se le pide explicitamente que marque cuando el puntaje se equivoco. Sin
//      eso solo aprenderiamos de los falsos positivos; los falsos negativos —el
//      pedido bueno que el umbral descarto— son invisibles y son los caros.
//
// Se guarda el veredicto entero en `group_signals.revalidacion`. Comparado
// contra el puntaje y contra lo que Catherine termina haciendo, eso es el dato
// con el que se ajusta el umbral con evidencia en vez de intuicion.
//
// NO decide si se publica en el grupo. En modo asistido no se publica nada.

const config = require("../config");
const { getClient } = require("../lib/anthropic");

// Sonnet y no Haiku a proposito: esto es juicio, no extraccion, y el volumen es
// bajo (solo demandas que ya trajeron al menos una candidata). El clasificador
// barato ya hizo el trabajo de volumen.
const MODELO = process.env.CLAUDE_MODEL_REVALIDAR || config.claudeModel;

const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  required: ["es_pedido_real", "sirve_alguna", "refs_utiles", "por_que", "confianza", "desacuerdo_con_puntaje"],
  properties: {
    es_pedido_real: {
      type: "boolean",
      description: "¿Es realmente un colega buscando algo para un cliente? No lo es un saludo, una oferta, ni un comentario.",
    },
    sirve_alguna: {
      type: "boolean",
      description: "¿Alguna de las propiedades listadas le sirve de verdad a ese pedido?",
    },
    refs_utiles: {
      type: "array",
      items: { type: "string" },
      description: "Las refs que si sirven, de la mas util a la menos. Vacio si ninguna.",
    },
    por_que: {
      type: "string",
      description: "En una o dos frases y en lenguaje natural: por que sirve (o por que no). Esto lo va a leer una asesora, no un log.",
    },
    confianza: { type: "number", description: "0 a 1." },
    desacuerdo_con_puntaje: {
      type: "string",
      description:
        "Vacio si coincidis con el puntaje. Si NO, explica en que se equivoco: una de puntaje alto que no sirve, o una de puntaje bajo que si. Esto se usa para calibrar el motor.",
    },
  },
};

const SISTEMA = `Sos Sofi, la asistente inmobiliaria de Diamond en Medellin. Un colega
de otra inmobiliaria publico un pedido en un grupo gremial y nuestro motor
encontro algunas propiedades nuestras que podrian servirle.

Tu trabajo es dar el veredicto: ¿el pedido es real y alguna propiedad sirve?

Como juzgar:
- Pensa como una asesora con experiencia, no como un filtro. El motor ya
  comparo zona, precio, area y alcobas; vos aportas el criterio que el no tiene.
- Una propiedad "sirve" si se la mostrarias a ese cliente sin que te de pena.
  Que calce en los numeros no alcanza: una finca no reemplaza un apartamento,
  y una propiedad para vivir no es lo mismo que una para inversion.
- El puntaje que ves va de 55 a 100 y premia cuanto del pedido se pudo
  VERIFICAR, no que tan buena es la propiedad. Un puntaje bajo puede ser una
  gran opcion sobre la que sabemos poco. No lo tomes como verdad.
- LA ZONA NO ES UN SI O NO, es tu criterio. Quien pide El Poblado muchas veces
  compra en Envigado: son contiguos y el mismo cliente se mueve entre los dos.
  Cada candidata te dice como calza su ubicacion. Una "zona VECINA" puede servir
  perfectamente — decilo en 'por_que' para que la asesora lo sepa de entrada
  ("queda en Envigado, pegado al Poblado"). Una "FUERA de la zona pedida" casi
  nunca sirve, pero si todo lo demas calza muy bien y el cliente no fue
  tajante, evaluala en vez de descartarla de plano.
- Si el pedido nombra varias zonas, cualquiera de ellas cuenta como pedida.
- Si el motor se equivoco —aprobo algo que no sirve, o dejo abajo algo que si—
  decilo en 'desacuerdo_con_puntaje'. Eso es lo que nos permite mejorarlo.
- Ante la duda, decidi que NO sirve. Escribirle a una asesora por algo que no
  era le cuesta tiempo y le quita credibilidad al sistema.

'por_que' lo va a leer Catherine, la asesora que va a llamar al colega: escribilo
para ella, corto y concreto.`;

function formatearCandidatas(matches) {
  return (matches || [])
    .map((m, i) => {
      const datos = [
        `ref ${m.ref}`,
        m.operacion,
        m.zona,
        m.precio,
        m.area,
        m.habitaciones ? `${m.habitaciones} alcobas` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      const razones = (m.razones || []).join("; ");
      return `${i + 1}. [puntaje ${m.puntaje}] ${m.titulo || "Sin titulo"}\n   ${datos}\n   el motor dice: ${razones}`;
    })
    .join("\n");
}

/**
 * @param clasificado  la demanda extraida por classify.js, con su `mensaje`
 * @param matches      TODAS las candidatas del motor, con puntaje bajo incluido
 * @returns {veredicto, uso} — veredicto es null si la llamada fallo (falla
 *          cerrada: sin veredicto no se le escribe a nadie)
 */
async function revalidar(clasificado, matches) {
  if (!matches || matches.length === 0) return { veredicto: null, uso: null };

  const m = clasificado.mensaje || {};
  const pedido = [
    `Lo que escribio el colega: "${m.texto || ""}"`,
    ``,
    `Lo que entendio el motor:`,
    `- operacion: ${clasificado.operacion || "no dice"}`,
    `- tipo: ${clasificado.tipo || "no dice"}`,
    `- zona: ${clasificado.zona || "no dice"}${clasificado.ciudad ? ` (${clasificado.ciudad})` : ""}`,
    `- presupuesto: ${clasificado.precio_max ? `hasta $${Number(clasificado.precio_max).toLocaleString("es-CO")}` : "no dice"}`,
    `- alcobas: ${clasificado.habitaciones || "no dice"}`,
    `- area minima: ${clasificado.area_min ? `${clasificado.area_min} m²` : "no dice"}`,
    clasificado.notas ? `- notas: ${clasificado.notas}` : null,
    ``,
    `Nuestras propiedades candidatas:`,
    formatearCandidatas(matches),
  ]
    .filter((l) => l !== null)
    .join("\n");

  try {
    const res = await getClient().messages.create({
      model: MODELO,
      max_tokens: 1000,
      system: SISTEMA,
      output_config: { format: { type: "json_schema", schema: ESQUEMA } },
      messages: [{ role: "user", content: pedido }],
    });
    const texto = res.content.find((b) => b.type === "text")?.text || "";
    return { veredicto: JSON.parse(texto), uso: res.usage || {} };
  } catch (e) {
    // Falla cerrada: sin veredicto no se le escribe a nadie. Perder una
    // oportunidad cuesta menos que mandarle ruido a la asesora.
    console.error("[radar] Sofi no pudo revalidar:", e.message);
    return { veredicto: null, uso: null, error: e.message };
  }
}

/** ¿El veredicto habilita avisarle a la asesora? */
function apruebaAviso(veredicto) {
  return Boolean(
    veredicto &&
      veredicto.es_pedido_real &&
      veredicto.sirve_alguna &&
      Array.isArray(veredicto.refs_utiles) &&
      veredicto.refs_utiles.length > 0
  );
}

module.exports = { revalidar, apruebaAviso, formatearCandidatas, MODELO, ESQUEMA };
