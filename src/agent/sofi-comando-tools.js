// Herramientas de Sofi-Comando (copiloto interno). Distintas de las de
// Sofi-Cliente (src/agent/tools.js): aqui el interlocutor es un asesor/admin,
// no un lead. Cada tool recibe el `scope` por fuera del control del modelo —
// NUNCA acepta el alcance desde el input.
const command = require("../data/command");

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
];

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
    default:
      return `Herramienta desconocida: ${name}`;
  }
}

module.exports = { COMMAND_TOOL_DEFINITIONS, executeCommandTool };
