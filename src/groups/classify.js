// Etapa 1 del embudo: clasificacion y extraccion con Claude.
//
// Recibe lo que sobrevivio al prefiltro y devuelve, por mensaje, si es una
// DEMANDA (un colega busca algo), una OFERTA (un colega publica una propiedad)
// o RUIDO, mas los campos extraidos.
//
// Tres decisiones que definen el costo:
//
// 1. LOTES. Los mensajes van de a ~20 por llamada. Sin batching, el prompt de
//    sistema se paga una vez por mensaje y el mes cuesta decenas de dolares en
//    vez de centavos.
// 2. HAIKU. Es una tarea de clasificacion, no de razonamiento: Haiku 4.5
//    cuesta 1 USD por millon de tokens de entrada contra los 5 de Sonnet.
//    Configurable por CLAUDE_MODEL_GRUPOS. NO se reusa config.claudeModel,
//    que es Sonnet y es el modelo del bot de cara al cliente.
// 3. SALIDA ESTRUCTURADA. El esquema lo fuerza la API (output_config.format),
//    no el prompt — asi que no hay que parsear texto libre ni tolerar JSON mal
//    formado mensaje por mensaje.
//
// 4. PROMPT CACHING (2026-09-14). Hasta hoy decia "sin cache a proposito": el
//    prefijo (system + esquema, 3.092 tokens) no llegaba al minimo cacheable
//    de Haiku 4.5 (4.096) y el volumen estimado era de ~2.100 mensajes al
//    mes. Medido en produccion son 820 a 1.300 POR DIA —el prefiltro lexico
//    descarta el 0,6 % en grupos gremiales, no el 85 %— y el clasificador era
//    ~85 % de la factura de la API. Con ese volumen conviene cruzar el minimo
//    con contenido que el modelo usa (los EJEMPLOS del final del prompt) y
//    marcarlo: cada mensaje lee el prefijo a 0,1x en vez de pagarlo entero.
//    Si el prompt se recorta por debajo del minimo, el cache se cae SIN
//    error: lo custodian test/group-classify.test.js (estimacion) y
//    `railway run --service diamond node scripts/smoke-cache.js classify`
//    (API real). Detalle en docs/costo-api-claude.md.

const { getClient, CACHE_ESTABLE, registrarUso } = require("../lib/anthropic");

const MODELO = process.env.CLAUDE_MODEL_GRUPOS || "claude-haiku-4-5";
const TAMANO_LOTE = 20;
const CONCURRENCIA = Number(process.env.GROUPS_CLASSIFY_CONCURRENCIA || 4);

// Reintentos ante limite de tasa o fallo transitorio del proveedor.
//
// Con la escucha en vivo esto no hacia falta: llegaban lotes sueltos cada
// pocos minutos. Un export de varios grupos manda cientos de lotes de una, y
// sin backoff el 429 convierte una corrida entera en `lotesFallidos` — que en
// el reporte se ve igual que "no habia nada", el peor modo de fallo posible.
const REINTENTOS = [2000, 8000, 30000];

// USD por millon de tokens (Haiku 4.5). Solo se usan para proyectar el costo
// en el reporte; si se cambia de modelo hay que actualizarlos.
const USD_POR_MTOK_ENTRADA = 1.0;
const USD_POR_MTOK_SALIDA = 5.0;

