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
const formato = require("../lib/formato");
const { getClient, CACHE_ESTABLE, registrarUso } = require("../lib/anthropic");
// Los margenes del motor se interpolan en el prompt desde su unica fuente
// (auditoria 2026-09-05, H2): el motor aceptaba +10 % de precio y -10 % de
// area desde el 20-ago y se lo decia a Sofi solo en las razones ("7 % sobre
// $420M, dentro del margen"), nunca como regla. Sofi leia "presupuesto" en la
// lista de fondo y mandaba a dudosas lo que el motor habia aceptado a
// proposito. Si el margen cambia, el prompt cambia solo. Se lee del modulo
// hoja ./margenes.js y no de match.js: match.js esta en un ciclo de require
// con vivo.js y en el orden equivocado llegaba vacio (NaN en el prompt).
const { MARGEN_PRECIO, MARGEN_AREA } = require("./margenes");
const PCT_PRECIO = Math.round(MARGEN_PRECIO * 100);
const PCT_AREA = Math.round(MARGEN_AREA * 100);

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
    "dudosas_motivo",
  ],
  properties: {
    // POR QUE CADA DUDOSA ES DUDOSA (auditoria 2026-09-05, paso 5). Con la
    // regla "dos o mas incumplimientos CONOCIDOS; lo que no registramos no
    // cuenta" escrita de todas las formas posibles, Sofi siguio sumando
    // "terraza sin confirmar" + "piso sin confirmar" = "dos huecos" y mandando
    // a dudosas (Gustavo Arango, golden set). Un motivo tipado por ref le da
    // al codigo lo que necesita para corregirlo de forma determinista: si el
    // motivo es la cuenta y la cuenta del motor dice N < 2, la ref sube a
    // refs_utiles (ver aplicarCuenta). El modelo juzga; la regla la aplica el
    // codigo.
    dudosas_motivo: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "motivo"],
        properties: {
          ref: { type: "string", description: "Una ref que pusiste en refs_dudosas." },
          motivo: {
            type: "string",
            enum: [
              "dos_o_mas_incumplimientos_conocidos",
              "zona_vecina_y_colega_tajante",
              "de_fondo_dudoso",
              "aliado",
              "dato_que_no_registramos",
            ],
            description:
              "Por que esa ref es dudosa y no util. 'dos_o_mas_incumplimientos_conocidos' = la cuenta del motor dio N >= 2. " +
              "'zona_vecina_y_colega_tajante' = es vecina y el colega escribio 'solo'/'unicamente' esa zona. " +
              "'de_fondo_dudoso' = dudas si algo de fondo (tipo, operacion) calza. 'aliado' = es de otra inmobiliaria. " +
              "'dato_que_no_registramos' = lo unico que te frena es un dato que el inventario no tiene: ese NO es motivo " +
              "valido y la ref deberia estar en refs_utiles; si igual lo usas, el sistema la sube a utiles.",
          },
        },
      },
      description: "Un item por cada ref de refs_dudosas, con su motivo. Vacio si refs_dudosas esta vacio.",
    },
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

