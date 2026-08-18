// Herramientas de Sofi-Comando (copiloto interno). Distintas de las de
// Sofi-Cliente (src/agent/tools.js): aqui el interlocutor es un asesor/admin,
// no un lead. Cada tool recibe el `scope` por fuera del control del modelo —
// NUNCA acepta el alcance desde el input.
const command = require("../data/command");
const properties = require("../data/properties");
const allyProperties = require("../data/ally-properties");
const advisors = require("../data/advisors");
const radarTrazabilidad = require("../data/radar-trazabilidad");
const groupSignals = require("../data/group-signals");
const signalEvents = require("../data/signal-events");
const organizations = require("../data/organizations");
const mensajeAsesor = require("../lib/mensaje-asesor");
const validarMensaje = require("../lib/validar-mensaje");
const resumenEquipo = require("../groups/resumen-equipo");

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
  {
    name: "marcar_propiedad",
    description:
      "Marca una propiedad del inventario propio a nombre de un asesor (su captador). Desde ese momento, cuando un cliente muestre interes en esa propiedad, el captador recibe el aviso y el lead se le transfiere a el. Usala cuando digan 'marca la propiedad X a nombre de Y' o 'esa propiedad es de Y'. Cualquier miembro del equipo puede marcar.",
    input_schema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Referencia de la propiedad (codigo Wasi), ej 10207832" },
        asesor: { type: "string", description: "Nombre (o parte del nombre) del asesor captador, ej Natalia" },
      },
      required: ["ref", "asesor"],
    },
  },
  {
    name: "consultar_captador",
    description:
      "Consulta quien es el captador de una propiedad (por ref) o que propiedades tiene marcadas un asesor (por nombre). Usala para 'de quien es la ref X' o 'que propiedades tiene Natalia'.",
    input_schema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Referencia de la propiedad" },
        asesor: { type: "string", description: "Nombre del asesor" },
      },
    },
  },
  {
    name: "crear_recordatorio",
    description:
      "Crea un recordatorio para el asesor que esta chateando ahora mismo. Si tiene fecha/hora (una cita, visita o llamada agendada), queda visible para TODO el equipo en el Calendario del equipo del CRM; sin fecha/hora es una nota personal que solo el ve. Usala cuando pida que le recuerdes algo. Si menciona un cliente que existe en el CRM, se lo vincula automaticamente.",
    input_schema: {
      type: "object",
      properties: {
        descripcion: { type: "string", description: "El recordatorio tal como lo pidio, ej 'llamar a Pedro por el credito', 'cita con Marta a las 3pm'" },
        fecha_hora_iso: { type: "string", description: "Fecha/hora ISO si dio dia/hora (resuelve 'manana', 'el jueves' con la fecha actual del sistema). Omitir si no dio fecha." },
        cliente: { type: "string", description: "Nombre o telefono del cliente relacionado, si aplica" },
      },
      required: ["descripcion"],
    },
  },
  {
    name: "trazabilidad_radar",
    description:
      "Muestra el recorrido completo de los pedidos que el radar detecto en los grupos gremiales: que entro, que encontro el motor con su puntaje y si la zona era exacta o vecina, que decidio Sofi y por que, si el aviso llego a la asesora, y en que termino. Usala cuando pregunten como va el radar, si esta sirviendo, que paso con los pedidos de los grupos, por que no llego un aviso, o para calibrar el motor. El admin ve toda la organizacion; un asesor solo lo suyo.",
    input_schema: {
      type: "object",
      properties: {
        dias: { type: "number", description: "Ventana hacia atras en dias (default 7)." },
        solo_con_aviso: {
          type: "boolean",
          description: "true para ver unicamente las que llegaron a la asesora.",
        },
      },
    },
  },
  {
    name: "consultar_recordatorios",
    description:
      "Lista los recordatorios personales pendientes del asesor que esta chateando. Usala cuando pregunte 'que tengo pendiente', 'mis recordatorios' o 'que se me olvido'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "completar_recordatorio",
    description:
      "Marca un recordatorio personal como resuelto. Usala cuando el asesor diga que ya hizo algo que tenia pendiente ('ya llame a Pedro', 'listo con la cita de Marta').",
    input_schema: {
      type: "object",
      properties: {
        referencia: { type: "string", description: "Como describe el asesor el recordatorio — una frase o parte de la descripcion original" },
      },
      required: ["referencia"],
    },
  },
  {
    name: "registrar_resultado_radar",
    description:
      "Registra en que quedo un pedido del radar (ej 'el de Sabaneta no sirvio', 'hubo visita', 'se cerro', 'no contesto'). Usala cuando el admin te cuente el resultado de un pedido — sea porque la asesora se lo conto a el, o porque el mismo lo sabe. Si hay varios pedidos sin resultado, te los va a listar con quien los recibio para que preguntes cual.",
    input_schema: {
      type: "object",
      properties: {
        tipo: {
          type: "string",
          enum: ["CONVERSACION", "VISITA", "NEGOCIACION", "CIERRE", "PERDIDO", "SIN_RESPUESTA"],
          description: "CONVERSACION=le escribieron al colega, VISITA=hubo visita, NEGOCIACION=estan hablando de precio, CIERRE=se cerro el negocio, PERDIDO=se cayo, SIN_RESPUESTA=el colega no contesto.",
        },
        motivo: { type: "string", description: "Por que se perdio o cualquier detalle adicional. Opcional." },
        cual: { type: "string", description: "Si hay varios pedidos pendientes, zona/colega/parte del texto o nombre del asesor para desambiguar." },
      },
      required: ["tipo"],
    },
  },
  {
    name: "enviar_whatsapp_equipo",
    description:
      "Manda un mensaje de WhatsApp a un miembro del equipo (asesor). SOLO funciona si ese asesor te escribio en las ultimas 24 horas — es una regla de WhatsApp, no de Sofi. Si la ventana esta cerrada te va a decir que no se pudo enviar; en ese caso decile al admin que lo avise por otro medio, nunca digas que salio si no salio. NO es para clientes finales — solo para gente del equipo.",
    input_schema: {
      type: "object",
      properties: {
        asesor: { type: "string", description: "Nombre del asesor a quien escribirle" },
        mensaje: { type: "string", description: "El texto exacto a enviar" },
      },
      required: ["asesor", "mensaje"],
    },
  },
  {
    name: "crear_recordatorio_equipo",
    description:
      "Crea un recordatorio para OTRO asesor del equipo — no para vos. Usala cuando el admin diga 'recordale a Fulano que...', 'que Sofi le avise a Fulano de...'. Si tiene fecha/hora queda en el Calendario del equipo (lo ve todo el mundo); sin fecha/hora es una nota personal que solo esa persona ve.",
    input_schema: {
      type: "object",
      properties: {
        asesor: { type: "string", description: "Nombre del asesor a quien va dirigido el recordatorio" },
        descripcion: { type: "string", description: "El recordatorio tal como lo pidio el admin" },
        fecha_hora_iso: { type: "string", description: "Fecha/hora ISO si dio dia/hora. Omitir si no dio fecha." },
      },
      required: ["asesor", "descripcion"],
    },
  },
  {
    name: "enviar_matches_pendientes_equipo",
    description:
      "Arma y manda UN mensaje consolidado con los matches del radar que ese asesor tiene pendientes de seguimiento — el pedido citado tal como lo escribio el colega, las refs que le sirven, y el link real de contacto (o 'sin telefono' si no lo hay). El contenido sale del dato validado de trazabilidad_radar, no lo redactas vos, asi que nunca lleva un link inventado. USALA en vez de armar el texto a mano con enviar_whatsapp_equipo cuando lo que hay que mandar son pedidos del radar — es mas confiable.",
    input_schema: {
      type: "object",
      properties: {
        asesor: { type: "string", description: "Nombre del asesor a quien se le manda el resumen" },
      },
      required: ["asesor"],
    },
  },
];