// Los campos opcionales NO son nullables: el string vacio y el 0 significan
// "no especificado". Evita depender de uniones de tipos en el esquema y deja
// el consumo en match.js sin comprobaciones de null.
const ESQUEMA = {
  type: "object",
  properties: {
    mensajes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "El id exacto del mensaje de entrada" },
          clase: { type: "string", enum: ["demanda", "oferta", "ruido"] },
          confianza: { type: "number", description: "0 a 1" },
          operacion: { type: "string", enum: ["arriendo", "venta", "permuta", ""] },
          tipo: { type: "string", description: "apartamento, casa, local, oficina, bodega, lote, finca… o vacio" },
          zonas: {
        type: "array",
        items: { type: "string" },
        description:
          "TODAS las zonas o barrios que el pedido acepta, como alternativas. 'POBLADO/ENVIGADO' son DOS: ['El Poblado','Envigado']. Lista vacia si no nombra ninguna. Nunca metas la ciudad aca, ni el municipio que CONTIENE a los sectores pedidos: ese va en zona_madre.",
      },
      // EL SECTOR RESTRINGE, EL MUNICIPIO CONTIENE (Juan, 2026-09-21). Antes
      // los dos iban juntos en `zonas`, y el motor lee esa lista como
      // alternativas: "Envigado · Sector: Camino de las Aguas" quedaba
      // "Envigado O Camino de las Aguas", y cualquier propiedad del municipio
      // calzaba exacta. Ver test/zona-sector-municipio.test.js.
      zona_madre: {
        type: "string",
        description:
          "Municipio o zona grande que CONTIENE a los sectores de `zonas` cuando el pedido la nombra como contenedor ('PROPIEDAD EN ENVIGADO · Sector: Camino de las Aguas' -> 'Envigado'). Vacio si no nombra contenedor o si las zonas son alternativas ('POBLADO/ENVIGADO').",
      },
      zona: { type: "string", description: "Barrio o sector. Vacio si no se menciona" },
          zonas_excluidas: {
        type: "array",
        items: { type: "string" },
        description:
          "Zonas que el pedido EXCLUYE explicitamente ('No Loma del Indio', '❌ Loma del Indio', 'menos Robledo', 'excepto Belén'). Lista vacia si no excluye ninguna. Nunca metas aca una zona que tambien este en `zonas` — son listas opuestas.",
      },
          ciudad: { type: "string", description: "Vacio si no se menciona" },
          precio_min: { type: "integer", description: "Pesos colombianos. 0 si no se especifica" },
          precio_max: { type: "integer", description: "Pesos colombianos. 0 si no se especifica" },
          habitaciones: { type: "integer", description: "0 si no se especifica" },
          // Estas cuatro son las que vuelven certero el cruce: con zona y precio
          // solos, una demanda vaga matchea media ciudad.
          area_min: { type: "integer", description: "Metros cuadrados minimos. 0 si no se especifica" },
          banos: { type: "integer", description: "0 si no se especifica" },
          garajes: { type: "integer", description: "Parqueaderos. 0 si no se especifica" },
          estrato: { type: "integer", description: "0 si no se especifica" },
          // EL PISO (Juan, 2026-09-18): 255 de los 1.000 pedidos capturados
          // entre el 1-ago y el 18-sep lo nombran, y hasta hoy no se extraia.
          // Dos campos y no uno porque el pedido lo dice en las dos
          // direcciones: "solo hasta 3er piso" es un techo, "piso alto" es un
          // piso minimo. Enteros y no texto por la misma razon que el resto de
          // los numeros del esquema: 0 significa "no lo pidio".
          piso_max: { type: "integer", description: "Piso mas alto que acepta el pedido. 0 si no se especifica" },
          piso_min: { type: "integer", description: "Piso mas bajo que acepta el pedido. 0 si no se especifica" },
          contacto: { type: "string", description: "Telefono o nombre si el mensaje lo trae. Vacio si no" },
          notas: { type: "string", description: "Detalle relevante en pocas palabras" },
          // Juan, 2026-08-20 (auditoria del veredicto de Sofi): "depende de si
          // menciona 'estudio' o 'para inversion'" — un cliente que dice
          // "3 alcobas o 2 con estudio" o compra "para inversion" acepta una
          // alcoba/bano/parqueadero menos de lo pedido si el resto calza. Sin
          // esta señal el motor no puede distinguirlo de un pedido exacto.
          flexible_habitaciones: {
            type: "boolean",
            description:
              "true SOLO si el mensaje dice explicitamente 'estudio' (ej. '3 alcobas o 2 con estudio') o 'para inversion'/'para invertir'. false en cualquier otro caso, incluido cuando no se menciona nada.",
          },
          // Juan, 2026-08-21 (caso Esteban Higuita / edificio Murano Plaza):
          // "el asesor sabe donde quedan las propiedades pero en wasi no las
          // tenemos marcadas por edificio por seguridad" — el motor no puede
          // verificar si algo del inventario ES ese edificio, asi que un
          // pedido asi nunca se puede responder solo por zona sin arriesgarse
          // a ofrecer el edificio equivocado. Esta señal es lo que le permite
          // a politica.js frenar el auto-publicado y mandarlo derecho a la
          // asesora en vez de dejar que el puntaje decida.
          edificio: {
            type: "string",
            description:
              "Nombre PROPIO de un edificio, torre, conjunto o unidad especifica que el pedido nombra explicitamente (ej. 'edificio Murano Plaza', 'Torre Aqua', 'Conjunto Los Cerezos'). Vacio si el pedido solo da zona/barrio, o si dice 'unidad cerrada'/'conjunto cerrado' como caracteristica generica SIN nombre propio. No confundir con el nombre de la inmobiliaria del colega ni con el barrio.",
          },
          // AMOBLADO, TRI-ESTADO (2026-09-07). Un booleano no puede expresar
          // la diferencia entre "no lo menciono" y "lo rechazo", y son
          // conductas opuestas: ante "" una propiedad amoblada es elegible,
          // ante "no" queda descartada. El caso que lo motivo esta en la base:
          // "*Busco CASA para arriendo en el Poblado* 3 alcobas mas servicio
          // $9.000.000 *SIN muebles*" — hoy eso cruza contra nuestro amoblado
          // de Los Gonzales sin que nada lo frene.
          amoblado: {
            type: "string",
            enum: ["si", "no", ""],
            description:
              "'si' si el pedido pide amoblado/amueblado. 'no' si lo rechaza explicitamente ('SIN muebles', 'sin amoblar', 'vacio', 'no amoblado'). '' si no lo menciona.",
          },
          // PERIODO (2026-09-07). El peligro NO es el que parece: un pedido de
          // "$300.000 por noche" ya lo bloquea la banda de precio sola. El que
          // si pasa hoy es el inverso: "$4.500.000 por 15 dias" extrae
          // precio_max 4.500.000, calza perfecto contra nuestro amoblado
          // mensual, y le ofrecemos un mes por el precio de quince dias.
          periodo: {
            type: "string",
            enum: ["mes", "corta", ""],
            description:
              "'corta' si el arriendo es por noches, dias, semanas o una estadia de pocos dias. 'mes' si es mensual o de largo plazo. '' si no se puede saber.",
          },
        },
        required: [
          "id", "clase", "confianza", "operacion", "tipo", "zonas", "zona_madre", "zona", "zonas_excluidas", "ciudad",
          "precio_min", "precio_max", "habitaciones", "area_min", "banos",
          "garajes", "estrato", "contacto", "notas", "flexible_habitaciones", "edificio",
          "amoblado", "periodo", "piso_max", "piso_min",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["mensajes"],
  additionalProperties: false,
};

