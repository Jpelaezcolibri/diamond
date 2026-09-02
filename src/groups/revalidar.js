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
//   1. FILTRAR. A la asesora solo le llega lo que Sofi aprueba. El puntaje deja
//      de ser quien decide a quien se le escribe.
//   2. CALIBRAR. Sofi ve TODAS las candidatas, tambien las de puntaje bajo, y
//      se le pide explicitamente que marque cuando el puntaje se equivoco. Sin
//      eso solo aprenderiamos de los falsos positivos; los falsos negativos —el
//      pedido bueno que el umbral descarto— son invisibles y son los caros.
//
// Se guarda el veredicto entero en `group_signals.revalidacion`. Comparado
// contra el puntaje y contra lo que la asesora termina haciendo, eso es el dato
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
    "refs_dudosas",
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
    // DUDOSA (Juan, 2026-09-01): antes de este campo, una candidata que no
    // era un descarte limpio (INCOMPATIBLE) pero tampoco calzaba lo
    // suficiente para refs_utiles se perdia sin que nadie la viera -- Sofi
    // tenia que forzar un SI o un NO. Este campo es la tercera salida.
    refs_dudosas: {
      type: "array",
      items: { type: "string" },
      description:
        "Refs que NO van en refs_utiles (no se le mandan al colega ni se auto-publican) pero tampoco son un " +
        "descarte limpio -- vale la pena que la asesora decida si llamar al colega igual. Vacio si no hay ninguna. " +
        "Una ref nunca va en refs_utiles y refs_dudosas a la vez.",
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

COMO PENSAR
- Pensa como una asesora con experiencia, no como un filtro. El motor ya
  comparo zona, precio, area, alcobas, baños, garajes y estrato; vos aportas
  el criterio que el no tiene.
- Una propiedad "sirve" si se la mostrarias a ese cliente sin que te de pena.
  Que calce en los numeros no alcanza: una finca no reemplaza un apartamento,
  y una propiedad para vivir no es lo mismo que una para inversion.
- El puntaje va de 55 a 100 y premia cuanto del pedido se pudo VERIFICAR, no
  que tan buena es la propiedad. Un puntaje bajo puede ser una gran opcion
  sobre la que sabemos poco. No lo tomes como verdad.
- Cada candidata te dice su UBICACION respecto de lo pedido. "exacta" y
  "vecina" sirven —quien pide El Poblado muchas veces compra en Envigado,
  son contiguos—; decilo en 'por_que' para que la asesora lo sepa de entrada
  ("queda en Envigado, pegado al Poblado"). "fuera" casi nunca sirve, pero si
  todo lo demas calza muy bien y el cliente no fue tajante, evaluala en vez
  de descartarla de plano. Si el pedido nombra varias zonas, cualquiera cuenta.
- Un dato del pedido que aparece como "no dice" NO es una exigencia: no
  descartes por algo que el colega nunca pidio.
- Si el pedido acepta una alcoba menos (te lo decimos como "alcobas: 3 (acepta
  una menos si tiene estudio)"), 2 alcobas con estudio cumple el pedido de 3.

LAS CUATRO SITUACIONES — confundirlas es el error mas caro que podes cometer

| Situacion | ¿Entra a refs_utiles? | Cuando | Que ademas hacer |
|---|---|---|---|
| INCOMPATIBLE | NO, y tampoco a refs_dudosas | otra zona no vecina, otro municipio, otro tipo de propiedad, otra operacion, fuera de presupuesto, o algo innegociable que no cumple | nada: se descarta |
| INCOMPLETO | SI | calza en todo lo verificable, pero el pedido menciona algo que el inventario NO REGISTRA (terraza, piso, antiguedad, vista) | listar ese dato en 'sin_confirmar' |
| CASI | SI | SABEMOS el dato y NO cumple, pero es UNA SOLA cosa y es ACCESORIA | anotarlo en 'le_falta' con {ref, detalle} |
| DUDOSA | NO, pero SI a 'refs_dudosas' | no es un descarte limpio y tampoco calza con confianza: DOS O MAS incumplimientos accesorios a la vez, o una zona vecina lejana que te genera dudas reales | nada mas: la asesora decide si llamar al colega |

ACCESORIO vs DE FONDO — es la linea que decide CASI contra INCOMPATIBLE
- SOBRAR NO ES FALLAR. Todo esto habla de lo que FALTA. Una propiedad con MAS
  alcobas, MAS baños, MAS garajes o MAS metros de los pedidos CUMPLE: no la
  descartes ni la mandes a dudosas por eso. Quien pide 2 alcobas casi siempre
  acepta 3 si el precio le cuadra, y el precio ya lo verificamos aparte.
  Mencionalo en 'por_que' ("tiene 3 alcobas, una mas de las que pediste") y
  seguí. Lo unico que descalifica es quedarse corto.
- De FONDO, nunca pasa: zona, municipio, tipo de propiedad, operacion,
  presupuesto, y la cantidad de alcobas cuando el FALTANTE cambia el producto
  (un 2 alcobas no resuelve un pedido de 3 o 4).
- ACCESORIO, puede pasar con su aclaracion: un garaje de menos, el cuarto
  util, un baño de menos, unos pocos m² por debajo del minimo, un detalle de
  acabados o de piso.
- DOS O MAS incumplimientos conocidos: NO pasa como CASI, aunque cada uno por
  separado fuera accesorio. "Le falta un parqueadero" se le ofrece a un
  colega; "le falta un parqueadero, un baño y 6 m²" es hacerle perder el
  tiempo — eso es DUDOSA.
- Si dudas si algo es accesorio o de fondo, tratalo como de FONDO.

ANTE LA DUDA
- Entre INCOMPATIBLE y DUDOSA: preferi DUDOSA. Nunca la mandes con la
  confianza de refs_utiles, pero tampoco la pierdas sin que nadie la vea.
- Entre DUDOSA e INCOMPLETO/CASI: segui el criterio de ACCESORIO / de FONDO.
- Un dato que el pedido pide y el inventario simplemente no tiene NO es motivo
  de duda ni de descarte: es 'sin_confirmar'.
- Si el motor se equivoco (aprobo algo que no sirve, o dejo abajo algo que si),
  decilo en 'desacuerdo_con_puntaje'. Es lo que nos permite calibrarlo.
- Las candidatas marcadas [DE UN ALIADO] son de otra inmobiliaria: NO se le
  pueden mandar al colega, nunca, aunque calcen perfecto. Si alguna vale la
  pena, va en 'refs_dudosas' para que la asesora decida; jamas en
  'refs_utiles'. Tampoco las uses para juzgar al resto: suelen traer solo zona
  y precio, asi que su puntaje alto no significa que sean mejores.

'por_que' lo va a leer la asesora que va a llamar al colega: escribilo para
ella, corto y concreto.

DOS EJEMPLOS REALES (casos de produccion, con la salida esperada)

1) Colega pide apto en Envigado CON TERRAZA y maximo 6 años de antiguedad.
   Tenemos 3 propiedades con match del 100% en zona, alcobas y precio, pero el
   inventario no registra terraza ni antiguedad. Antes se descartaban y el
   colega nunca supo que existian. Es INCOMPLETO:
{"es_pedido_real":true,"sirve_alguna":true,"refs_utiles":["10012345","10012346","10012347"],
 "refs_dudosas":[],"sin_confirmar":["terraza","antigüedad"],"le_falta":[],
 "por_que":"Las tres calzan en Envigado, alcobas y presupuesto. No tenemos registrado si tienen terraza ni la antigüedad.",
 "confianza":0.8,"desacuerdo_con_puntaje":""}