// Tools que solo el admin puede usar — actuan sobre OTRA persona del equipo
// (le mandan un WhatsApp, le dejan un recordatorio, o ven pendientes de toda
// la org) en vez de sobre quien esta chateando. Un asesor comun no deberia
// poder pedirle a Sofi que le escriba o le deje notas a un companero.
//
// Se filtran en DOS lugares (defensa en profundidad, no redundancia inutil):
// aca, para que el modelo ni siquiera vea la tool si no es admin (toolsForScope,
// usado por sofi-comando.js); y de nuevo dentro de cada handler, por si algun
// dia alguien llama executeCommandTool sin pasar por ese filtro.
const ADMIN_ONLY_TOOLS = new Set([
  "registrar_resultado_radar", "enviar_whatsapp_equipo", "crear_recordatorio_equipo", "enviar_matches_pendientes_equipo",
]);

function toolsForScope(scope) {
  if (scope && scope.isAdmin) return COMMAND_TOOL_DEFINITIONS;
  return COMMAND_TOOL_DEFINITIONS.filter((t) => !ADMIN_ONLY_TOOLS.has(t.name));
}

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
  // Segunda barrera (la primera es toolsForScope, que ni le muestra la tool
  // al modelo si no es admin). Esta cubre al que llame executeCommandTool
  // directo, sin pasar por ese filtro.
  if (ADMIN_ONLY_TOOLS.has(name) && !(scope && scope.isAdmin)) {
    return "Esto solo lo puede usar un admin.";
  }
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
      // Dos escalones de confianza, y NO se baja al segundo si el primero da
      // algo (regla de negocio, 2026-07-29):
      //
      //   'asesor' — un asesor de Diamond hablo con el colega y la registro.
      //   'grupo'  — Sofi la leyo al pasar en un grupo gremial. Nadie confirmo
      //              que siga disponible ni que el precio sea ese.
      //
      // Mezclarlas hacia que el asesor no pudiera saber cual estaba verificada
      // y cual no, y eso se paga ofreciendole a un cliente algo que ya se
      // vendio. El segundo escalon solo aparece cuando no hay nada mejor.
      const criterios = {
        zona: input?.zona,
        tipo: input?.tipo,
        operacion: input?.operacion,
        precioMax: input?.precio_max,
      };
      const limite = capLimit(input?.limite);

      const verificadas = await allyProperties.search(scope.orgId, { ...criterios, origen: "asesor" }, limite);
      if (verificadas.length > 0) {
        return (
          "Propiedades de la RED DE ALIADOS, registradas por un asesor de Diamond (son de otras " +
          "inmobiliarias — recuerdale al asesor confirmar disponibilidad y condiciones con el colega " +
          "antes de ofrecerlas a su cliente):\n" +
          JSON.stringify(verificadas, null, 2)
        );
      }

      const deGrupos = await allyProperties.search(scope.orgId, { ...criterios, origen: "grupo" }, limite);
      if (deGrupos.length === 0) {
        return "No hay propiedades de aliados que coincidan con esos criterios, ni registradas por un asesor ni vistas en los grupos.";
      }
      return (
        "No hay nada registrado por un asesor en la red, pero SI hay coincidencias entre las propiedades " +
        "que Sofi vio publicadas en los grupos gremiales. AVISALE AL ASESOR QUE ESTAS NO ESTAN VERIFICADAS: " +
        "las leyo Sofi al pasar, nadie hablo con el colega y pueden estar vendidas o tener otro precio. " +
        "Sirven como pista para llamar al colega, no para ofrecerselas a un cliente todavia:\n" +
        JSON.stringify(deGrupos, null, 2)
      );
    }
    case "registrar_propiedad_colega": {
      await allyProperties.create(scope.orgId, {
        ...input,
        registrado_por: scope.viewerUid,
      });
      return `Propiedad de ${input.contacto_nombre} registrada en la red de aliados. Si un cliente pregunta por algo similar, te avisaremos a ti primero para que valides disponibilidad.`;
    }
    case "marcar_propiedad": {
      const prop = await properties.findByRef(scope.orgId, input?.ref || "");
      if (!prop) {
        return `No encontre la referencia ${input?.ref} en el inventario. Verifica el codigo con el asesor o buscala con buscar_inventario.`;
      }
      const matches = await advisors.searchByName(scope.orgId, input?.asesor || "");
      if (matches.length === 0) {
        return `No encontre ningun asesor que coincida con "${input?.asesor}" en el equipo — no marque nada. Pregunta de nuevo el nombre (puede estar escrito distinto o no estar registrado).`;
      }
      if (matches.length > 1) {
        const lista = matches.map((a) => a.name).join(", ");
        return `Hay ${matches.length} asesores que coinciden (${lista}) — pregunta cual es antes de marcar. No marque nada.`;
      }
      const nuevo = matches[0];
      let anterior = null;
      if (prop.captador_id && prop.captador_id !== nuevo.id) {
        try {
          anterior = await advisors.findById(scope.orgId, prop.captador_id);
        } catch { /* la mencion del anterior es informativa, no bloquea */ }
      }
      await properties.setCaptador(scope.orgId, prop.id, nuevo.id);
      const reemplazo = anterior ? ` (reemplaza a ${anterior.name})` : "";
      return `Listo: la propiedad ${prop.ref} — ${prop.titulo} quedo marcada a nombre de ${nuevo.name}${reemplazo}. Cuando un cliente muestre interes, le avisamos y el lead se le transfiere.`;
    }
    case "consultar_captador": {
      if (input?.ref) {
        const prop = await properties.findByRef(scope.orgId, input.ref);
        if (!prop) return `No encontre la referencia ${input.ref} en el inventario.`;
        if (!prop.captador_id) return `La propiedad ${prop.ref} — ${prop.titulo} no tiene captador asignado.`;
        const owner = await advisors.findById(scope.orgId, prop.captador_id);
        return owner
          ? `La propiedad ${prop.ref} — ${prop.titulo} esta marcada a nombre de ${owner.name}.`
          : `La propiedad ${prop.ref} tiene un captador asignado pero no encontre su ficha de asesor (pudo ser eliminado).`;
      }
      if (input?.asesor) {
        const matches = await advisors.searchByName(scope.orgId, input.asesor);
        if (matches.length === 0) return `No encontre ningun asesor que coincida con "${input.asesor}".`;
        if (matches.length > 1) {
          return `Hay ${matches.length} asesores que coinciden (${matches.map((a) => a.name).join(", ")}) — pregunta cual.`;
        }
        const props = await properties.listByCaptador(scope.orgId, matches[0].id);
        if (props.length === 0) return `${matches[0].name} no tiene propiedades marcadas a su nombre.`;
        return `Propiedades de ${matches[0].name}:\n` + JSON.stringify(props, null, 2);
      }
      return "Dime la referencia de la propiedad o el nombre del asesor que quieres consultar.";
    }
    case "crear_recordatorio": {
      let leadId = null;
      if (input?.cliente) {
        const candidatos = await command.buscarLeads(scope, input.cliente);
        if (candidatos.length === 1) leadId = candidatos[0].id;
      }
      const creado = await command.crearRecordatorio(scope, {
        descripcion: input.descripcion,
        fechaHoraIso: input?.fecha_hora_iso || null,
        leadId,
      });
      const visibilidad = creado.fecha_hora
        ? "Va a aparecer en el Calendario del equipo, visible para todos."
        : "Solo tu lo vas a ver.";
      return `Recordatorio guardado${leadId ? " y vinculado al cliente" : ""}: "${creado.descripcion}". ${visibilidad}`;
    }
    case "trazabilidad_radar": {
      const data = await radarTrazabilidad.trazabilidad(scope, {
        dias: input?.dias || 7,
        soloConAviso: Boolean(input?.solo_con_aviso),
      });
      return JSON.stringify(data);
    }
    case "consultar_recordatorios": {
      const pendientes = await command.recordatoriosPendientes(scope);
      if (pendientes.length === 0) return "No tienes recordatorios pendientes.";
      return JSON.stringify(
        pendientes.map((r) => ({ id: r.id, descripcion: r.descripcion, fecha_hora: r.fecha_hora, lead_id: r.lead_id })),
        null,
        2
      );
    }
    case "completar_recordatorio": {
      const actualizado = await command.completarRecordatorio(scope, input?.referencia);
      if (!actualizado) return `No encontre ningun recordatorio pendiente que coincida con "${input?.referencia}".`;
      return `Listo, marque como resuelto: "${actualizado.descripcion}".`;
    }
    case "registrar_resultado_radar":
      return registrarResultadoRadarComando(input, ctx);
    case "enviar_whatsapp_equipo":
      return enviarWhatsappEquipo(input, ctx);
    case "crear_recordatorio_equipo":
      return crearRecordatorioEquipo(input, ctx);
    case "enviar_matches_pendientes_equipo":
      return enviarMatchesPendientesEquipo(input, ctx);
    default:
      return `Herramienta desconocida: ${name}`;
  }
}