const SISTEMA = `Clasificás mensajes de grupos de WhatsApp del gremio inmobiliario del Valle de Aburrá (Medellín y municipios vecinos).

En estos grupos los colegas de distintas inmobiliarias publican dos cosas de valor:

- **demanda**: el colega BUSCA algo porque tiene un cliente. "Tengo cliente para apto 3 alcobas en Laureles hasta 400 millones", "alguien maneja local en Envigado?", "busco casa en Belén, urgente".
- **oferta**: el colega OFRECE una propiedad disponible, propia o de su inmobiliaria. "Se vende casa en Sabaneta, 650 millones", "les comparto apartaestudio en El Poblado, arriendo 2.300.000", "sigue disponible el de Belén".

Todo lo demás es **ruido**: saludos, agradecimientos, felicitaciones, conversación social, coordinación interna, mensajes ambiguos sin propiedad ni requerimiento concreto.

Reglas de extracción:

- Los precios van SIEMPRE en pesos colombianos, como entero, sin puntos. Convertí las formas coloquiales: "400 millones" y "400 palos" → 400000000; "1.200.000" → 1200000; "2.3 millones" → 2300000. Si el mensaje da un tope ("hasta 400 millones") es precio_max. Si da un piso ("desde 300") es precio_min. Si da un precio único de venta o arriendo, es precio_max.
- Un precio sin unidad ("máximo 1.200", "hasta 850", "ppto 1300") se lee por lo que es plausible en el Valle de Aburrá: en VENTA una vivienda vale cientos o miles de millones, así que "máximo 1.200" → 1200000000 y "hasta 850" → 850000000; en ARRIENDO el canon mensual va de ~1 a ~20 millones, así que "hasta 4.500" → 4500000. Una venta nunca queda en 1.200.000 pesos.
- No inventes datos. Si el mensaje no lo dice, dejá el string vacío o el 0. Esto es especialmente importante en \`zona\`: una demanda sin zona NO se puede cruzar contra el inventario, y es mejor dejarla vacía que poner una zona aproximada — una zona inventada manda al asesor a ofrecer algo del barrio equivocado.
- \`zonas\` es la LISTA de barrios o sectores que nombra el pedido. Un colega pide en varias a la vez y hay que capturarlas TODAS: "POBLADO/ENVIGADO" → ["El Poblado","Envigado"]; "Laureles o Estadio" → ["Laureles","Estadio"]; "Sabaneta" → ["Sabaneta"]. Lista vacía si no nombra ninguna.
- \`zona_madre\`: cuando el pedido nombra un municipio o zona grande Y adentro un sector, barrio o unidad ("PROPIEDAD EN ENVIGADO · Sector: Camino de las Aguas", "Camino Verde de Envigado", "ENVIGADO - Loma de los Mesa"), el sector RESTRINGE y el municipio solo lo CONTIENE: el sector va en \`zonas\` y el municipio en \`zona_madre\` → zonas ["Camino de las Aguas"] · zona_madre "Envigado". NUNCA pongas el municipio contenedor también en \`zonas\`: ahí se lee como alternativa, y quien pidió Camino de las Aguas terminaría recibiendo cualquier cosa de Envigado. Si son alternativas ("POBLADO/ENVIGADO", "Envigado o Sabaneta") no hay contenedor: todas van en \`zonas\` y \`zona_madre\` queda vacía. Si solo nombra el municipio ("apto en Envigado"), va en \`zonas\` y \`zona_madre\` vacía.
  · ANTE LA DUDA, ALTERNATIVA: \`zona_madre\` vacía y todo en \`zonas\`. Equivocarse para este lado solo agrega opciones; equivocarse para el otro borra el municipio que el colega sí aceptaba. El municipio es contenedor SOLO con una marca explícita de que el sector es lo único que sirve: "Sector: X", "solo X", "únicamente X", "X de Envigado", "X (Envigado)", "Envigado (solo X)", "Envigado; X". Todo lo que AMPLÍA o expresa gusto NO es contenedor: "incluyendo X", "sirve X", "también X", "le gusta X", "preferiblemente X", "ojalá X", "hasta X", "Envigado y X", "Envigado o X", "Envigado parte baja o X" → todo en \`zonas\`, \`zona_madre\` vacía. Ejemplos: "Envigado, incluyendo Alto del Escobero" → ["Envigado","Alto del Escobero"]; "La Estrella (sirve Tablaza)" → ["La Estrella","Tablaza"]; "Envigado parte baja o sector San Lucas" → ["Envigado","San Lucas"].
  · Si nombra DOS o más municipios o zonas grandes, cada uno con sus sectores ("POBLADO (Tesoro, Balsos) · ENVIGADO (Chocho, Cumbres)"), son alternativas: van todos en \`zonas\`, municipios y sectores, y \`zona_madre\` vacía.
- \`zona\` es la primera de esa lista, o vacío. Se conserva por compatibilidad; lo que importa es \`zonas\`.
- \`zonas_excluidas\`: BUG real (2026-08-20) — un pedido que decía "❌No Loma del Indio" se guardaba sin ese dato, y el motor podía ofrecer justo lo que el cliente rechazó. Capturá TODA zona que el mensaje excluya explícitamente ("No X", "❌ X", "menos X", "excepto X", "X no"). Una zona nunca va en \`zonas\` y en \`zonas_excluidas\` a la vez.
- Si el mensaje sólo nombra el municipio ("Medellín"), eso va en \`ciudad\`, no en \`zonas\`. Pero ojo: Envigado, Sabaneta, Itagüí y La Estrella son municipios que en estos grupos se usan como zona — van en \`zonas\`.
- \`area_min\` en metros cuadrados: "mínimo 85 m2" → 85; "de 100 metros" → 100.
- \`banos\`, \`garajes\` y \`estrato\`: sólo si el mensaje los pide explícitamente. "2 baños, parqueadero doble" → banos 2, garajes 2. "estrato 5 o 6" → 5 (el mínimo).
- \`flexible_habitaciones\`: true SOLO si el mensaje dice "estudio" (ej. "3 alcobas o 2 con estudio", "2 alcobas y estudio") o "para inversión"/"para invertir". No lo actives por intuición ni por el tono del pedido — solo por esas palabras.
- \`edificio\`: nombre PROPIO de un edificio, torre, conjunto o unidad que el pedido nombre explícitamente — "en el *edificio Murano Plaza*", "Torre Aqua", "Conjunto Los Cerezos". Vacío si el pedido solo da zona/barrio, o si dice "unidad cerrada"/"conjunto cerrado" como característica genérica SIN nombre propio ("que sea unidad cerrada" no cuenta; "en la unidad Reserva del Parque" sí). No confundas esto con el nombre de la inmobiliaria de quien pide, ni con el nombre del barrio.
- \`amoblado\`: 'si' cuando el pedido pide amoblado o amueblado ("busco amoblado en Sabaneta", "apartamento amoblado en el poblado"). 'no' cuando lo RECHAZA explícitamente — "SIN muebles", "sin amoblar", "vacío", "no amoblado". '' si no lo menciona. Los tres valores son distintos y no se pueden mezclar: '' significa que al colega le da igual, 'no' significa que no lo quiere.
- \`piso_max\` y \`piso_min\`: el NIVEL del edificio en el que está el inmueble. Medido sobre los pedidos reales, el piso casi nunca es un número exacto: es un techo, un piso mínimo o un rango. Extraelo como BANDA y no como número exacto, porque un rango leído como exacto borra propiedades que el colega sí acepta.
  · Techo (lo más común): "Sólo hasta 3° piso", "máximo piso 7", "piso máximo 2", "menos del piso 10", "del 10 para abajo", "no más del 4" → piso_max 3, 7, 2, 9, 10, 4. Ojo con el borde, porque son dos cosas distintas: \"hasta el 10\", \"máximo 10\", \"del 10 para abajo\" y \"no más del 10\" INCLUYEN el 10 → piso_max 10. \"Menos del piso 10\" y \"por debajo del 10\" lo EXCLUYEN → piso_max 9. En los dos casos un piso 9 sirve, que es lo que no puede fallar: un \"menos de 10\" leído como piso exacto 10 borraría todos los pisos de abajo.
  · Piso mínimo: "del piso 6 hacia arriba", "piso 5 en adelante", "del 4 para arriba", "más del 3", "piso alto", "parte alta" → piso_min 6, 5, 4, 3, 4, 4.
  · Rango, que llena LOS DOS: "Piso 2 al 11" → piso_min 2 y piso_max 11. "entre un 4 a un piso 8" → 4 y 8. "solo 1 al 3 piso" → 1 y 3. "Piso 1 ó 2" → 1 y 2. "Piso 2 o 3" → 2 y 3.
  · Sin ascensor: "sin ascensor máximo segundo piso" → piso_max 2. Si el pedido da dos topes según haya ascensor ("sin ascensor máximo 2, hasta el 5 con ascensor"), tomá el más amplio: piso_max 5.
  · "Primer piso" o "piso bajo" (adultos mayores, mascotas, un local) → piso_max 2.
  · Un número solo, dicho como exigencia ("3° piso", "que sea en el piso 5") → piso_min y piso_max iguales a ese número. Es el caso MENOS común: antes de usarlo, mirá si la frase trae un "hasta", un "al", un "en adelante" o un "o", porque entonces es banda.
  · NO es una exigencia y va en 0 si el pedido lo pone como deseo: "ojalá piso 1", "preferiblemente piso bajo", "de ser posible piso alto".
  · NO es el nivel, y va en 0, el número de PLANTAS de una casa: "casa de dos pisos", "máximo 2 pisos" en un pedido de casa, "casa de un solo piso". Eso describe la casa, no en qué parte del edificio está.
  · Los dos van en 0 si el pedido no menciona el piso.
- \`periodo\`: 'corta' si el arriendo es por noches, días, semanas o una estadía de pocos días ("por 15 días", "3 noches", "renta corta", "airbnb"). 'mes' si es mensual o de largo plazo. '' si no se puede saber. Ojo: un precio alto no implica mensual — "$4.500.000 por 15 días" es 'corta' con precio_max 4500000.
- Un mensaje de una sola propiedad con foto y ficha es oferta aunque no diga "vendo".
- Devolvé exactamente un objeto por mensaje de entrada, con su id textual.

Ejemplos resueltos. Son mensajes inventados con la forma real de los grupos (nombres, teléfonos y precios son de mentira). Cada uno muestra solo los campos que definen el caso; el resto se llena con las reglas de arriba.

1. "Buenas colegas 🙏 tengo cliente para apto en Laureles o Estadio, 3 alcobas o 2 con estudio, hasta 480 millones, mínimo 85 m2, con parqueadero"
   → demanda · venta · apartamento · zonas ["Laureles","Estadio"] · precio_max 480000000 · habitaciones 3 · area_min 85 · garajes 1 · flexible_habitaciones true (dice "estudio").

2. "Se busca casa para arriendo en El Poblado ❌No Loma del Indio❌ presupuesto $9.000.000 SIN muebles"
   → demanda · arriendo · casa · zonas ["El Poblado"] · zonas_excluidas ["Loma del Indio"] · precio_max 9000000 · amoblado "no".

3. "Requiero apartamento amoblado en Sabaneta por 15 días para una familia que viene de afuera, pagan hasta 4.500.000"
   → demanda · arriendo · apartamento · zonas ["Sabaneta"] · precio_max 4500000 · amoblado "si" · periodo "corta". El precio alto no lo vuelve mensual.

4. "Alguien maneja algo en el edificio Torre Aqua de Envigado? cliente de contado"
   → demanda · venta · zonas ["Envigado"] · edificio "Torre Aqua". Si en cambio dijera "que sea unidad cerrada", edificio va vacío: no hay nombre propio.

5. "Para inversión: apartaestudio en Envigado o Sabaneta, hasta 280 palos, que ya esté rentando"
   → demanda · venta · apartaestudio · zonas ["Envigado","Sabaneta"] · precio_max 280000000 · flexible_habitaciones true (dice "para inversión").

6. "Necesito apto en Medellín para arriendo, 2 alcobas, hasta 2.5 millones, estrato 4 o 5"
   → demanda · arriendo · apartamento · zonas [] · ciudad "Medellín" · precio_max 2500000 · habitaciones 2 · estrato 4. Medellín sola es la ciudad, no una zona.

7. "Busco apartamento 👉 Laureles 👉 Fátima 👉 2 habitaciones 👉 Sólo hasta 3° piso 👉 Precio $400 Millones"
   → demanda · venta · apartamento · zonas ["Laureles","Fátima"] · habitaciones 2 · precio_max 400000000 · piso_max 3.

8. "Solo en Sabaneta ✅ 3 alcobas ✅ Sin ascensor máximo segundo piso ✅ hasta 450 millones"
   → demanda · venta · zonas ["Sabaneta"] · habitaciones 3 · precio_max 450000000 · piso_max 2. Sin ascensor, el tope de piso es una exigencia, no un gusto.

9. "Busco para cliente en Belén, 3 habitaciones, del piso 6 hacia arriba, hasta 520 millones"
   → demanda · venta · zonas ["Belén"] · habitaciones 3 · precio_max 520000000 · piso_min 6 · piso_max 0. Es una banda abierta hacia arriba, no el piso 6 exacto.

10. "Apartamento en Laureles, piso 2 al 11, obligatorio con ascensor, 2 alcobas"
   → demanda · venta · zonas ["Laureles"] · habitaciones 2 · piso_min 2 · piso_max 11. El rango llena los dos campos; un piso 9 sirve.

7. "Busco local comercial en Itagüí o La Estrella, arriendo hasta 6 millones, mínimo 120 metros"
   → demanda · arriendo · local · zonas ["Itagüí","La Estrella"] · precio_max 6000000 · area_min 120.

8. "📍 Belén | Apartamento 3 hab | 2 baños | 78 m² | Piso 6 con ascensor | $395.000.000 | Comisión compartida | Info Inmobiliaria Andes 300 000 0000"
   → oferta · venta · apartamento · zonas ["Belén"] · precio_max 395000000 · habitaciones 3 · contacto "Inmobiliaria Andes 300 000 0000". Una ficha con precio y datos es oferta aunque no diga "vendo".

9. "Sigue disponible el de Rionegro que les compartí ayer, comisión compartida"
   → oferta · zonas ["Rionegro"]. Es un colega recordando lo que ofrece, no pidiendo.

10. "Colegas, les comparto casa campestre en Llanogrande, 5 alcobas, lote de 2.000 m², venta 2.300 millones, recibe apartamento en Medellín como parte de pago"
   → oferta · venta · casa · zonas ["Llanogrande"] · precio_max 2300000000 · habitaciones 5. Aceptar un inmueble como parte de pago no la vuelve demanda.

11. "Busco colega que tenga cliente para mi apartamento en Calasanz, 3 alcobas, 520 millones, negociable"
   → oferta · venta · apartamento · zonas ["Calasanz"] · precio_max 520000000 · habitaciones 3. Dice "busco", pero busca comprador para algo que ya tiene: es oferta.

12. "Se cambia apartamento en Robledo por casa lote en Girardota o Barbosa, cliente con papeles al día"
   → demanda · permuta · zonas ["Girardota","Barbosa"]. Lo que se cruza contra el inventario es lo que busca a cambio; el apartamento que entrega va en notas.

13. "🔵 ¡BUSCAMOS *PROPIEDAD EN ENVIGADO!* 📍 Sector: UNIDAD CAMINO DE LAS AGUAS 🏠 Apartamento 📐 Desde 75 m² 🛏️ 3 habitaciones 💻 Espacio para estudio 💰 Presupuesto: hasta $470 millones"
   → demanda · venta · apartamento · zonas ["Camino de las Aguas"] · zona_madre "Envigado" · precio_max 470000000 · habitaciones 3 · area_min 75 · flexible_habitaciones true. Envigado contiene al sector, no es otra opción: una propiedad en Barrio Mesa, que también es Envigado, NO es lo pedido.

14. Ruido aunque nombre algo del oficio: "Mil gracias, ya lo contacto" · "Listo, le paso tu número a mi cliente" · "Alguien me recomienda un abogado para una sucesión?" · "Ok" · "Ahí te mandé" · un nombre suelto como respuesta. No hay propiedad ofrecida ni requerimiento concreto: clase ruido, con los campos vacíos o en 0.`;

