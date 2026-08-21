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
// Sin prompt caching a proposito: el minimo cacheable de Haiku 4.5 es de 4096
// tokens y el prompt de sistema esta muy por debajo, asi que un cache_control
// aca no haria nada (silenciosamente) y solo cobraria el premium de escritura.

const { getClient } = require("../lib/anthropic");

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
          "TODAS las zonas o barrios que menciona el pedido. 'POBLADO/ENVIGADO' son DOS: ['El Poblado','Envigado']. Lista vacia si no nombra ninguna. Nunca metas la ciudad aca.",
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
        },
        required: [
          "id", "clase", "confianza", "operacion", "tipo", "zonas", "zona", "zonas_excluidas", "ciudad",
          "precio_min", "precio_max", "habitaciones", "area_min", "banos",
          "garajes", "estrato", "contacto", "notas", "flexible_habitaciones", "edificio",
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
- No inventes datos. Si el mensaje no lo dice, dejá el string vacío o el 0. Esto es especialmente importante en \`zona\`: una demanda sin zona NO se puede cruzar contra el inventario, y es mejor dejarla vacía que poner una zona aproximada — una zona inventada manda al asesor a ofrecer algo del barrio equivocado.
- \`zonas\` es la LISTA de barrios o sectores que nombra el pedido. Un colega pide en varias a la vez y hay que capturarlas TODAS: "POBLADO/ENVIGADO" → ["El Poblado","Envigado"]; "Laureles o Estadio" → ["Laureles","Estadio"]; "Sabaneta" → ["Sabaneta"]. Lista vacía si no nombra ninguna.
- \`zona\` es la primera de esa lista, o vacío. Se conserva por compatibilidad; lo que importa es \`zonas\`.
- \`zonas_excluidas\`: BUG real (2026-08-20) — un pedido que decía "❌No Loma del Indio" se guardaba sin ese dato, y el motor podía ofrecer justo lo que el cliente rechazó. Capturá TODA zona que el mensaje excluya explícitamente ("No X", "❌ X", "menos X", "excepto X", "X no"). Una zona nunca va en \`zonas\` y en \`zonas_excluidas\` a la vez.
- Si el mensaje sólo nombra el municipio ("Medellín"), eso va en \`ciudad\`, no en \`zonas\`. Pero ojo: Envigado, Sabaneta, Itagüí y La Estrella son municipios que en estos grupos se usan como zona — van en \`zonas\`.
- \`area_min\` en metros cuadrados: "mínimo 85 m2" → 85; "de 100 metros" → 100.
- \`banos\`, \`garajes\` y \`estrato\`: sólo si el mensaje los pide explícitamente. "2 baños, parqueadero doble" → banos 2, garajes 2. "estrato 5 o 6" → 5 (el mínimo).
- \`flexible_habitaciones\`: true SOLO si el mensaje dice "estudio" (ej. "3 alcobas o 2 con estudio", "2 alcobas y estudio") o "para inversión"/"para invertir". No lo actives por intuición ni por el tono del pedido — solo por esas palabras.
- \`edificio\`: nombre PROPIO de un edificio, torre, conjunto o unidad que el pedido nombre explícitamente — "en el *edificio Murano Plaza*", "Torre Aqua", "Conjunto Los Cerezos". Vacío si el pedido solo da zona/barrio, o si dice "unidad cerrada"/"conjunto cerrado" como característica genérica SIN nombre propio ("que sea unidad cerrada" no cuenta; "en la unidad Reserva del Parque" sí). No confundas esto con el nombre de la inmobiliaria de quien pide, ni con el nombre del barrio.
- Un mensaje de una sola propiedad con foto y ficha es oferta aunque no diga "vendo".
- Devolvé exactamente un objeto por mensaje de entrada, con su id textual.`;

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
    max_tokens: 4000,
    system: SISTEMA,
    output_config: { format: { type: "json_schema", schema: ESQUEMA } },
    messages: [{ role: "user", content: `Clasificá estos ${lote.length} mensajes:\n\n${formatearLote(lote)}` }],
  });

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
  const uso = { input_tokens: 0, output_tokens: 0 };
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

function costoDe({ input_tokens = 0, output_tokens = 0 }) {
  return (input_tokens / 1e6) * USD_POR_MTOK_ENTRADA + (output_tokens / 1e6) * USD_POR_MTOK_SALIDA;
}

module.exports = {
  classify, armarLotes, formatearLote, costoDe, esReintentable,
  MODELO, TAMANO_LOTE, CONCURRENCIA, REINTENTOS,
};
