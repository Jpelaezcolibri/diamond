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
//
// SIN_CONFIRMAR (Juan, 2026-08-24): de 13 pedidos descartados medidos en
// produccion, 10 eran incompatibles de verdad (otra zona, otro edificio) pero
// 3 se perdieron solo porque el inventario no tiene un dato que el pedido
// menciona (terraza, antiguedad). El veredicto ahora distingue INCOMPATIBLE
// (no sirve) de INCOMPLETO (sirve, con un hueco que se declara) -- ver el
// campo 'sin_confirmar' en el esquema y el criterio en el prompt de SISTEMA.
// Un veredicto viejo guardado antes de esta fecha no trae este campo: quien
// lo lea debe tratar su ausencia como lista vacia, nunca como error.
//
// LE_FALTA (Juan, 2026-08-24, caso Edwin Ramirez / grupo SOLO Envigado): es
// OTRA cosa que sin_confirmar y la diferencia importa. sin_confirmar es "no
// sabemos el dato"; le_falta es "sabemos el dato y NO cumple", pero es una
// sola cosa accesoria de un pedido largo. El colega pidio Envigado, hasta
// $980M, 3 alcobas, 98 m², 2 baños, 2 garajes y cuarto util; la ref 10077095
// cumplia TODO salvo el segundo garaje y Sofi la descarto. Juan: "al menos el
// apartamento de el portal si se podia enviar con la aclaracion de que solo
// le falta un parqueadero de todo el pedido". Esa decision es del colega, no
// nuestra -- lo unico que nos toca es no ocultarle el hueco.
//
// A diferencia de sin_confirmar (que es global: el inventario no registra
// terraza para NINGUNA), le_falta es POR PROPIEDAD -- una puede tener los dos
// garajes y otra no. Por eso viaja como {ref, detalle} y la aclaracion se
// imprime dentro de la ficha de esa propiedad, no en el encabezado.
const config = require("../config");
const { getClient } = require("../lib/anthropic");

// Sonnet y no Haiku a proposito: esto es juicio, no extraccion, y el volumen es
// bajo (solo demandas que ya trajeron al menos una candidata). El clasificador
// barato ya hizo el trabajo de volumen.
const MODELO = process.env.CLAUDE_MODEL_REVALIDAR || config.claudeModel;