// Version ADMIN de registrar_resultado_radar (src/agent/tools.js): aca no hay
// un asesor escribiendole a Sofi desde su propio telefono, es el admin
// contando el resultado desde el Centro de Comando. Por eso pendientesDeAviso
// se consulta SIN advisorId (org entera, no lo del admin) y el evento se
// registra con advisorId=null: quien REGISTRA no es quien recibio el aviso,
// y eso es exactamente lo que signal_events.registrar espera para este caso
// (ver el comentario ahi — "un admin puede cerrar el ciclo de una oportunidad ajena").
async function registrarResultadoRadarComando(input, ctx) {
  const { scope } = ctx;

  let pendientes;
  try {
    pendientes = await groupSignals.pendientesDeAviso(scope.orgId, null);
  } catch (e) {
    console.warn("[comando] No se pudieron leer los avisos pendientes del radar:", e.message);
    return "No pude consultar los pedidos pendientes en este momento.";
  }

  if (pendientes.length > 0) {
    const ids = pendientes.map((s) => s.id);
    const ultimos = await signalEvents.ultimoPorSenal(scope.orgId, ids).catch(() => new Map());
    pendientes = pendientes.filter((s) => !ultimos.has(s.id));
  }

  if (pendientes.length === 0) {
    return "No encuentro ningun pedido del radar pendiente de resultado en toda la organizacion.";
  }

  // Con varios pendientes, el nombre del destinatario tambien sirve para
  // desambiguar ("el que le mandaron a Catherine") — a diferencia de la
  // version de Sofi-Cliente, aca puede haber pedidos de VARIOS asesores. Solo
  // vale la pena resolverlo si hace falta desambiguar: con un solo pendiente
  // se registra directo, sin gastar una consulta que nadie va a leer.
  const nombres = new Map();
  if (pendientes.length > 1) {
    const idsDestinatario = [...new Set(pendientes.map((s) => s.aviso_advisor_id).filter(Boolean))];
    const filas = await Promise.all(idsDestinatario.map((id) => advisors.findById(scope.orgId, id).catch(() => null)));
    idsDestinatario.forEach((id, i) => { if (filas[i]) nombres.set(id, filas[i].name); });
  }

  if (input?.cual && pendientes.length > 1) {
    const q = String(input.cual).toLowerCase();
    const filtrados = pendientes.filter((s) =>
      `${s.texto_original || ""} ${s.zona || ""} ${s.tipo || ""} ${nombres.get(s.aviso_advisor_id) || ""}`.toLowerCase().includes(q)
    );
    if (filtrados.length >= 1) pendientes = filtrados;
  }

  if (pendientes.length > 1) {
    const lista = pendientes.slice(0, 5)
      .map((s) => `- ${(s.texto_original || "").replace(/\s+/g, " ").slice(0, 80)} (avisado a ${nombres.get(s.aviso_advisor_id) || "sin destinatario registrado"})`)
      .join("\n");
    return `Hay ${pendientes.length} pedidos del radar sin resultado todavia:\n${lista}\n\nPreguntale al admin cual antes de registrar nada.`;
  }

  try {
    await signalEvents.registrar(scope.orgId, {
      signalId: pendientes[0].id,
      advisorId: null,
      tipo: input.tipo,
      motivo: input.motivo || null,
    });
  } catch (e) {
    console.warn("[comando] No se pudo registrar el resultado del radar:", e.message);
    return "No pude guardar el resultado. Intenta de nuevo en un rato.";
  }

  return "Listo, quedo registrado.";
}