2) Colega pide Envigado o Poblado, hasta $980M, 3 alcobas mas estudio o 4,
   98 m² minimo, 2 baños, 2 garajes y cuarto util. La ref 10077095 cumple todo
   salvo el segundo garaje (CASI, se manda diciendolo). La ref 8989725 tiene 2
   alcobas de las 3 y 92 m² de los 98: falla en DOS cosas y una es de fondo,
   asi que NO se manda:
{"es_pedido_real":true,"sirve_alguna":true,"refs_utiles":["10077095"],
 "refs_dudosas":[],"sin_confirmar":[],
 "le_falta":[{"ref":"10077095","detalle":"tiene 1 garaje y pediste 2"}],
 "por_que":"El Portal cumple zona, precio, alcobas, área y baños; solo tiene un garaje. La 8989725 se queda corta en alcobas y área.",
 "confianza":0.85,"desacuerdo_con_puntaje":""}`;

// Como calza la ubicacion, dicho con todas las letras (auditoria 2026-09-02):
// `ubicacion` decide la mitad del veredicto (una vecina sirve, una fuera casi
// nunca) y hasta hoy viajaba escondida entre las razones del motor, donde el
// modelo la podia pasar por alto.
const UBICACION = {
  exacta: "ubicacion: EXACTA (la zona que pidio)",
  vecina: "ubicacion: VECINA (barrio contiguo al pedido)",
  ciudad: "ubicacion: misma CIUDAD, otro barrio",
  otra_zona: "ubicacion: FUERA de la zona pedida",
};

function formatearCandidatas(matches) {
  return (matches || [])
    .map((m, i) => {
      // Baños, garajes y estrato SI se le muestran ahora: el criterio de
      // ACCESORIO vs de FONDO ("tiene 1 garaje y pediste 2") depende de esos
      // datos, y hasta hoy Sofi tenia que adivinarlos del texto crudo.
      const datos = [
        `ref ${m.ref}`,
        m.operacion,
        m.zona,
        m.precio,
        m.area,
        m.habitaciones ? `${m.habitaciones} alcobas` : null,
        m.banos ? `${m.banos} baños` : null,
        m.garajes ? `${m.garajes} garajes` : null,
        m.estrato > 0 ? `estrato ${m.estrato}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      const ubicacion = UBICACION[m.ubicacion] || null;
      // Marcado explicito (2026-09-02): una candidata de un aliado no se le
      // puede mandar al colega —publicable.js la frena con
      // no_es_inventario_propio— pero Sofi no tenia como saberlo y gastaba
      // criterio descartandolas. Caso Camilo: dos aliadas sin ref ni datos
      // puntuaron 77, por encima del inventario propio (56-62), solo porque
      // el puntaje premia lo verificable y de ellas se conocia poco.
      const aliada = m.fuente === "aliado";
      const razones = (m.razones || []).join("; ");
      return [
        `${i + 1}. [puntaje ${m.puntaje}]${aliada ? " [DE UN ALIADO — no se le puede mandar al colega]" : ""} ${m.titulo || "Sin titulo"}`,
        `   ${datos}`,
        ubicacion ? `   ${ubicacion}` : null,
        `   el motor dice: ${razones}`,
      ]
        .filter(Boolean)
        .join("\n");
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
    // Las exigencias COMPLETAS (auditoria 2026-09-02): el clasificador ya
    // extrae baños, garajes, estrato y la flexibilidad de alcobas, y el motor
    // de cruce ya puntua con ellas -- pero no se le mostraban a Sofi, que
    // tenia que juzgar "le falta un garaje" sin saber cuantos se pidieron.
    `- alcobas: ${clasificado.habitaciones || "no dice"}${
      clasificado.habitaciones && clasificado.flexible_habitaciones ? " (acepta una menos si tiene estudio)" : ""
    }`,
    `- area minima: ${clasificado.area_min ? `${clasificado.area_min} m²` : "no dice"}`,
    `- baños: ${clasificado.banos || "no dice"}`,
    `- garajes: ${clasificado.garajes || "no dice"}`,
    `- estrato: ${clasificado.estrato || "no dice"}`,
    clasificado.edificio ? `- edificio puntual: ${clasificado.edificio}` : null,
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

/** ¿El veredicto habilita avisarle a la asesora? -- por refs_utiles O por
 * refs_dudosas (Juan, 2026-09-01): antes solo lo confirmado avisaba; ahora lo
 * dudoso tambien llega al asesor, nunca al colega -- ver alerta-asesor.js. */
function apruebaAviso(veredicto) {
  if (!veredicto || !veredicto.es_pedido_real) return false;
  const utiles = Array.isArray(veredicto.refs_utiles) ? veredicto.refs_utiles : [];
  const dudosas = Array.isArray(veredicto.refs_dudosas) ? veredicto.refs_dudosas : [];
  return utiles.length > 0 || dudosas.length > 0;
}

module.exports = { revalidar, apruebaAviso, formatearCandidatas, UBICACION, MODELO, ESQUEMA, SISTEMA };