const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "es_pedido_real",
    "sirve_alguna",
    "refs_utiles",
    "por_que",
    "confianza",
    "desacuerdo_con_puntaje",
    "sin_confirmar",
    "le_falta",
  ],
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
      description:
        "Las refs que si sirven, de la mas util a la menos. Vacio si ninguna. Incluye las que calzan del todo, las " +
        "INCOMPLETAS (calzan en lo verificable pero falta un dato que el inventario no registra -> 'sin_confirmar') " +
        "y las CASI (cumplen todo salvo una sola cosa accesoria, que si conocemos -> 'le_falta'). Ninguno de esos " +
        "dos huecos descarta la propiedad: se declaran.",
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
    // CASO REAL (Juan, 2026-08-24): colega pidio apto en Envigado con terraza,
    // piso bajo y max 6 años de antiguedad. Habia 3 propiedades propias con
    // match del 100% en zona/alcobas/precio, pero el inventario no registra
    // terraza/piso/antiguedad -- Sofi las descarto por eso y el colega nunca
    // supo que existian. Este campo es lo que evita perder ESE tipo de
    // oportunidad: lista lo que el pedido menciona y el inventario no puede
    // confirmar para las refs_utiles, para que el mensaje lo diga honesto en
    // vez de que la propiedad se pierda o (peor) se afirme un dato inventado.
    sin_confirmar: {
      type: "array",
      items: { type: "string" },
      description:
        "Datos que el pedido menciona pero que NINGUNA de las refs_utiles tiene registrados en el inventario " +
        "(ej: 'terraza', 'antigüedad', 'piso bajo'). Cada item corto, en palabras que un colega entienda. Vacio si " +
        "no falta nada. Un dato aca NUNCA es motivo para sacar la propiedad de refs_utiles -- es la diferencia " +
        "entre mentir (afirmar algo que no se sabe) y ser honesto sobre un hueco.",
    },
    // CASO REAL (Juan, 2026-08-24 — Edwin Ramirez, grupo SOLO Envigado): ver
    // la nota LE_FALTA arriba. Distinto de sin_confirmar: aca el dato SI se
    // conoce y no cumple. Va por ref porque es una propiedad la que no
    // cumple, no el inventario entero.
    le_falta: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "detalle"],
        properties: {
          ref: { type: "string", description: "La ref de la propiedad, tal como aparece en la lista de candidatas." },
          detalle: {
            type: "string",
            description:
              "En pocas palabras y en tono de aclaración honesta, qué del pedido NO cumple esta propiedad, con el " +
              "dato real y el pedido al lado: 'tiene 1 garaje y pediste 2', 'no tiene cuarto útil'. Sin disculpas " +
              "ni adornos: el colega decide.",
          },
        },
      },
      description:
        "Solo para refs que SI estan en refs_utiles y que incumplen algo ACCESORIO del pedido (ver el criterio en " +
        "las instrucciones). Vacio si todas las refs_utiles cumplen lo que se pudo verificar. Nunca listes aca una " +
        "propiedad que descartaste, ni un dato que simplemente no conocemos (eso es 'sin_confirmar').",
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
  y una propiedad para vivir no es lo mismo que una para inversion. Pero que
  falte un dato que el inventario no registra (terraza, piso, antiguedad), o
  que falte UNA cosa accesoria del pedido (el segundo garaje, el cuarto util),
  NO es motivo de pena si se lo decis con honestidad -- ver las TRES
  situaciones mas abajo.
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
- Hay TRES situaciones distintas y confundirlas es el error mas caro que
  podes cometer aca:
    · INCOMPATIBLE (no sirve, no entra a refs_utiles): otra zona no vecina,
      otro municipio, otro tipo de propiedad (finca por apartamento, local por
      vivienda), fuera de presupuesto, o algo que el cliente pidio como
      innegociable y la propiedad no cumple.
    · INCOMPLETO (SI sirve, entra a refs_utiles): calza en todo lo que se
      puede verificar (zona, tipo, precio, alcobas) pero el pedido menciona
      algo que el inventario no registra -- terraza, piso, antiguedad, vista,
      lo que sea. Eso NO descarta la propiedad: se lista en 'sin_confirmar' y
      el mensaje lo va a decir honestamente ("no tengo confirmado si tiene
      terraza"), en vez de perder una oportunidad real por un dato que ni
      siquiera sabemos si tiene o no. Caso real: colega pidio apto en Envigado
      con terraza y max 6 años de antiguedad; habia 3 propiedades con match
      del 100% en zona/alcobas/precio que se descartaron solo porque el
      inventario no registra terraza ni antiguedad -- el colega nunca supo que
      existian. Eso es exactamente lo que 'sin_confirmar' existe para evitar.
    · CASI (SI sirve, entra a refs_utiles, y ademas se anota en 'le_falta'):
      SABEMOS el dato y la propiedad NO cumple, pero es UNA SOLA cosa y es
      accesoria frente a todo lo que si cumple. Esa decision es del colega, no
      tuya: lo unico que no podes hacer es ocultarle el hueco. Caso real —
      colega pidio Envigado o Poblado, hasta $980M, 3 alcobas mas estudio o 4,
      98 m² minimo, 2 baños, 2 garajes y cuarto util. La ref 10077095 (El
      Portal) cumplia zona, precio, alcobas, area y baños, y solo tenia 1
      garaje en vez de 2: se manda, con 'le_falta' diciendo "tiene 1 garaje y
      pediste 2". En el MISMO pedido, la ref 8989725 tenia 2 alcobas de las 3
      pedidas y 92 m² de los 98: falla en DOS cosas y una es de fondo (las
      alcobas definen el producto), asi que esa NO se manda. Ahi esta la linea.

- Como decidir si un incumplimiento es ACCESORIO o de FONDO:
    · De FONDO, nunca pasa: zona, municipio, tipo de propiedad, operacion,
      presupuesto, y la cantidad de alcobas cuando el faltante cambia el
      producto (un 2 alcobas no resuelve un pedido de 3 o 4).
    · ACCESORIO, puede pasar con su aclaracion: un garaje de menos, el cuarto
      util, un baño de menos, unos pocos m² por debajo del minimo, un detalle
      de acabados o de piso.
    · DOS O MAS incumplimientos conocidos: NO pasa, aunque cada uno por
      separado fuera accesorio. "Le falta un parqueadero" se le ofrece a un
      colega; "le falta un parqueadero, un baño y 6 m²" es hacerle perder el
      tiempo.
    · Si dudas si algo es accesorio o de fondo, tratalo como de fondo.
- Si el motor se equivoco —aprobo algo que no sirve, o dejo abajo algo que si—
  decilo en 'desacuerdo_con_puntaje'. Eso es lo que nos permite mejorarlo.
- Ante la duda sobre si INCOMPATIBLE, decidi que NO sirve. Escribirle a una
  asesora (o a un colega) por algo que no era le cuesta tiempo y le quita
  credibilidad al sistema. Pero un dato que el pedido pide y el inventario
  simplemente no tiene no es motivo de duda sobre si sirve -- es motivo para
  usar 'sin_confirmar', no para descartar.

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

module.exports = { revalidar, apruebaAviso, formatearCandidatas, MODELO, ESQUEMA, SISTEMA };
