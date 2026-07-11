// Herramientas de Sofi-Comando (copiloto interno). Distintas de las de
// Sofi-Cliente (src/agent/tools.js): aqui el interlocutor es un asesor/admin,
// no un lead. Cada tool recibe el `scope` por fuera del control del modelo —
// NUNCA acepta el alcance desde el input.
const command = require("../data/command");
const properties = require("../data/properties");
const allyProperties = require("../data/ally-properties");

const COMMAND_TOOL_DEFINITIONS = [
  {
    name: "consultar_seguimientos",
    description:
      "Lista los clientes que necesitan seguimiento: calificados o transferidos sin actividad reciente, y citas proximas o vencidas. Devuelve un resumen compacto ya filtrado por el alcance del usuario. Usala cuando pregunten por seguimientos, pendientes, a quien contactar o el estado del dia.",
    input_schema: {
      type: "object",
      properties: {
        dias: {
          type: "number",
          description: "Dias de inactividad para considerar que un lead necesita seguimiento (default 3).",
        },
      },
    },
  },
  {
    name: "metricas_leads",
    description:
      "Devuelve el conteo de leads del periodo (por defecto hoy), desglosado por estado y por fuente, ya filtrado por el alcance del usuario. Usala para preguntas como cuantos leads llegaron hoy o de donde vinieron.",
    input_schema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "Fecha ISO de inicio (opcional)." },
        hasta: { type: "string", description: "Fecha ISO de fin (opcional)." },
      },
    },
  },
  {
    name: "sugerir_siguiente_accion",
    description:
      "Devuelve el foco actual de la conversacion (propiedad o lead en discusion) para proponer el siguiente paso logico. Usala cuando el asesor pida que hacer ahora o para encadenar el siguiente movimiento.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "buscar_inventario",
    description:
      "Busca propiedades en el inventario PROPIO de la inmobiliaria para ayudar al asesor a encontrar opciones para un cliente — este o no registrado en el CRM. Usala siempre que pidan propiedades por referencia, zona, tipo, presupuesto o caracteristicas. Devuelve las fichas completas (incluida la descripcion): usa la descripcion para filtrar detalles como vista, balcon, parqueadero o piso alto que no tienen campo propio.",
    input_schema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Referencia exacta de la propiedad (codigo Wasi), ej 9776475" },
        zona: { type: "string", description: "Zona, barrio o ciudad, ej Laureles, El Poblado, Envigado" },
        tipo: { type: "string", description: "Tipo de propiedad: Apartamento, Casa, Apartaestudio, Finca, Lote" },
        precio_max: { type: "integer", description: "Presupuesto maximo en pesos, ej 1300000000 para $1.300 millones" },
        habitaciones_min: { type: "integer", description: "Minimo de habitaciones" },
        limite: { type: "integer", description: "Cuantas propiedades traer (default 5, maximo 10). Sube el limite cuando el asesor pida un analisis amplio." },
      },
    },
  },
  {
    name: "buscar_red_aliados",
    description:
      "Busca en las propiedades que colegas de OTRAS inmobiliarias compartieron a la red de aliados. Aqui hablas con el asesor, asi que SI puedes mostrarle todo: precio, zona, referencia y el contacto del colega. Usala cuando el inventario propio no alcance, cuando pidan explicitamente opciones de aliados, o para un analisis completo de lo disponible. Sin filtros devuelve las mas recientes.",
    input_schema: {
      type: "object",
      properties: {
        zona: { type: "string", description: "Zona, barrio o ciudad" },
        tipo: { type: "string", description: "Tipo de propiedad" },
        operacion: { type: "string", enum: ["Venta", "Arriendo"], description: "Omitir si no esta claro" },
        precio_max: { type: "integer", description: "Presupuesto maximo en pesos" },
        limite: { type: "integer", description: "Cuantas traer (default 5, maximo 10)" },
      },
    },
  },
];

// Techo de resultados por consulta: suficiente para un analisis, sin inundar
// el contexto del modelo con fichas completas.
const MAX_RESULTADOS = 10;

function capLimit(limite, fallback = 5) {
  const n = parseInt(limite, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, MAX_RESULTADOS);
}

// ctx: { scope, session } — el scope y el foco de la sesion vienen del servidor,
// no del modelo.
async function executeCommandTool(name, input, ctx) {
  const { scope, session } = ctx;
  switch (name) {
    case "consultar_seguimientos": {
      const data = await command.seguimientos(scope, { dias: input?.dias || 3 });
      return JSON.stringify(data);
    }
    case "metricas_leads": {
      const data = await command.metricasLeads(scope, {
        desde: input?.desde || null,
        hasta: input?.hasta || null,
      });
      return JSON.stringify(data);
    }
    case "sugerir_siguiente_accion": {
      return JSON.stringify({ foco: session?.active_context || "sin foco activo" });
    }
    case "buscar_inventario": {
      // El orgId viene del scope del servidor, nunca del modelo.
      let results;
      if (input?.ref) {
        const prop = await properties.findByRef(scope.orgId, input.ref);
        results = prop ? [prop] : [];
      } else {
        results = await properties.search(
          scope.orgId,
          {
            zona: input?.zona,
            tipo: input?.tipo,
            precio_max: input?.precio_max,
            habitaciones_min: input?.habitaciones_min,
          },
          capLimit(input?.limite)
        );
      }
      if (results.length === 0) {
        return "Sin resultados en el inventario propio con esos criterios. Puedes ampliar la busqueda (quitar filtros, subir presupuesto, zonas vecinas segun la geografia) o revisar la red de aliados con buscar_red_aliados.";
      }
      return JSON.stringify(results, null, 2);
    }
    case "buscar_red_aliados": {
      const results = await allyProperties.search(
        scope.orgId,
        {
          zona: input?.zona,
          tipo: input?.tipo,
          operacion: input?.operacion,
          precioMax: input?.precio_max,
        },
        capLimit(input?.limite)
      );
      if (results.length === 0) {
        return "No hay propiedades de aliados que coincidan con esos criterios en la red.";
      }
      return (
        "Propiedades de la RED DE ALIADOS (son de otras inmobiliarias — recuerdale al asesor confirmar disponibilidad y condiciones con el colega antes de ofrecerlas a su cliente):\n" +
        JSON.stringify(results, null, 2)
      );
    }
    default:
      return `Herramienta desconocida: ${name}`;
  }
}

module.exports = { COMMAND_TOOL_DEFINITIONS, executeCommandTool };