// Le da a Sofi-Comando la capacidad que le faltaba (Juan, 2026-08-18): mandar
// un WhatsApp real a alguien del equipo, no solo sugerir que se mande. La
// unica compuerta es la que ya impone WhatsApp — ventana de 24h abierta desde
// el ultimo mensaje ENTRANTE de esa persona — y se reporta honesto si fallo,
// nunca se finge un envio que no salio.
async function enviarWhatsappEquipo(input, ctx) {
  const { scope } = ctx;
  const nombre = String(input?.asesor || "").trim();
  const texto = String(input?.mensaje || "").trim();
  if (!nombre || !texto) return "Me falta el nombre del asesor o el mensaje a enviar.";

  // Ultima compuerta antes de mandar nada: no depende de que el prompt se
  // acuerde de la regla en cada turno. Caso real 2026-08-18: Sofi le mando a
  // Catherine "https://wa.me/message/YOUR_CONTACT_LINK" — un placeholder
  // inventado — en vez de decir que no tenia el telefono.
  const motivoBloqueo = validarMensaje.motivoDeBloqueo(texto);
  if (motivoBloqueo) {
    return `No mande nada: ${motivoBloqueo}. Volve a redactarlo — si no tenes el dato real (ej. el telefono del colega), decilo en el texto en vez de inventar un link o dejar un espacio a medio llenar.`;
  }

  let candidatos;
  try {
    candidatos = await advisors.searchByName(scope.orgId, nombre);
  } catch (e) {
    return "No pude buscar al asesor en este momento.";
  }
  if (candidatos.length === 0) return `No encuentro ningun asesor activo llamado "${nombre}".`;
  if (candidatos.length > 1) {
    return `Hay ${candidatos.length} asesores que coinciden con "${nombre}": ${candidatos.map((a) => a.name).join(", ")}. Pregunta cual antes de mandar nada.`;
  }
  const asesor = candidatos[0];
  if (!asesor.phone) return `${asesor.name} no tiene telefono cargado — no se puede mandar nada.`;

  const org = await organizations.findById(scope.orgId).catch(() => null);
  if (!org) return "No pude resolver la organizacion para enviar el mensaje.";

  const r = await mensajeAsesor.enviarYRegistrar(org, asesor.phone, texto).catch((e) => ({ ok: false, error: e.message }));
  if (!r || !r.ok) {
    const motivo = r && r.error === "sin_credenciales"
      ? "faltan las credenciales de WhatsApp"
      : `lo mas probable es que ${asesor.name} no te haya escrito en las ultimas 24 horas — WhatsApp no deja mandar texto libre fuera de esa ventana`;
    return `No se pudo enviar: ${motivo}. Si es urgente, avisale al admin que lo haga por otro medio.`;
  }
  return `Listo, le mande el mensaje a ${asesor.name} (+${asesor.phone}).`;
}

