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
    name: "resumen_lead",
    description:
      "Trae la ficha de un lead y su conversacion completa con Sofi, para preparar la llamada o el seguimiento del asesor. Usala cuando pregunten por un cliente especifico ('preparame la llamada con Marta', 'que sabemos del 3001234567', 'que pidio Javier'). Busca por nombre o por telefono. Con el resultado, resume: que busca, presupuesto, objeciones o dudas que planteo, propiedad de interes, y sugiere UNA apertura concreta para la llamada.",
    input_schema: {
      type: "object",
      properties: {
        cliente: { type: "string", description: "Nombre (o parte del nombre) o telefono del lead" },
      },
      required: ["cliente"],
    },
  },
  {
    name: "cruzar_propiedad_leads",
    description:
      "Dada una propiedad del inventario (por referencia), encuentra los leads activos del alcance del asesor que encajan por zona de interes, presupuesto y tipo — convierte una propiedad en una lista de clientes a llamar. Usala cuando pregunten 'a quien le puede servir esta propiedad', 'quien de mis leads encaja con la ref X' o cuando entre inventario nuevo.",
    input_schema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Referencia de la propiedad (codigo Wasi), ej 9776475" },
      },
      required: ["ref"],
    },
  },
  {
    name: "cerrar_lead",
    description:
      "Cierra el negocio de un lead como GANADO o PERDIDO. Usala cuando el asesor diga que un cliente compro/firmo/arrendo (ganado) o que el negocio se cayo/no va (perdido). Si es ganado y el asesor no dio el valor del negocio, PREGUNTALE el valor ANTES de cerrar. Si es perdido y no dio el motivo, PREGUNTALE el motivo en una frase ANTES de cerrar — ese dato vale oro para el negocio. Busca el lead por nombre o telefono.",
    input_schema: {
      type: "object",
      properties: {
        cliente: { type: "string", description: "Nombre o telefono del lead a cerrar" },
        resultado: { type: "string", enum: ["ganado", "perdido"], description: "ganado: compro/firmo. perdido: el negocio no se dio." },
        valor: { type: "string", description: "Valor del negocio tal como lo dijo el asesor (ej '340 millones'). Solo para ganado." },
        motivo: { type: "string", description: "Por que se perdio, en una frase (ej 'compro con otra inmobiliaria', 'no le salio el credito'). Solo para perdido." },
      },
      required: ["cliente", "resultado"],
    },
  },
  {
    name: "embudo_ventas",
    description:
      "Devuelve el embudo del periodo (por defecto ultimos 30 dias) por fuente: leads -> calificados -> transferidos -> ganados/perdidos, con el valor total ganado. Usala para preguntas de conversion, rendimiento por fuente/campana, cuanto se vendio, o que fuente trae mejores leads. El asesor ve su embudo; el admin el de toda la organizacion.",
    input_schema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "Fecha ISO de inicio (opcional, default hace 30 dias)" },
        hasta: { type: "string", description: "Fecha ISO de fin (opcional, default ahora)" },
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
  {
    name: "registrar_propiedad_colega",
    description:
      "Registra una propiedad que un colega de OTRA inmobiliaria le comparte al asesor, para sumarla a la red de aliados del equipo. Usala cuando el asesor te cuente que un colega tiene un inmueble disponible ('mi colega Andrea de Century21 tiene un apto en Laureles en arriendo'). Queda guardada con el asesor como quien la registro: si mas adelante un cliente pregunta por algo similar, se le avisa a EL primero.",
    input_schema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Referencia de la propiedad, si la dieron" },
        titulo: { type: "string", description: "Titulo o descripcion corta" },
        tipo: { type: "string", description: "Tipo de propiedad: Apartamento, Casa, Apartaestudio, Finca, Lote" },
        operacion: { type: "string", enum: ["Venta", "Arriendo"] },
        precio: { type: "string", description: "Precio o canon, tal como lo dieron" },
        zona: { type: "string", description: "Zona o barrio" },
        ciudad: { type: "string", description: "Ciudad o municipio" },
        descripcion: { type: "string", description: "Resto de detalles relevantes en texto libre" },
        inmobiliaria_origen: { type: "string", description: "Inmobiliaria del colega" },
        contacto_nombre: { type: "string", description: "Nombre del colega que comparte la propiedad" },
        contacto_telefono: { type: "string", description: "Telefono del colega, si lo dieron" },
      },
      required: ["contacto_nombre"],
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
    case "resumen_lead": {
      const candidatos = await command.buscarLeads(scope, input?.cliente);
      if (candidatos.length === 0) {
        return `No encontre ningun lead que coincida con "${input?.cliente}" en tu alcance. Puede estar a nombre de otro asesor, con otro nombre, o no estar registrado todavia.`;
      }
      if (candidatos.length > 1) {
        const lista = candidatos.map((l) => ({ nombre: l.nombre || "(sin nombre)", phone: l.phone, estado: l.estado }));
        return `Hay ${candidatos.length} leads que coinciden — pregunta al asesor cual es antes de resumir:\n${JSON.stringify(lista, null, 2)}`;
      }
      const data = await command.conversacionDeLead(scope, candidatos[0].id);
      if (!data) return "El lead existe pero no esta en tu alcance.";
      const { lead, mensajes } = data;
      const ficha = {
        nombre: lead.nombre || null,
        phone: lead.phone || null,
        estado: lead.estado,
        score: lead.score || 0,
        presupuesto: lead.presupuesto || null,
        zona_interes: lead.zona_interes || null,
        tipo_interes: lead.tipo_interes || null,
        urgencia: lead.urgencia || null,
        forma_pago: lead.forma_pago || null,
        intencion: lead.intencion || null,
        propiedad_origen: lead.property_ref_origen || null,
        cita: lead.cita || null,
        fuente: lead.source || null,
      };
      return JSON.stringify({ ficha, conversacion: mensajes }, null, 2);
    }
    case "cruzar_propiedad_leads": {
      const prop = await properties.findByRef(scope.orgId, input?.ref || "");
      if (!prop) {
        return `No encontre la referencia ${input?.ref} en el inventario. Verifica el codigo o busca la propiedad con buscar_inventario.`;
      }
      const candidatos = await command.leadsParaPropiedad(scope, prop);
      const resumenProp = { ref: prop.ref, titulo: prop.titulo, precio: prop.precio, zona: prop.zona, ciudad: prop.ciudad, operacion: prop.operacion, disponible: prop.disponible };
      if (candidatos.length === 0) {
        return `Ningun lead activo de tu alcance encaja hoy con esta propiedad:\n${JSON.stringify(resumenProp)}\nPuedes ampliar revisando leads sin zona o presupuesto registrado en el CRM.`;
      }
      return (
        "Leads que encajan con la propiedad (presenta los 2-3 mejores con el porque de cada uno; coincide_en dice en que coincidio):\n" +
        JSON.stringify({ propiedad: resumenProp, candidatos }, null, 2)
      );
    }
    case "cerrar_lead": {
      const candidatos = await command.buscarLeads(scope, input?.cliente);
      if (candidatos.length === 0) {
        return `No encontre ningun lead que coincida con "${input?.cliente}" en tu alcance — no cerre nada.`;
      }
      if (candidatos.length > 1) {
        const lista = candidatos.map((l) => ({ nombre: l.nombre || "(sin nombre)", phone: l.phone, estado: l.estado }));
        return `Hay ${candidatos.length} leads que coinciden — pregunta al asesor cual es antes de cerrar (no cerre nada):\n${JSON.stringify(lista, null, 2)}`;
      }
      const objetivo = candidatos[0];
      if (["cerrado_ganado", "cerrado_perdido"].includes(objetivo.estado)) {
        return `${objetivo.nombre || objetivo.phone} ya estaba cerrado (${objetivo.estado}). No lo modifique.`;
      }
      const cerrado = await command.cerrarLead(scope, objetivo.id, {
        resultado: input.resultado,
        valor: input?.valor || null,
        motivo: input?.motivo || null,
      });
      if (!cerrado) return "El lead existe pero no esta en tu alcance — no cerre nada.";
      const detalle =
        input.resultado === "ganado"
          ? `GANADO${cerrado.valor_cierre ? ` por $${Number(cerrado.valor_cierre).toLocaleString("es-CO")}` : " (sin valor registrado)"}`
          : `PERDIDO${input?.motivo ? ` — motivo: ${input.motivo}` : " (sin motivo registrado)"}`;
      return `Listo: ${cerrado.nombre || cerrado.phone} quedo cerrado como ${detalle}. Confirmaselo al asesor en una linea${
        input.resultado === "ganado" ? " y felicitalo" : ""
      }.`;
    }
    case "embudo_ventas": {
      const data = await command.embudo(scope, { desde: input?.desde || null, hasta: input?.hasta || null });
      return (
        "Embudo del periodo (cohorte por fecha de creacion del lead; presenta lo esencial y resalta la fuente que mejor convierte):\n" +
        JSON.stringify(data, null, 2)
      );
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
    case "registrar_propiedad_colega": {
      await allyProperties.create(scope.orgId, {
        ...input,
        registrado_por: scope.viewerUid,
      });
      return `Propiedad de ${input.contacto_nombre} registrada en la red de aliados. Si un cliente pregunta por algo similar, te avisaremos a ti primero para que valides disponibilidad.`;
    }
    default:
      return `Herramienta desconocida: ${name}`;
  }
}

module.exports = { COMMAND_TOOL_DEFINITIONS, executeCommandTool };