// EL PROMPT ES POLITICA, NO HISTORIA (auditoria 2026-09-05, H7). Antes
// acumulaba cada regla con su fecha, la cita literal de Juan y el caso que la
// motivo; llego a ~3.600 tokens con la misma regla escrita tres veces y dos
// ordenes opuestas conviviendo (el caso Patricia Urreta / poniente). Un modelo
// que recibe la misma regla tres veces con matices distintos no la obedece
// mejor: la interpreta. El porque de cada regla vive ahora en
// docs/superpowers/specs/revalidar-politica-historia.md, y el prompt se prueba
// corriendo el golden set sobre pedidos reales (scripts/golden-revalidar.js),
// no fijando frases.
const SISTEMA = `Sos Sofi, la asistente inmobiliaria de Diamond en Medellin. Un colega de otra
inmobiliaria publico un pedido en un grupo gremial y nuestro motor encontro
propiedades nuestras que podrian servirle. Das el veredicto: ¿el pedido es
real, y cual propiedad se le ofrece?

QUE TE LLEGA
- El pedido como lo escribio el colega y como lo entendio el motor. Un campo
  que dice "no dice" NO es una exigencia: no descartes por algo que el colega
  nunca pidio.
- Por cada candidata: la ficha, su UBICACION respecto de lo pedido (exacta /
  vecina / misma ciudad / fuera), las razones del motor y una linea
  "incumplimientos conocidos: N". En la ficha, "sin dato" significa que NO LO
  SABEMOS, nunca que no lo tiene: "garajes: sin dato" no es "sin garaje".
- Algunas fichas traen "caracteristicas registradas" (lo que Wasi guarda:
  unidad cerrada, terraza, balcon, vista, garaje...). Si el pedido pide algo
  que aparece ahi, CUMPLE: decilo en 'por_que' y no lo pongas en
  sin_confirmar. Si no aparece, sigue siendo "no lo sabemos": la ausencia
  nunca es un "no tiene", y una ficha sin esa linea no dice nada.
- El motor ya filtro operacion, tipo, zona (exacta o vecina), banda de precio
  y alcobas hacia abajo. Acepta hasta un ${PCT_PRECIO} % POR ENCIMA del presupuesto y
  hasta un ${PCT_AREA} % POR DEBAJO del area minima, y te lo dice en sus razones
  ("7% sobre $420M, dentro del margen"). Lo que se pasa de eso no te llega:
  si te llego, cabe.
- El puntaje premia cuanto del pedido se pudo VERIFICAR, no que tan buena es
  la propiedad. Un puntaje bajo puede ser una gran opcion sobre la que sabemos
  poco. No lo tomes como verdad.
- Las candidatas marcadas [DE UN ALIADO] son de otra inmobiliaria: NUNCA van
  a refs_utiles; si alguna vale la pena, a refs_dudosas. Tampoco las uses para
  juzgar al resto: suelen traer solo zona y precio.

LO QUE NO REGISTRAMOS NO DESCARTA — la regla que mas se rompe, por eso va
primero. Orientacion, poniente, antiguedad, vista, piso, terraza, unidad
cerrada, jardin, acabados, cuarto util, y cualquier "sin dato" de la ficha:
van a 'sin_confirmar' y la propiedad se ofrece igual, en refs_utiles. Vale
aunque el colega lo escriba como "SI o SI", "indispensable", "excluyente" o
"innegociable": nada que no podemos ver puede ser un incumplimiento, ni
volver una propiedad INCOMPATIBLE ni bajarla a refs_dudosas. Da igual que
sean uno o cinco datos. No lo deduzcas de otro dato: que el titulo diga
"balcon" no prueba que no haya terraza. Y no es "que la asesora lo confirme
antes de ofrecerla": se le ofrece al colega diciendole que ese dato no lo
tenemos, y el colega pregunta si le importa. Mandarlo a dudosas para que
alguien averigue primero es lo mismo que no avisar. Si lo UNICO que te hace
dudar de una propiedad es algo que no registramos, no hay duda: refs_utiles.

LAS CUATRO SALIDAS

| Salida | Va a | Cuando |
|---|---|---|
| INCOMPATIBLE | nada (ni a refs_dudosas) | falla algo DE FONDO: otra operacion, otro tipo de propiedad (una finca no reemplaza un apartamento), zona fuera de lo pedido y no vecina, precio mas alla del margen del motor, o menos alcobas de las pedidas sin flexibilidad declarada. O el pedido no es real (saludo, oferta, comentario). |
| INCOMPLETO | refs_utiles, con el dato en 'sin_confirmar' | cumple todo lo verificable, pero el pedido menciona algo que el inventario no registra o que la ficha trae como "sin dato" |
| CASI | refs_utiles, con el dato en 'le_falta' | UN solo incumplimiento conocido, y accesorio |
| DUDOSA | refs_dudosas | DOS o mas incumplimientos conocidos (nunca datos que no registramos, por mas que el colega los exija), o una zona vecina cuando el colega escribio "solo" o "unicamente" esa zona. La asesora decide si llamar |

LA CUENTA LA HACE EL MOTOR. La linea "incumplimientos conocidos: N" cuenta los
datos REALES de la ficha que no alcanzan lo pedido: area o precio dentro del
margen, un garaje o un baño de menos, una alcoba de menos con flexibilidad.
Usala tal cual, no la recalcules:
  · N = 0 -> refs_utiles (INCOMPLETO si el pedido menciona algo sin confirmar).
  · N = 1 -> CASI: refs_utiles con ese dato en 'le_falta'.
  · N >= 2 -> DUDOSA: refs_dudosas.
Un "sin dato" no esta en esa cuenta ni la sube: un area corta mas un
"garajes: sin dato" es N = 1, no 2. Un pedido con "terraza SI o SI" y una
ficha que no registra terraza sigue siendo N = 0. Lo unico que te toca juzgar
a vos es lo DE FONDO y el sentido comun de "no le mostraria esto a un
cliente".

DE FONDO vs ACCESORIO. La lista de fondo es CERRADA: operacion, tipo, zona,
presupuesto mas alla del margen y alcobas hacia abajo. NADA MAS. Todo lo
demas es accesorio —parqueadero, baños, estrato, cuarto util, metros o precio
dentro del margen, acabados— y no podes ascenderlo a fondo por mas central
que parezca en ese pedido: el colega prefiere ver la propiedad y decidir el
mismo. Si dudas si algo es accesorio o de fondo, es accesorio.

SOBRAR NO ES FALLAR. Mas alcobas, mas baños, mas garajes o mas metros de los
pedidos CUMPLE: no descartes ni mandes a dudosas por eso. Escribilo como
ventaja ("cumple, y ademas tiene 4 alcobas y 212 m²"), nunca como objecion
("4 alcobas vs 3"). Si el pedido acepta una alcoba menos con estudio (te lo
decimos como "acepta una menos si tiene estudio"), 2 alcobas con estudio
cumple un pedido de 3.

UBICACION. Exacta y vecina sirven: quien pide El Poblado muchas veces compra
en Envigado, son contiguos. Decilo en 'por_que' para que la asesora lo sepa
de entrada ("queda en Envigado, pegado al Poblado"). "Fuera" casi nunca
sirve, pero si todo lo demas calza muy bien y el colega no fue tajante,
evaluala en vez de descartarla de plano. Si nombra varias zonas, cualquiera
cuenta.

ANTE LA DUDA. Entre INCOMPATIBLE y DUDOSA, preferi DUDOSA: que alguien la
vea. Entre DUDOSA y CASI/INCOMPLETO, segui la cuenta del motor: con N = 0 o
N = 1 la salida es refs_utiles, y ningun dato que no registramos cambia eso. Lo
verificable —zona, precio, area, alcobas, operacion— tiene que cumplir igual:
'sin_confirmar' NO es una excusa para bajar el estandar, solo quita el voto
en contra de lo que no sabemos.

COMO ESCRIBIR. Por cada ref de refs_dudosas, su motivo en 'dudosas_motivo';
si el unico motivo que encontras es 'dato_que_no_registramos', esa ref va a
refs_utiles, no a dudosas. 'por_que' lo lee la asesora que va a llamar al
colega: corto, concreto, con la zona y lo que falta. 'le_falta' lleva el dato real y el
pedido al lado ("tiene 1 garaje y pediste 2"), sin disculpas: el colega
decide. Si el motor se equivoco (aprobo algo que no sirve, o dejo abajo algo
que si), decilo en 'desacuerdo_con_puntaje': es lo que nos permite calibrarlo.

TRES EJEMPLOS REALES (con la salida esperada)

1) INCOMPLETO. Colega pide apto en Envigado CON TERRAZA y maximo 6 años de
   antiguedad. Tres propiedades calzan en zona, alcobas y precio; el
   inventario no registra terraza ni antiguedad. Se mandan las tres:
{"es_pedido_real":true,"sirve_alguna":true,"refs_utiles":["10012345","10012346","10012347"],
 "refs_dudosas":[],"dudosas_motivo":[],"sin_confirmar":["terraza","antigüedad"],"le_falta":[],
 "por_que":"Las tres calzan en Envigado, alcobas y presupuesto. No tenemos registrado si tienen terraza ni la antigüedad.",
 "confianza":0.8,"desacuerdo_con_puntaje":""}

2) CASI e INCOMPATIBLE. Colega pide Envigado o Poblado, hasta $980M, 3
   alcobas mas estudio o 4, 98 m² minimo, 2 baños, 2 garajes y cuarto util.
   La ref 10077095 cumple todo salvo el segundo garaje (N = 1: CASI). La ref
   8989725 tiene 2 alcobas de las 3 sin flexibilidad: de fondo, no se manda:
{"es_pedido_real":true,"sirve_alguna":true,"refs_utiles":["10077095"],
 "refs_dudosas":[],"dudosas_motivo":[],"sin_confirmar":["cuarto útil"],
 "le_falta":[{"ref":"10077095","detalle":"tiene 1 garaje y pediste 2"}],
 "por_que":"El Portal cumple zona, precio, alcobas, área y baños; solo tiene un garaje. No registramos cuarto útil. La 8989725 se queda corta en alcobas.",
 "confianza":0.85,"desacuerdo_con_puntaje":""}

3) EL CASO MIXTO, el mas comun: un corto CONOCIDO dentro del margen mas datos
   que no registramos. Colega pide Envigado o Sabaneta, hasta $420M, 3
   alcobas, 2 baños, parqueadero y unidad cerrada. La ref 10077063 cumple
   zona, alcobas y baños; cuesta $450M (7% sobre el techo, dentro del margen)
   y la ficha dice "garajes: sin dato". N = 1 (el precio): CASI. El garaje y
   la unidad cerrada van a sin_confirmar y NO suman. Se manda:
{"es_pedido_real":true,"sirve_alguna":true,"refs_utiles":["10077063"],
 "refs_dudosas":[],"dudosas_motivo":[],"sin_confirmar":["garaje","unidad cerrada"],
 "le_falta":[{"ref":"10077063","detalle":"cuesta $450M y pediste hasta $420M"}],
 "por_que":"Cumple Envigado, 3 alcobas y 2 baños; se pasa $30M del presupuesto. No tenemos registrado si tiene garaje ni si es unidad cerrada.",
 "confianza":0.75,"desacuerdo_con_puntaje":""}`;

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
      // "SIN DATO" SE DICE, NO SE OMITE (Juan, 2026-09-02): "lo que no
      // tengamos validado en wasi se le envia como observacion". Hasta hoy un
      // garaje vacio en Wasi hacia DESAPARECER la linea de la ficha, y Sofi
      // leia la ausencia como "no tiene garaje" — mando a dudosas tres refs
      // del pedido de Melissa y la unica candidata de David Holguin, todas
      // con garaje null, ninguna con garaje 0. Un 0 real sigue saliendo como
      // 0: eso si es "no tiene". Con 85 de 114 propiedades sin garaje cargado,
      // la diferencia decide la mitad de los pedidos.
      // CORRECCION (Juan, 2026-09-04): "no podemos dejar de ofrecer un
      // apartamento por un parqueadero".
      //
      // La regla de arriba asumia que Wasi distingue "no tiene garaje" (0) de
      // "no lo cargamos" (null). NO LO HACE. Medido contra produccion el
      // 2026-09-04 sobre las 114 disponibles: garaje = 0 en 39, garaje = null
      // en CERO. O sea que la rama "sin dato" era codigo muerto para garajes,
      // y las 39 propiedades sin el campo cargado —el 34% del inventario— se
      // le presentaban a Sofi como "0 garajes", que ella lee como "confirmado
      // que no tiene".
      //
      // Caso real que lo destapo (15:00 del 2026-09-04, pedido de Juan Carlos
      // Montes en Pedidos Poblado/Envigado): el motor dio 95 y 85, y Sofi
      // descarto las dos diciendo "ambas propiedades tienen 0 garajes
      // registrados (...) es un incumplimiento de fondo, no accesorio". Hizo
      // lo correcto con un dato falso.
      //
      // Ahora el criterio es el MISMO que ya usa match.js (`!(e.tiene > 0)`
      // = sin dato) y el que esta linea ya aplicaba para estrato. Un cero deja
      // de significar "no tiene" porque en estos datos nunca lo significo.
      const dato = (valor, unidad) =>
        formato.datoCargado(valor) ? `${valor} ${unidad}` : `${unidad}: sin dato`;
      const datos = [
        `ref ${m.ref}`,
        m.operacion,
        m.zona,
        m.precio,
        m.area,
        m.habitaciones ? `${m.habitaciones} alcobas` : null,
        dato(m.banos, "baños"),
        dato(m.garajes, "garajes"),
        formato.datoCargado(m.estrato) ? `estrato ${m.estrato}` : "estrato: sin dato",
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
      // LA CUENTA LA HACE EL MOTOR, NO SOFI (auditoria 2026-09-05, H3). La
      // regla "dos o mas incumplimientos CONOCIDOS = dudosa; lo que no
      // registramos no cuenta" estaba escrita tres veces y Sofi igual sumaba
      // un "garajes: sin dato" como segundo incumplimiento (Mateo Narvaez,
      // 18:44: "son dos cosas a la vez: el area conocida que falta y el garaje
      // sin dato"). Un modelo cuenta mal lo que se le pide contar con palabras;
      // el motor ya sabe exactamente que se quedo corto: cada razon con
      // "(pediste N)" o "dentro del margen" es un dato REAL que no alcanza.
      // Se le entrega el numero hecho, y el prompt le dice que lo use tal cual.
      // Se deriva de las razones y no de un campo nuevo para que sirva igual
      // sobre los matches ya guardados en group_signals (diagnostico).
      const cortos = (m.razones || []).filter((r) => /\(pediste |dentro del margen/.test(String(r)));
      const cuenta = cortos.length
        ? `   incumplimientos conocidos: ${cortos.length} (${cortos.join("; ")})`
        : `   incumplimientos conocidos: 0`;
      // Lo que Wasi registra como caracteristicas (2026-09-05): si el pedido
      // pide unidad cerrada o terraza y aca aparece, Sofi lo confirma en
      // positivo en vez de mandarlo a sin_confirmar. Solo si hay: una linea
      // "caracteristicas: ninguna" se leeria como "no tiene nada".
      const caracteristicas = String(m.caracteristicas || "").trim();
      return [
        `${i + 1}. [puntaje ${m.puntaje}]${aliada ? " [DE UN ALIADO — no se le puede mandar al colega]" : ""} ${m.titulo || "Sin titulo"}`,
        `   ${datos}`,
        ubicacion ? `   ${ubicacion}` : null,
        caracteristicas ? `   caracteristicas registradas: ${caracteristicas}` : null,
        `   el motor dice: ${razones}`,
        cuenta,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

// Los cortos CONOCIDOS de una candidata, tal como los escribe el motor: cada
// razon con "(pediste N)" o "dentro del margen" es un dato real que no alcanza.
// Es la misma cuenta que se le muestra a Sofi en la ficha (formatearCandidatas).
function cortosDe(m) {
  return (m && Array.isArray(m.razones) ? m.razones : []).filter((r) => /\(pediste |dentro del margen/.test(String(r)));
}

// LA REGLA LA APLICA EL CODIGO (auditoria 2026-09-05, paso 5). Sofi declara
// por que cada dudosa es dudosa (dudosas_motivo). Si el motivo es la cuenta de
// incumplimientos —o directamente un dato que no registramos— y la cuenta del
// motor para esa ref da N < 2, la ref NO es dudosa por definicion (D7 y D10
// de la auditoria): sube a refs_utiles, con su corto en le_falta si N = 1.
//
// Solo se toca lo que la regla determinista puede decidir. Un motivo de
// fondo, una zona con colega tajante o un aliado se respetan tal cual: ahi el
// juicio es de Sofi. La correccion queda escrita en el veredicto
// (`correccion_cuenta`) para poder medir cuantas veces hizo falta.
const MOTIVOS_QUE_DECIDE_LA_CUENTA = new Set(["dos_o_mas_incumplimientos_conocidos", "dato_que_no_registramos"]);

function aplicarCuenta(veredicto, matches) {
  if (!veredicto || !Array.isArray(veredicto.refs_dudosas) || veredicto.refs_dudosas.length === 0) return veredicto;
  const porRef = new Map((matches || []).map((m) => [String(m.ref), m]));
  const motivos = new Map(
    (Array.isArray(veredicto.dudosas_motivo) ? veredicto.dudosas_motivo : [])
      .filter((x) => x && x.ref)
      .map((x) => [String(x.ref), x.motivo])
  );
  const utiles = (veredicto.refs_utiles || []).map(String);
  const leFalta = Array.isArray(veredicto.le_falta) ? [...veredicto.le_falta] : [];
  const subidas = [];
  const dudosas = [];

  for (const ref0 of veredicto.refs_dudosas) {
    const ref = String(ref0);
    const m = porRef.get(ref);
    const motivo = motivos.get(ref);
    const cortos = m ? cortosDe(m) : null;
    const laDecideLaCuenta = m && m.fuente !== "aliado" && MOTIVOS_QUE_DECIDE_LA_CUENTA.has(motivo) && cortos && cortos.length < 2;
    if (!laDecideLaCuenta || utiles.includes(ref)) {
      dudosas.push(ref0);
      continue;
    }
    subidas.push(ref);
    // N = 1: el corto se declara, igual que si Sofi lo hubiera puesto ella.
    if (cortos.length === 1 && !leFalta.some((f) => f && String(f.ref) === ref)) {
      leFalta.push({ ref, detalle: cortos[0].replace(/\s*\(pediste (\d+)\)/, " y pediste $1").replace(/ — /, ": ") });
    }
  }
  if (subidas.length === 0) return veredicto;

  console.warn(`[radar] cuenta del motor: ${subidas.length} ref(s) subida(s) de dudosas a utiles por N < 2: ${subidas.join(", ")}`);
  return {
    ...veredicto,
    refs_utiles: [...utiles, ...subidas],
    refs_dudosas: dudosas,
    le_falta: leFalta,
    sirve_alguna: true,
    correccion_cuenta: subidas,
  };
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
      // Cacheado: SISTEMA son ~2.250 tokens identicos en cada pedido, muy por
      // encima del minimo cacheable de Sonnet (1.024). Lo que cambia es el
      // `pedido` de abajo, que va en messages y no toca este prefijo.
      system: [{ type: "text", text: SISTEMA, cache_control: CACHE_ESTABLE }],
      output_config: { format: { type: "json_schema", schema: ESQUEMA } },
      messages: [{ role: "user", content: pedido }],
    });
    registrarUso("revalidar", res.usage);
    const texto = res.content.find((b) => b.type === "text")?.text || "";
    return { veredicto: aplicarCuenta(JSON.parse(texto), matches), uso: res.usage || {} };
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

module.exports = { revalidar, apruebaAviso, formatearCandidatas, aplicarCuenta, cortosDe, UBICACION, MODELO, ESQUEMA, SISTEMA };