// Recordatorio para OTRO asesor — la unica diferencia con crear_recordatorio
// (que siempre es para quien esta chateando) es a quien queda asignado. La
// dejamos en advisor_reminders.user_id = auth_user_id del asesor, que es lo
// que command.recordatoriosPendientes filtra: sin auth_user_id, la nota
// quedaria guardada pero esa persona nunca la veria en su Sofi.
async function crearRecordatorioEquipo(input, ctx) {
  const { scope } = ctx;
  const nombre = String(input?.asesor || "").trim();
  const descripcion = String(input?.descripcion || "").trim();
  if (!nombre || !descripcion) return "Me falta el nombre del asesor o el recordatorio.";

  let candidatos;
  try {
    candidatos = await advisors.searchByName(scope.orgId, nombre);
  } catch (e) {
    return "No pude buscar al asesor en este momento.";
  }
  if (candidatos.length === 0) return `No encuentro ningun asesor activo llamado "${nombre}".`;
  if (candidatos.length > 1) {
    return `Hay ${candidatos.length} asesores que coinciden con "${nombre}": ${candidatos.map((a) => a.name).join(", ")}. Pregunta cual antes de crear nada.`;
  }
  const asesor = candidatos[0];
  if (!asesor.auth_user_id) {
    return `${asesor.name} todavia no tiene acceso al CRM, asi que no le puedo dejar una nota que vea en su Sofi — avisale por otro medio (ej. enviar_whatsapp_equipo, si te escribio en las ultimas 24h).`;
  }

  const creado = await command.crearRecordatorio(scope, {
    descripcion,
    fechaHoraIso: input?.fecha_hora_iso || null,
    leadId: null,
    targetUserId: asesor.auth_user_id,
  });
  const visibilidad = creado.fecha_hora
    ? "Va a aparecer en el Calendario del equipo, visible para todos."
    : `Solo ${asesor.name} lo va a ver, en su Sofi.`;
  return `Listo, le deje a ${asesor.name} el recordatorio: "${creado.descripcion}". ${visibilidad}`;
}

