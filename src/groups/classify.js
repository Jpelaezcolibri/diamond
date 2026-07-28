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
const CONCURRENCIA = 4;

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
          zona: { type: "string", description: "Barrio o sector. Vacio si no se menciona" },
          ciudad: { type: "string", description: "Vacio si no se menciona" },
          precio_min: { type: "integer", description: "Pesos colombianos. 0 si no se especifica" },
          precio_max: { type: "integer", description: "Pesos colombianos. 0 si no se especifica" },
          habitaciones: { type: "integer", description: "0 si no se especifica" },
          contacto: { type: "string", description: "Telefono o nombre si el mensaje lo trae. Vacio si no" },
          notas: { type: "string", description: "Detalle relevante en pocas palabras" },
        },
        required: [
          "id", "clase", "confianza", "operacion", "tipo", "zona", "ciudad",
          "precio_min", "precio_max", "habitaciones", "contacto", "notas",
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
- No inventes datos. Si el mensaje no lo dice, dejá el string vacío o el 0.
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

async function clasificarLote(lote) {
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
async function classify(mensajes, { onProgreso = () => {} } = {}) {
  const lotes = armarLotes(mensajes);
  const uso = { input_tokens: 0, output_tokens: 0 };
  let lotesFallidos = 0;

  const porLote = await conPool(lotes, CONCURRENCIA, async (lote, i) => {
    try {
      const { items, usage } = await clasificarLote(lote);
      uso.input_tokens += usage.input_tokens || 0;
      uso.output_tokens += usage.output_tokens || 0;
      onProgreso(i + 1, lotes.length);
      return items;
    } catch (e) {
      lotesFallidos++;
      console.error(`  ⚠ Lote ${i + 1}/${lotes.length} falló: ${e.message}`);
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
    lotes: lotes.length,
  };
}

function costoDe({ input_tokens = 0, output_tokens = 0 }) {
  return (input_tokens / 1e6) * USD_POR_MTOK_ENTRADA + (output_tokens / 1e6) * USD_POR_MTOK_SALIDA;
}

module.exports = { classify, armarLotes, formatearLote, costoDe, MODELO, TAMANO_LOTE };
