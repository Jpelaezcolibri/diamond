const properties = require("../data/properties");
const leads = require("../data/leads");
const advisors = require("../data/advisors");
const { computeScore, isQualified } = require("./qualification");
const { buildClientLink } = require("../notifications/advisor");

const TOOL_DEFINITIONS = [
  {
    name: "buscar_propiedades",
    description:
      "Busca propiedades en el inventario de la inmobiliaria. Usala siempre que necesites informacion de propiedades: cuando el cliente mencione una referencia (ej AP001), describa lo que busca (zona, tipo, presupuesto) o pidas alternativas. Devuelve solo propiedades reales del inventario.",
    input_schema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Referencia exacta de la propiedad (codigo Wasi), ej 9702941" },
        zona: { type: "string", description: "Zona o ciudad de interes, ej El Poblado, Medellin" },
        tipo: { type: "string", description: "Tipo de propiedad: Apartamento, Casa, Apartaestudio" },
        precio_max: { type: "integer", description: "Precio maximo en pesos, ej 1200000" },
        habitaciones_min: { type: "integer", description: "Minimo de habitaciones" },
      },
    },
  },
  {
    name: "registrar_dato_lead",
    description:
      "Registra un dato del cliente en la base de datos. Usala cada vez que el cliente revele su nombre, presupuesto, zona de interes, tipo de propiedad que busca o urgencia (cuando necesita mudarse). Registrar estos datos es clave para calificar el lead.",
    input_schema: {
      type: "object",
      properties: {
        campo: {
          type: "string",
          enum: ["nombre", "presupuesto", "zona_interes", "tipo_interes", "urgencia", "forma_pago"],
          description: "El dato a registrar. forma_pago: como piensa pagar el cliente (credito hipotecario, recursos propios, mixto)",
        },
        valor: { type: "string", description: "El valor tal como lo expreso el cliente" },
      },
      required: ["campo", "valor"],
    },
  },
  {
    name: "transferir_a_asesor",
    description:
      "Transfiere el cliente al asesor humano especializado. Usala cuando el cliente pida explicitamente hablar con una persona/asesor, o cuando el lead este calificado y acepte ser contactado. El sistema alertara automaticamente al asesor de la especialidad correcta con el resumen del lead.",
    input_schema: {
      type: "object",
      properties: {
        motivo: { type: "string", description: "Motivo breve de la transferencia" },
        especialidad: {
          type: "string",
          enum: ["venta", "arriendo", "vehiculos", "otro"],
          description:
            "A que asesor va el cliente segun lo que busca: venta (compra de propiedad), arriendo, vehiculos (carros/motos), u otro para todo lo demas",
        },
      },
      required: ["motivo", "especialidad"],
    },
  },
];

// Ejecuta una tool. ctx: { org, lead, propertyInteres, transfer } — el engine lee
// ctx.lead (actualizado) y ctx.transfer despues del loop.
async function executeTool(name, input, ctx) {
  if (name === "buscar_propiedades") {
    let results;
    if (input.ref) {
      const prop = await properties.findByRef(ctx.org.id, input.ref);
      results = prop ? [prop] : [];
    } else {
      results = await properties.search(ctx.org.id, input);
    }
    const disponibles = results.filter((p) => p.disponible);
    if (disponibles.length > 0 && !ctx.propertyInteres) ctx.propertyInteres = disponibles[0];
    // Las propiedades que busca definen su tablero (compra/alquiler) aunque no haya dado ref
    if (disponibles.length > 0 && (!ctx.lead.categoria || ctx.lead.categoria === "otros")) {
      const categoria = (disponibles[0].operacion || "").toLowerCase() === "arriendo" ? "alquiler" : "compra";
      Object.assign(ctx.lead, await leads.update(ctx.lead.id, { categoria }));
    }
    if (results.length === 0) {
      return "No se encontraron propiedades con esos criterios en el inventario.";
    }
    return JSON.stringify(results, null, 2);
  }

  if (name === "registrar_dato_lead") {
    const updated = await leads.update(ctx.lead.id, { [input.campo]: input.valor });
    Object.assign(ctx.lead, updated);
    // El tipo de interes define el tablero del lead (compra/alquiler)
    if (input.campo === "tipo_interes") {
      const v = input.valor.toLowerCase();
      const categoria = /arriendo|alquil|rentar/.test(v) ? "alquiler" : /venta|compra/.test(v) ? "compra" : null;
      if (categoria && categoria !== ctx.lead.categoria) {
        Object.assign(ctx.lead, await leads.update(ctx.lead.id, { categoria }));
      }
    }
    const score = computeScore(ctx.lead);
    const qualified = isQualified(ctx.lead);
    await leads.update(ctx.lead.id, {
      score,
      estado: qualified && ctx.lead.estado !== "transferido" ? "calificado" : ctx.lead.estado,
    });
    ctx.lead.score = score;
    if (qualified && ctx.lead.estado !== "transferido") ctx.lead.estado = "calificado";
    return `Dato registrado: ${input.campo} = ${input.valor}. Score del lead: ${score}/100. ${
      qualified
        ? "El lead esta CALIFICADO: ofrece conectarlo con el asesor humano."
        : "El lead aun no califica: sigue averiguando presupuesto, urgencia o preferencias de forma natural."
    }`;
  }

  if (name === "transferir_a_asesor") {
    const especialidad =
      input.especialidad ||
      (ctx.propertyInteres?.operacion || "").toLowerCase() ||
      "venta";
    const advisor = await advisors.findForTransfer(ctx.org, especialidad);
    if (!advisor) {
      return "No hay asesor configurado para esta organizacion. Pide disculpas y dile al cliente que pronto lo contactaran.";
    }
    ctx.transfer = { motivo: input.motivo || "Cliente solicito asesor", advisor, especialidad };
    const catMap = { venta: "compra", arriendo: "alquiler" };
    const categoria = catMap[especialidad] || "otros";
    if (categoria !== ctx.lead.categoria) {
      Object.assign(ctx.lead, await leads.update(ctx.lead.id, { categoria }));
    }
    const link = buildClientLink(advisor, ctx.lead, ctx.propertyInteres);
    return `Transferencia registrada al asesor de ${especialidad}: ${advisor.name}. Ya fue alertado con el resumen del cliente. En tu respuesta despidete brevemente e incluye este link EXACTO para que el cliente hable directo con el asesor:\n${link}`;
  }

  return `Herramienta desconocida: ${name}`;
}

module.exports = { TOOL_DEFINITIONS, executeTool };