// El resumen de matches pendientes, armado del dato real (src/groups/resumen-equipo.js)
// en vez de redactado por el modelo — ver la nota de diseño ahi. Sofi solo
// decide A QUIEN se le manda; el contenido no tiene nada que inventar.
async function enviarMatchesPendientesEquipo(input, ctx) {
  const { scope } = ctx;
  const nombre = String(input?.asesor || "").trim();
  if (!nombre) return "Me falta el nombre del asesor.";

  let candidatos;
  try {
    candidatos = await advisors.searchByName(scope.orgId, nombre);
  } catch (e) {
    return "No pude buscar al asesor en este momento.";
  }
  if (candidatos.length === 0) return `No encuentro ningun asesor activo llamado "${nombre}".`;
  if (candidatos.length > 1) {
    return `Hay ${candidatos.length} asesores que coinciden con "${nombre}": ${candidatos.map((a) => a.name).join(", ")}. Pregunta cual.`;
  }
  const asesor = candidatos[0];

  const data = await radarTrazabilidad.trazabilidad(scope, { dias: 14, soloConAviso: false, limite: 40 });
  if (!data.disponible) return "No pude consultar el radar en este momento.";

  // Pendientes de ESTE asesor: Sofi lo aprobo, el aviso salio a nombre suyo,
  // y todavia no hay resultado registrado (signal_events).
  const pendientes = data.señales.filter(
    (s) => s.sofi && s.sofi.aprobo && !s.resultado && s.aviso && s.aviso.para && s.aviso.para.nombre === asesor.name
  );

  const texto = resumenEquipo.construir(pendientes);
  if (!texto) return `${asesor.name} no tiene matches pendientes de seguimiento en este momento.`;

  if (!asesor.phone) return `${asesor.name} no tiene telefono cargado — no se puede mandar nada.`;
  const org = await organizations.findById(scope.orgId).catch(() => null);
  if (!org) return "No pude resolver la organizacion para enviar el mensaje.";

  const r = await mensajeAsesor.enviarYRegistrar(org, asesor.phone, texto).catch((e) => ({ ok: false, error: e.message }));
  if (!r || !r.ok) {
    const motivo = r && r.error === "sin_credenciales"
      ? "faltan las credenciales de WhatsApp"
      : `lo mas probable es que ${asesor.name} no te haya escrito en las ultimas 24 horas`;
    return `No se pudo enviar: ${motivo}.`;
  }
  const n = pendientes.length;
  return `Listo, le mande a ${asesor.name} el resumen de ${n} pedido${n > 1 ? "s" : ""} pendiente${n > 1 ? "s" : ""}.`;
}

module.exports = { COMMAND_TOOL_DEFINITIONS, executeCommandTool, toolsForScope };