// Caracteres por token del prefijo (system + esquema), medido con
// count_tokens el 2026-09-14: 2,45 sin los ejemplos; la prosa de los ejemplos
// rinde ~2,87. Solo lo usa el test del minimo cacheable: 2,6 subestima un poco
// los tokens, que es el lado seguro.
const CHARS_POR_TOKEN = 2.6;

function armarLotes(mensajes, tamano = TAMANO_LOTE) {
  const lotes = [];
  for (let i = 0; i < mensajes.length; i += tamano) lotes.push(mensajes.slice(i, i + tamano));
  return lotes;
}

function formatearLote(lote) {
  return lote
    .map((m) => `[${m.id}] (${m.autor || "sin autor"}): ${m.texto.replace(/\n+/g, " ")}`)
    .join("\n\n");
}

// Reintentable = el proveedor esta saturado o se cayo un momento. Un 400 (mal
// esquema, prompt invalido) NO se reintenta: fallaria las tres veces igual y
// solo retrasaria la corrida.
function esReintentable(e) {
  const status = e?.status ?? e?.statusCode;
  if (status === 429 || status === 408 || status === 409) return true;
  if (typeof status === "number" && status >= 500) return true;
  // Errores de red del SDK: no traen status.
  return status === undefined && /ECONN|ETIMEDOUT|fetch failed|network|socket/i.test(e?.message || "");
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function clasificarLote(lote, { reintentos = REINTENTOS, onReintento = () => {} } = {}) {
  for (let intento = 0; ; intento++) {
    try {
      return await pedirLote(lote);
    } catch (e) {
      if (intento >= reintentos.length || !esReintentable(e)) throw e;
      // Jitter: sin el, todos los lotes en vuelo reintentan en el mismo
      // instante y vuelven a chocar contra el mismo limite.
      const espera = reintentos[intento] + Math.floor(Math.random() * 1000);
      onReintento(intento + 1, espera, e);
      await dormir(espera);
    }
  }
}

async function pedirLote(lote) {
  const res = await getClient().messages.create({
    model: MODELO,
    // Un lote de 20 (import de exports) ya devolvia ~3.700 tokens medido el
    // 2026-09-21, y zona_madre suma unos 10 por mensaje: con 4.000 el JSON
    // salia cortado y el lote entero se perdia. Solo se cobra lo generado.
    max_tokens: 8000,
    // Cacheado (nota 4 arriba). Lo que cambia es el lote, que va en messages
    // y no toca el prefijo.
    system: [{ type: "text", text: SISTEMA, cache_control: CACHE_ESTABLE }],
    output_config: { format: { type: "json_schema", schema: ESQUEMA } },
    messages: [{ role: "user", content: `Clasificá estos ${lote.length} mensajes:\n\n${formatearLote(lote)}` }],
  });
  registrarUso("classify", res.usage);

  const texto = res.content.find((b) => b.type === "text")?.text || "";
  const datos = JSON.parse(texto);
  return { items: datos.mensajes || [], usage: res.usage || {} };
}

// Pool simple: N lotes en vuelo a la vez. Con pocos lotes da igual, pero un
// export de varios meses puede dar cientos y en serie la corrida se vuelve
// eterna.
async function conPool(items, limite, fn) {
  const resultados = new Array(items.length);
  let siguiente = 0;
  const workers = Array.from({ length: Math.min(limite, items.length) }, async () => {
    while (siguiente < items.length) {
      const i = siguiente++;
      resultados[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return resultados;
}

// mensajes: los que pasaron el prefiltro. Devuelve los clasificados (unidos a
// su mensaje original), el uso de tokens medido y cuantos lotes fallaron.
//
// Un lote que falla NO tumba la corrida: se registra y sus mensajes quedan
// fuera del analisis. El reporte muestra el conteo para que un fallo masivo
// no pase por una tasa de ruido alta.
async function classify(mensajes, { onProgreso = () => {}, reintentos = REINTENTOS } = {}) {
  const lotes = armarLotes(mensajes);
  const uso = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let lotesFallidos = 0;
  let reintentosTotales = 0;

  const porLote = await conPool(lotes, CONCURRENCIA, async (lote, i) => {
    try {
      const { items, usage } = await clasificarLote(lote, {
        reintentos,
        onReintento: (n, espera) => {
          reintentosTotales++;
          console.warn(`  ↻ Lote ${i + 1}/${lotes.length}: reintento ${n} en ${espera}ms`);
        },
      });
      uso.input_tokens += usage.input_tokens || 0;
      uso.output_tokens += usage.output_tokens || 0;
      uso.cache_read_input_tokens += usage.cache_read_input_tokens || 0;
      uso.cache_creation_input_tokens += usage.cache_creation_input_tokens || 0;
      onProgreso(i + 1, lotes.length);
      return items;
    } catch (e) {
      lotesFallidos++;
      console.error(`  ⚠ Lote ${i + 1}/${lotes.length} falló: ${e.message}`);
      // El progreso avanza igual: si no, una corrida con lotes fallidos deja
      // la barra congelada y parece colgada.
      onProgreso(i + 1, lotes.length);
      return [];
    }
  });

  // Se une por id para no depender del orden en que responda el modelo.
  const porId = new Map(mensajes.map((m) => [m.id, m]));
  const clasificados = porLote
    .flat()
    .filter((c) => porId.has(c.id))
    .map((c) => ({ ...c, mensaje: porId.get(c.id) }));

  return {
    clasificados,
    uso: { ...uso, costoUsd: costoDe(uso) },
    lotesFallidos,
    reintentos: reintentosTotales,
    lotes: lotes.length,
  };
}

// Con cache, `input_tokens` es solo lo fresco: lo leido se cobra a 0,1x y lo
// escrito a 2x con TTL de 1 hora (1,25x con 5 minutos). Sin sumarlos, el
// reporte de un import mostraria un costo menor al real.
const FACTOR_ESCRITURA = CACHE_ESTABLE.ttl === "1h" ? 2 : 1.25;

function costoDe({ input_tokens = 0, output_tokens = 0, cache_read_input_tokens = 0, cache_creation_input_tokens = 0 }) {
  const entrada = input_tokens + cache_read_input_tokens * 0.1 + cache_creation_input_tokens * FACTOR_ESCRITURA;
  return (entrada / 1e6) * USD_POR_MTOK_ENTRADA + (output_tokens / 1e6) * USD_POR_MTOK_SALIDA;
}

module.exports = {
  classify, armarLotes, formatearLote, costoDe, esReintentable, ESQUEMA, SISTEMA, CHARS_POR_TOKEN,
  MODELO, TAMANO_LOTE, CONCURRENCIA, REINTENTOS,
};
