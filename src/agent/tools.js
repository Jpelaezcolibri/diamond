const properties = require("../data/properties");
const leads = require("../data/leads");
const advisors = require("../data/advisors");
const allyProperties = require("../data/ally-properties");
const propertyContext = require("../data/property-context");
const appointments = require("../data/appointments");
const { computeScore, isQualified } = require("./qualification");
const propertyOwnerAlerts = require("../data/property-owner-alerts");
const { buildClientLink, buildAllyClientMatchAlert, buildAppointmentAlert, buildColegaAppointmentAlert, buildCaptadorInterestAlert, formatCitaFechaHora } = require("../notifications/advisor");
const { LEGAL_TOPICS, LEGAL_DISCLAIMER } = require("./knowledge");
const crypto = require("node:crypto");
const groupSignals = require("../data/group-signals");
const signalEvents = require("../data/signal-events");
const whatsappGroups = require("../data/whatsapp-groups");
const { cruzar: cruzarGrupos } = require("../groups/match");
const { plano } = require("../groups/texto");
const mandatos = require("../data/mandatos");

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
      "Registra un dato del cliente en la base de datos. Usala cada vez que el cliente revele su nombre, presupuesto, zona de interes, tipo de propiedad, urgencia, forma de pago o su INTENCION (si quiere comprar, arrendar o vender). Registrar estos datos es clave para calificar y para que el asesor reciba el mensaje correcto.",
    input_schema: {
      type: "object",
      properties: {
        campo: {
          type: "string",
          enum: ["nombre", "presupuesto", "zona_interes", "tipo_interes", "urgencia", "forma_pago", "intencion"],
          description:
            "El dato a registrar. forma_pago: como piensa pagar (credito hipotecario, recursos propios, mixto). intencion: que quiere hacer el cliente — 'comprar', 'arrendar' o 'vender' (registrala APENAS quede claro, sobre todo 'vender' cuando el cliente sea un propietario que quiere entregar su inmueble).",
        },
        valor: { type: "string", description: "El valor tal como lo expreso el cliente. Para intencion usa exactamente: comprar, arrendar o vender." },
      },
      required: ["campo", "valor"],
    },
  },
  {
    name: "consultar_guia_legal",
    description:
      "Consulta la guia legal e hipotecaria VERIFICADA de la inmobiliaria (normativa colombiana). Usala SIEMPRE que el cliente pregunte por temas legales, de arriendo, impuestos, gastos de compraventa, credito hipotecario o subsidios — ANTES de responder. Responde UNICAMENTE con la informacion que devuelve esta herramienta: si el tema no esta cubierto, dile al cliente que ese punto lo confirma el asesor.",
    input_schema: {
      type: "object",
      properties: {
        tema: {
          type: "string",
          enum: [
            "arrendamiento",
            "compraventa_proceso",
            "gastos_impuestos",
            "credito_hipotecario",
            "subsidios",
            "derechos_garantias",
          ],
          description:
            "arrendamiento: Ley 820, canon, incrementos, terminacion. compraventa_proceso: promesa, escritura, registro, paz y salvos. gastos_impuestos: notaria, registro, retenciones. credito_hipotecario: financiacion, requisitos, leasing. subsidios: programas de vivienda vigentes. derechos_garantias: arras, vicios ocultos, compra sobre planos.",
        },
      },
      required: ["tema"],
    },
  },
  {
    name: "agendar_cita",
    description:
      "Registra la cita o preferencia de contacto del cliente con el asesor (dia y hora). Usala cuando el cliente indique cuando quiere que lo contacten, cuando quiere visitar un inmueble, o cuando agenda una asesoria (ej para vender). Si das fecha y hora concretas, el sistema valida la agenda del asesor (horario laboral y que no haya otra cita a esa hora): si el resultado dice que NO se pudo agendar, pidele al cliente otro dia u hora y vuelve a intentar — no insistas con el mismo horario ni inventes horas libres. Llamala ANTES de transferir_a_asesor cuando el cliente ya dio dia/hora, para que el asesor reciba todo junto. Si el cliente PREGUNTA cuando se puede ver (sin proponer el el mismo un dia/hora — ej '¿cuando se puede ver?', 'quiero verlo ya'), usa proximo_disponible=true en vez de preguntarle que dia le queda mejor: el sistema busca y agenda el primer espacio libre de una, y vos se lo confirmas.",
    input_schema: {
      type: "object",
      properties: {
        descripcion: {
          type: "string",
          description: "La preferencia tal como la dijo el cliente, ej 'manana a las 8 am', 'el jueves en la tarde', 'este fin de semana'. Si usas proximo_disponible, poné algo como 'quiere ver la propiedad lo antes posible'.",
        },
        fecha_hora_iso: {
          type: "string",
          description:
            "Fecha y hora en formato ISO 8601 con zona horaria de Colombia (-05:00), calculada a partir de la fecha y hora ACTUAL que se te indica en el contexto. Ej '2026-07-05T08:00:00-05:00'. Si el cliente fue vago (ej 'la otra semana') y no puedes fijar una hora exacta, omite este campo. No la mandes junto con proximo_disponible — son excluyentes.",
        },
        proximo_disponible: {
          type: "boolean",
          description:
            "true cuando el cliente pregunta por ver la propiedad (o ser contactado) SIN proponer el un dia/hora concreto — el sistema busca el primer espacio libre en la agenda del asesor y lo agenda de una, sin preguntarle al cliente que dia prefiere primero. Omite fecha_hora_iso si usas esto.",
        },
        tipo: {
          type: "string",
          enum: ["llamada", "visita", "asesoria"],
          description:
            "llamada: el asesor lo contacta por telefono/WhatsApp. visita: ir a ver un inmueble. asesoria: reunion para vender o recibir asesoria.",
        },
        ref: {
          type: "string",
          description:
            "Referencia del inmueble de la cita (ej '9702941'), cuando la conversacion es sobre una propiedad concreta. Anotala SIEMPRE que la cita sea por un inmueble puntual: es el unico dato con el que el asesor sabe a que propiedad ir, y sin ella el aviso sale sin ficha. Omitila solo si la cita es de asesoria general y no hay ningun inmueble de por medio. Nunca la inventes: usa la ref exacta que viste en la conversacion o en buscar_propiedades.",
        },
      },
      required: ["descripcion"],
    },
  },
  {
    name: "transferir_a_asesor",
    description:
      "Transfiere el cliente al asesor humano especializado. Usala cuando el cliente pida explicitamente hablar con una persona/asesor, o cuando el lead este calificado y acepte ser contactado. El sistema alertara automaticamente al asesor de la especialidad correcta con el resumen del lead. Si el cliente ya dio dia/hora, llama primero agendar_cita.",
    input_schema: {
      type: "object",
      properties: {
        motivo: { type: "string", description: "Motivo breve de la transferencia" },
        especialidad: {
          type: "string",
          enum: ["venta", "arriendo", "vehiculos", "otro"],
          description:
            "A que asesor va el cliente (define quien lo atiende): venta (tanto compra como VENTA de propiedad del cliente), arriendo, vehiculos (carros/motos), u otro para todo lo demas",
        },
        intencion: {
          type: "string",
          enum: ["comprar", "arrendar", "vender", "vehiculos", "otro"],
          description:
            "Que quiere hacer el cliente (define el mensaje que recibe el asesor): comprar o arrendar (busca inmueble), vender (quiere que la inmobiliaria venda SU propiedad), vehiculos, u otro. IMPORTANTE: si el cliente quiere vender su propiedad usa 'vender' con especialidad 'venta'.",
        },
      },
      required: ["motivo", "especialidad", "intencion"],
    },
  },
  {
    name: "registrar_propiedad_aliado",
    description:
      "Registra una propiedad de OTRA inmobiliaria que un colega/aliado te comparte u ofrece a la red (NO es inventario propio, NO es un dueno pidiendo consignar con nosotros). Usala SOLO cuando identifiques ese escenario especifico: alguien muestra el anuncio/ficha de un inmueble que ya es de su propia cartera o inmobiliaria. NUNCA uses esta tool para un cliente que busca comprar/arrendar ni para un propietario que quiere vender su propia propiedad CON nosotros (ese caso usa registrar_dato_lead + transferir_a_asesor). Extrae los datos directo del texto del mensaje, aunque venga en formato libre.",
    input_schema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Referencia del sistema de origen (ej Wasi), si la menciona" },
        titulo: { type: "string", description: "Titulo o descripcion corta de la propiedad" },
        tipo: { type: "string", description: "Apartamento, Casa, Apartaestudio, Lote, etc" },
        operacion: { type: "string", enum: ["Venta", "Arriendo"], description: "Si el mensaje no lo deja claro, omite el campo" },
        precio: { type: "string", description: "Precio tal como lo menciona, ej '$450.000.000'" },
        zona: { type: "string", description: "Zona o barrio" },
        ciudad: { type: "string", description: "Ciudad o municipio" },
        descripcion: { type: "string", description: "Resto de detalles relevantes del anuncio (area, habitaciones, etc) como texto libre" },
        inmobiliaria_origen: { type: "string", description: "Nombre de la inmobiliaria del aliado, si la menciona" },
        contacto_nombre: { type: "string", description: "Nombre de la persona que comparte la propiedad. OBLIGATORIO: si el mensaje no lo trae y no esta en el historial, NO llames esta herramienta todavia — pregunta primero el nombre del asesor o colega que la ingresa." },
      },
      required: ["contacto_nombre"],
    },
  },
  {
    name: "registrar_demanda_colega",
    description:
      "Registra un PEDIDO de un colega de otra inmobiliaria: alguien que BUSCA algo porque tiene un cliente. Es la contraparte de registrar_propiedad_aliado (que es para el colega que OFRECE una propiedad). Usala cuando un asesor de la casa te reenvia un mensaje de un grupo gremial del estilo 'tengo cliente para apto 3 alcobas en Laureles hasta 400 millones' o 'alguien maneja local en Envigado?'. NUNCA la uses para un cliente final que busca para si mismo (ese caso es registrar_dato_lead): esto es un colega buscando para SU cliente, y el negocio se comparte. Extrae los datos del texto reenviado aunque venga en formato libre.",
    input_schema: {
      type: "object",
      properties: {
        operacion: { type: "string", enum: ["Venta", "Arriendo"], description: "Si el mensaje no lo deja claro, omite el campo" },
        tipo: { type: "string", description: "Apartamento, Casa, Local, Oficina, Bodega, Lote, Finca…" },
        zona: { type: "string", description: "Barrio o sector, ej 'Laureles', 'Loma del Esmeraldal'. Si solo nombra el municipio, eso va en ciudad" },
        ciudad: { type: "string", description: "Municipio, ej 'Medellin', 'Envigado'" },
        presupuesto_min: { type: "integer", description: "Piso en pesos, sin puntos. 'desde 300 millones' -> 300000000. Omite si no lo dice" },
        presupuesto_max: { type: "integer", description: "Tope en pesos, sin puntos. 'hasta 400 millones' o '400 palos' -> 400000000. Un precio unico va aca" },
        habitaciones: { type: "integer", description: "Alcobas pedidas. Omite si no las menciona" },
        contacto_nombre: { type: "string", description: "Nombre del colega que hace el pedido. OBLIGATORIO: si el mensaje reenviado no lo trae y no esta en el historial, NO llames esta herramienta todavia — pregunta primero de quien es el pedido." },
        contacto_telefono: { type: "string", description: "Telefono del colega, si el mensaje lo trae" },
        grupo: { type: "string", description: "Nombre del grupo de donde salio el pedido, si el asesor lo menciona" },
        detalle: { type: "string", description: "Resto del pedido en pocas palabras (area, banos, garaje, urgencia)" },
      },
      required: ["contacto_nombre"],
    },
  },
  {
    name: "registrar_mandato_compra",
    description:
      "Registra un MANDATO DE COMPRA: un cliente NUESTRO que está buscando algo para comprar o arrendar y que todavía no encontramos. Usala cuando un asesor de la casa te reenvíe el requerimiento de su cliente (ej. 'mi cliente busca apto hasta 600 millones con 3 habitaciones en Laureles'). A partir de ese momento, cada propiedad que un colega publique en un grupo gremial se cruza contra este mandato y, si le sirve, se le avisa al asesor. NO la uses con un cliente final que te escribe buscando para sí mismo (eso es registrar_dato_lead), ni para el pedido de un colega de otra inmobiliaria (eso es registrar_demanda_colega): esto es el cliente de un asesor de la casa. Extrae todos los datos del texto aunque venga en formato libre, y NO inventes ninguno: si el mensaje no dice el área, omití el campo.",
    input_schema: {
      type: "object",
      properties: {
        cliente_nombre: { type: "string", description: "Nombre del cliente comprador. OBLIGATORIO: si el asesor no lo dice, pregúntaselo antes de llamar esta herramienta." },
        cliente_telefono: { type: "string", description: "Teléfono del cliente, si lo menciona" },
        operacion: { type: "string", enum: ["Venta", "Arriendo"], description: "Venta si compra, Arriendo si va a arrendar. Omite si no queda claro" },
        tipo: { type: "string", description: "Apartamento, Casa, Consultorio, Local, Oficina, Bodega, Lote, Finca…" },
        zonas: { type: "array", items: { type: "string" }, description: "TODAS las zonas o barrios que acepta. 'Poblado o Envigado' son DOS. Nunca metas la ciudad acá" },
        zonas_excluidas: { type: "array", items: { type: "string" }, description: "Zonas que descarta explícitamente" },
        ciudad: { type: "string", description: "Municipio, ej 'Medellín', 'Envigado'" },
        precio_min: { type: "integer", description: "Piso en pesos, sin puntos. Omite si no lo dice" },
        precio_max: { type: "integer", description: "Tope en pesos, sin puntos. 'hasta 600 millones' -> 600000000. Omite si no lo dice" },
        habitaciones: { type: "integer", description: "Alcobas pedidas. Omite si no las menciona" },
        flexible_habitaciones: { type: "boolean", description: "true SOLO si acepta una alcoba menos con estudio o servicio (ej. '4 habitaciones, pueden ser 3 + estudio')" },
        area_min: { type: "integer", description: "Metros cuadrados mínimos. Omite si no los dice" },
        banos: { type: "integer", description: "Baños pedidos. Omite si no los dice" },
        garajes: { type: "integer", description: "Parqueaderos pedidos. Omite si no los dice" },
        estrato: { type: "integer", description: "Estrato pedido. Omite si no lo dice" },
        exigencias: { type: "array", items: { type: "string" }, description: "Requisitos que no son un número: 'balcón', 'buena vista', 'moderna', 'gym', 'zonas húmedas', 'lavadora y secadora', 'unidad con zonas sociales', 'pago de contado'. Copiá las palabras del cliente." },
        plazo: { type: "string", description: "Si es un arriendo temporal, cuánto tiempo. Ej '3 a 6 meses'" },
        notas: { type: "string", description: "Cualquier otro detalle relevante en pocas palabras" },
        texto_original: { type: "string", description: "El texto del requerimiento TAL COMO te lo reenviaron, completo y sin resumir. Obligatorio si el asesor te pegó un texto: es lo que permite revisar después si entendiste bien." },
      },
      required: ["cliente_nombre"],
    },
  },
  {
    name: "consultar_radar_grupos",
    description:
      "Lista lo detectado en los grupos gremiales: pedidos de colegas que calzan con el inventario y propiedades que los colegas publicaron. Usala cuando un ASESOR de la casa pregunte por el radar, responda al digest diario (ej 'VER', 'mostrame', 'que hay hoy'), o pida ver los pedidos o las propiedades de colegas. NO la uses con un cliente final: esto es informacion interna del equipo.",
    input_schema: {
      type: "object",
      properties: {
        clase: { type: "string", enum: ["demanda", "oferta"], description: "'demanda' son pedidos de colegas, 'oferta' son propiedades que publicaron. Omite para ver ambas" },
        dias: { type: "integer", description: "Cuantos dias atras mirar. Por defecto 7" },
      },
    },
  },
  {
    name: "registrar_resultado_radar",
    description:
      "Registra en que quedo un pedido del radar que le avisaste al asesor (ej 'ya lo llame, no le sirvio', 'hubo visita', 'se cerro el negocio', 'no me contesto'). Usala SOLO cuando el asesor te esta contando el resultado de un aviso de radar que le mandaste, no de una transferencia normal ni de un cliente propio. Si citó (swipe-to-reply) el mensaje del aviso, no hace falta que aclare cual — ya lo sabes. Si NO citó y tiene mas de un pedido pendiente de resultado, la herramienta te los va a listar: pasaselos y preguntale cual, no adivines.",
    input_schema: {
      type: "object",
      properties: {
        tipo: {
          type: "string",
          enum: ["CONVERSACION", "VISITA", "NEGOCIACION", "CIERRE", "PERDIDO", "SIN_RESPUESTA"],
          description: "CONVERSACION=le escribio al colega, VISITA=hubo visita, NEGOCIACION=estan hablando de precio, CIERRE=se cerro el negocio, PERDIDO=se cayo, SIN_RESPUESTA=el colega no contesto.",
        },
        motivo: { type: "string", description: "Por que se perdio o cualquier detalle que de el asesor. Opcional." },
        cual: { type: "string", description: "Si hay varios pedidos pendientes y el asesor especifico cual (zona, colega, o parte del texto), pasalo para desambiguar." },
      },
      required: ["tipo"],
    },
  },
  {
    name: "aprobar_pedido_radar",
    description:
      "ACCION EXCEPCIONAL, no la respuesta normal a un 'si': publica en el grupo gremial un pedido del radar que el bot no respondio solo. La via normal (norma del gremio, Juan 2026-08-22) es que la asesora le responda al colega por privado desde su propio telefono — Sofi NO publica en el grupo por defecto y esta tool no se dispara con un 'si'/'dale' suelto respondiendo al aviso 'Un pedido del radar no salió solo'. Usala SOLO si el asesor pide EXPLICITAMENTE publicar en el grupo (ej 'publicalo en el grupo', 'mandalo directo al grupo', 'publicalo vos'), algo raro y deliberado. Si dice que NO o que no sirve, usa rechazar_pedido_radar en vez de esta — el 'no' tambien hay que registrarlo. Si citó (swipe-to-reply) el aviso exacto, no hace falta que aclare cual.",
    input_schema: {
      type: "object",
      properties: {
        cual: { type: "string", description: "Si hay varios avisos pendientes y el asesor especifico cual (zona, colega, o parte del texto), pasalo para desambiguar." },
      },
    },
  },
  {
    name: "rechazar_pedido_radar",
    description:
      "Registra que un pedido del radar NO sirve — el asesor respondio 'no' a un aviso 'Tenés un match del radar que no salió solo'. Usala SIEMPRE que diga que no o que no sirve, aunque no dé motivo: el aviso pide explicitamente una respuesta, y sin este registro un pedido descartado y uno que nunca se leyo se ven igual. Si citó (swipe-to-reply) el aviso exacto, no hace falta que aclare cual.",
    input_schema: {
      type: "object",
      properties: {
        motivo: { type: "string", description: "Por que no sirve, si el asesor lo dice. Opcional." },
        cual: { type: "string", description: "Si hay varios avisos pendientes y el asesor especifico cual (zona, colega, o parte del texto), pasalo para desambiguar." },
      },
    },
  },
];

// Si la propiedad de interes tiene captador, arma el aviso inmediato para su
// asesor (una sola vez por lead+propiedad). Best-effort: si la migracion del
// captador no corrio, el bot sigue sin aviso. Lo llama buscar_propiedades y
// tambien engine.js cuando el lead entra por un ad (property_ref_origen).
//
// BUG REAL (C2, 2026-08-24): esta funcion arma el aviso con texto de "un
// cliente se intereso en tu propiedad" (ver buildCaptadorInterestAlert). Un
// colega de otra inmobiliaria puede llegar hasta aca usando buscar_propiedades
// (promptColega SI le ofrece inventario) — mandarle ese aviso al captador
// seria un mensaje saliente FALSO: la persona interesada no es un cliente
// nuestro, es un colega buscando para el suyo. ctx.colega (ver engine.js) es
// la unica señal que esta funcion tiene para distinguirlo, porque la llaman
// dos caminos distintos (engine.js con el origen del ad, tools.js con
// buscar_propiedades) y los dos comparten el mismo ctx.
async function maybeCaptadorAlert(ctx, property) {
  if (!property || !property.captador_id || ctx.captadorAlert || ctx.colega) return;
  try {
    const esNuevo = await propertyOwnerAlerts.registerAlert(ctx.org.id, property.id, ctx.lead.id);
    if (!esNuevo) return;
    const advisor = await advisors.findById(ctx.org.id, property.captador_id);
    if (!advisor || advisor.activo === false) return;
    ctx.captadorAlert = { advisorPhone: advisor.phone, advisorAlert: buildCaptadorInterestAlert(property, ctx.lead) };
  } catch (e) {
    console.warn("[tools] No se pudo generar el aviso al captador (revisar migracion property_captador):", e.message);
  }
}

// Resuelve el asesor que atiende a ESTE lead para una especialidad, en orden:
// 1. Captador de la propiedad de interes (salvo vender/vehiculos, que siguen
//    su flujo) — el negocio es de quien capto la propiedad.
// 2. Asesor ya estampado en la cita — con la rotacion uno a uno, la cita y la
//    transferencia deben caer en el MISMO asesor.
// 3. Rotacion por especialidad (findForTransfer).
// Lo usan agendar_cita y transferir_a_asesor para no divergir entre si.
async function resolveLeadAdvisor(ctx, especialidad) {
  // COLEGA (Juan, 2026-09-04): "que todo llegue a Natalia... natalia sera la
  // encargada de todo en esa linea". Una visita que pide un colega de otra
  // inmobiliaria no entra a la rotacion de leads propios: la atiende siempre
  // la asesora principal del radar, que es la misma persona que ya recibe
  // todo lo que viene del gremio (findAsesorPrincipalRadar resuelve por
  // RADAR_REVISOR_PHONE y cae a la rotacion si no esta configurada, asi que
  // nunca se queda sin nadie). Asi la cita ademas queda estampada en SU
  // agenda, que es contra la que se valida el choque de horarios.
  if (ctx.colega) return advisors.findAsesorPrincipalRadar(ctx.org);
  const intencion = ctx.lead.intencion;
  const sigueFlujoEspecial = intencion === "vender" || intencion === "vehiculos" || especialidad === "vehiculos";
  if (!sigueFlujoEspecial && ctx.propertyInteres?.captador_id) {
    try {
      const captador = await advisors.findById(ctx.org.id, ctx.propertyInteres.captador_id);
      if (captador && captador.activo !== false) return captador;
    } catch (e) {
      console.warn("[tools] No se pudo resolver el captador (revisar migracion property_captador):", e.message);
    }
  }
  const citaAdvisorId = ctx.cita?.advisor_id || ctx.lead.cita?.advisor_id || null;
  if (citaAdvisorId) {
    try {
      const citaAdvisor = await advisors.findById(ctx.org.id, citaAdvisorId);
      if (citaAdvisor && citaAdvisor.activo !== false) return citaAdvisor;
    } catch (e) {
      console.warn("[tools] No se pudo resolver el asesor de la cita:", e.message);
    }
  }
  return advisors.findForTransfer(ctx.org, especialidad);
}

// El aviso de una cita que pidio un COLEGA (Juan, 2026-09-04): va a la
// asesora principal de la linea del gremio, con copia al escalado. Devuelve el
// mismo shape de siempre ({advisorPhone, advisorAlert}) mas `copias`, para que
// un canal que no conozca el campo siga funcionando igual.
//
// RADAR_ESCALADO_PHONE se lee en cada llamada, no al cargar el modulo: los
// telefonos de la linea se configuran en Railway y este archivo se carga una
// sola vez por proceso. Si esta vacia, el aviso principal sale igual — una
// copia que no se puede mandar nunca puede tumbar el aviso.
async function armarAvisoCitaColega(ctx, advisor, cita, ref) {
  const escalado = String(process.env.RADAR_ESCALADO_PHONE || "").replace(/\D/g, "");
  const copias =
    escalado && !advisors.mismoTelefono(escalado, advisor.phone) ? [escalado] : [];
  const advisorAlert = await buildColegaAppointmentAlert({
    org: ctx.org,
    colega: ctx.colega,
    lead: ctx.lead,
    cita,
    ref,
  });
  return { advisorPhone: advisor.phone, advisorAlert, copias };
}

// ALERTA DE CITA AUTO-AGENDADA (Juan, 2026-08-21): "me lo pones en el super
// admin tambien y lo marcas para yo hacerle seguimiento... avisanos". Una
// cita que agendo el sistema solo (nadie la reviso antes de confirmarsela al
// cliente) necesita que Juan se entere, ademas del aviso normal al asesor —
// para poder verificarla. Reusa RADAR_ALERTA_TO, el mismo numero que ya usa
// src/groups/vivo.js para avisos de monitoreo/calibracion a Juan. Best-effort:
// nunca bloquea la confirmacion al cliente ni la cita misma.
const AUTO_AGENDA_ALERTA_TO = process.env.RADAR_ALERTA_TO || "";

async function avisarCitaAutoAgendada(ctx, cita) {
  const destinos = AUTO_AGENDA_ALERTA_TO.split(",").map((t) => t.trim().replace(/\D/g, "")).filter(Boolean);
  if (destinos.length === 0) return;
  const cuando = formatCitaFechaHora(cita.fecha_hora) || cita.fecha_hora;
  const texto = [
    `🤖 Cita auto-agendada — revisala`,
    ``,
    `Cliente: ${ctx.lead.nombre || `+${ctx.lead.phone}`}`,
    `Propiedad: ${ctx.propertyInteres ? `${ctx.propertyInteres.titulo || "sin titulo"} (ref ${ctx.propertyInteres.ref})` : "sin propiedad de origen"}`,
    `Cuando: ${cuando}`,
    `Tipo: ${cita.tipo}`,
    ``,
    `El cliente pregunto cuando podia ver la propiedad y Sofi agendo sola el primer espacio libre. Confirmá con el asesor que le quede bien.`,
  ].join("\n");
  // Require tardio (mismo motivo que src/agent/tools.js#aprobarPedidoRadar):
  // este archivo -> mensaje-asesor.js -> whatsapp.js -> engine.js -> este archivo.
  const mensajeAsesor = require("../lib/mensaje-asesor");
  for (const to of destinos) {
    await mensajeAsesor.enviarYRegistrar(ctx.org, to, texto).catch((e) =>
      console.warn(`[tools] No se pudo avisar la cita auto-agendada a ${to}:`, e.message)
    );
  }
}

// AVISO INMEDIATO cuando un COLEGA (no un asesor reenviando) le hace un
// pedido directo a Sofi via registrar_demanda_colega (code review post-merge,
// 2026-08-24 — ver .superpowers/sdd/fix-post-merge-report.md, punto 2).
//
// promptColega le promete al colega que "le llega al equipo para que alguien
// lo contacte a coordinar", pero el texto que devuelve registrar_demanda_colega
// nunca se le lee a el (prompts.js lo dice explicito: esas instrucciones son
// para un asesor de la casa) y quedaba viviendo solo como una fila en
// group_signals a la espera del digest de las 7am — que ademas, hasta esta
// misma revision, jamas incluia una demanda sin match (ver group-digest.js).
// Resultado real: Sofi le aseguraba a un colega que lo iban a contactar y
// nadie se enteraba nunca.
//
// Se reusa RADAR_REVISOR_PHONE (Natalia) — el mismo destinatario que ya usa
// src/groups/vivo.js#avisarCercano para todo pedido de un grupo que el bot no
// puede cerrar solo — en vez de inventar un destinatario nuevo: ya es el
// punto de triage establecido para esto. Best-effort y nunca bloqueante:
// un fallo aca no debe impedir que se le confirme al colega que quedo
// anotado, ni afecta el registro en group_signals que ya se hizo antes.
const RADAR_REVISOR_PHONE = process.env.RADAR_REVISOR_PHONE || "";

async function avisarDemandaColegaInmediata(ctx, { contacto, contactoTelefono, matches, clasificado }) {
  if (!RADAR_REVISOR_PHONE) return;
  const revisor = await advisors.findByPhone(ctx.org.id, RADAR_REVISOR_PHONE).catch(() => null);
  if (!revisor) return;

  const que = [clasificado.tipo, clasificado.zona || clasificado.ciudad].filter(Boolean).join(" en ") || "algo sin detalle";
  const telefonoLinea = contactoTelefono ? `+${contactoTelefono}` : "sin telefono";
  const lista = matches.length > 0
    ? matches
        .map((m) => `- ${m.ref ? `ref ${m.ref}` : "sin ref"} · ${m.zona || "sin zona"} · ${m.precio || "sin precio"}`)
        .join("\n")
    : "No calza nada del inventario todavia.";

  const texto = [
    `🔔 Pedido directo de un colega — contactalo`,
    ``,
    `Colega: ${contacto} (${telefonoLinea})`,
    `Pide: ${que}`,
    clasificado.notas ? `Detalle: ${clasificado.notas}` : null,
    ``,
    lista,
    ``,
    `Escribile o llamalo vos, no Sofi: es un negocio compartido con otra inmobiliaria, no un cliente propio.`,
  ].filter(Boolean).join("\n");

  // Require tardio (mismo motivo que avisarCitaAutoAgendada, arriba).
  const mensajeAsesor = require("../lib/mensaje-asesor");
  await mensajeAsesor.enviarYRegistrar(ctx.org, revisor.phone, texto);
}

// Ejecuta una tool. ctx: { org, lead, propertyInteres, transfer } — el engine lee
// ctx.lead (actualizado) y ctx.transfer despues del loop.
async function executeTool(name, input, ctx) {
  if (name === "buscar_propiedades") {
    let results;
    if (input.ref) {
      const prop = await properties.findByRef(ctx.org, input.ref);
      results = prop ? [prop] : [];
    } else {
      results = await properties.search(ctx.org, input);
    }
    const disponibles = results.filter((p) => p.disponible);
    if (disponibles.length > 0 && !ctx.propertyInteres) ctx.propertyInteres = disponibles[0];
    if (disponibles.length > 0) await maybeCaptadorAlert(ctx, disponibles[0]);
    // Las propiedades que busca definen su tablero (compra/alquiler) aunque no haya dado ref.
    // NO aplica a un colega (C2, 2026-08-24): buscar_propiedades es justo la
    // tool que promptColega SI le ofrece (a diferencia del asesor, que nunca
    // deberia estar buscando para si mismo), asi que sin este guard cualquier
    // busqueda de un colega lo metia al tablero compra/alquiler como si fuera
    // una oportunidad de venta propia — el mismo efecto que ya se bloqueo en
    // engine.js para property_ref_origen, solo que por este otro camino.
    if (disponibles.length > 0 && !ctx.colega && (!ctx.lead.categoria || ctx.lead.categoria === "otros")) {
      const categoria = (disponibles[0].operacion || "").toLowerCase() === "arriendo" ? "alquiler" : "compra";
      Object.assign(ctx.lead, await leads.update(ctx.lead.id, { categoria }));
    }
    // Contexto de venta (DCE) solo para la propiedad principal (disponibles[0]):
    // angulo, beneficios y objeciones ya resueltas por el Diamond Cognitive
    // Engine, para que Sofi no tenga que improvisar la regla 7 (vender estilo
    // de vida) desde cero. Complementario, nunca reemplaza los datos crudos.
    if (disponibles.length > 0) {
      try {
        const contexto = await propertyContext.getSalesContext(ctx.org.id, disponibles[0].id);
        if (contexto) disponibles[0].contexto_venta = contexto;
      } catch (e) {
        console.warn("[tools] No se pudo obtener el contexto DCE:", e.message);
      }
    }
    if (results.length === 0) {
      // Fallback silencioso: buscar en la red de aliados con los mismos
      // criterios. Nunca se serializa el match al modelo (ni precio, ni ref,
      // ni zona exacta) — solo un aviso interno, para que sea estructuralmente
      // imposible que Sofi le cite un dato preciso al cliente.
      const operacion = ctx.lead.categoria === "alquiler" ? "Arriendo" : ctx.lead.categoria === "compra" ? "Venta" : undefined;
      const criterios = { zona: input.zona, tipo: input.tipo, operacion, precioMax: input.precio_max };
      let posibleMatch = [];
      try {
        // Tres escalones, de mas a menos confiable, y no se baja al siguiente
        // mientras el anterior devuelva algo:
        //
        //   1. inventario propio      — ya se busco arriba; si hubo, no llegamos aca
        //   2. aliados de un asesor   — alguien de Diamond hablo con el colega y la verifico
        //   3. vistas en un grupo     — Sofi las leyo al pasar, nadie confirmo nada
        //
        // El escalon 3 existe SOLO en este flujo: hay un cliente propio
        // esperando y la alternativa es decirle que no tenemos nada. Hacia un
        // colega no se usa nunca (ver filtrosAliados en src/groups/match.js).
        posibleMatch = await allyProperties.search(ctx.org.id, { ...criterios, origen: "asesor" });
        if (posibleMatch.length === 0) {
          posibleMatch = await allyProperties.search(ctx.org.id, { ...criterios, origen: "grupo" });
          if (posibleMatch.length > 0) {
            console.log(`[tools] Sin inventario propio ni aliados de asesor; se usa una propiedad vista en un grupo (${posibleMatch[0].id}).`);
          }
        }
      } catch (e) {
        console.warn("[tools] No se pudo buscar en propiedades de aliados:", e.message);
      }
      if (posibleMatch.length > 0) {
        ctx.allyMatch = posibleMatch[0];
        // puente_advisor_id: las propiedades que Sofi caza en un grupo no
        // tienen registrado_por (nadie las registro a mano desde el CRM), asi
        // que sin esto el match ocurria y NADIE se enteraba. Se avisa al
        // asesor puente, que es quien tiene el acceso al grupo y la relacion
        // con ese colega.
        if (ctx.allyMatch.registrado_por || ctx.allyMatch.puente_advisor_id) {
          try {
            const esNuevo = await allyProperties.registerAlert(ctx.org.id, ctx.allyMatch.id, ctx.lead.id);
            if (esNuevo) {
              const advisor = ctx.allyMatch.puente_advisor_id
                ? await advisors.findById(ctx.org.id, ctx.allyMatch.puente_advisor_id)
                : await advisors.findByAuthUserId(ctx.org.id, ctx.allyMatch.registrado_por);
              if (advisor) {
                ctx.allyAlert = { advisorPhone: advisor.phone, advisorAlert: buildAllyClientMatchAlert(ctx.allyMatch, ctx.lead) };
              }
            }
          } catch (e) {
            console.warn("[tools] No se pudo generar el aviso inmediato de match de aliado:", e.message);
          }
        }
        // Texto distinto para un colega (code review post-merge, 2026-08-24):
        // la version para cliente le ordenaba al modelo "tambien transferilo
        // con transferir_a_asesor" — pero un colega SI puede llegar hasta aca
        // (promptColega le ofrece buscar_propiedades) y esa instruccion lo
        // mandaba derecho a la tool que el gate de arriba (~linea 583) tuvo
        // que bloquear en codigo porque el texto de prompt no alcanzaba para
        // frenar al modelo.
        if (ctx.colega) {
          return "No se encontraron propiedades en el inventario PROPIO con esos criterios para ese pedido. Este es un colega de otra inmobiliaria buscando para SU cliente, no un cliente nuestro: no lo transfieras a un asesor ni le reveles que hay una posible coincidencia de aliado. Si tiene un pedido concreto, sugerile que lo registres con registrar_demanda_colega.";
        }
        return "No se encontraron propiedades en el inventario PROPIO con esos criterios. AVISO INTERNO (no reveles al cliente precio, referencia, ni ningun dato del colega): existe una posible coincidencia en la red de aliados. Puedes decirle al cliente que tienes una opcion por la zona que el pidio y que un asesor lo contactara pronto para confirmar disponibilidad. Tambien transfierelo con transferir_a_asesor.";
      }
      return "No se encontraron propiedades con esos criterios en el inventario.";
    }
    return JSON.stringify(results, null, 2);
  }

  if (name === "registrar_dato_lead") {
    // Intencion (comprar/arrendar/vender): columna nueva, persistencia best-effort
    // para no romper si la migracion aun no corrio. En memoria siempre, para que
    // el link y la alerta al asesor salgan con el encuadre correcto.
    if (input.campo === "intencion") {
      const v = input.valor.toLowerCase();
      const intencion = /vend|consign/.test(v) ? "vender" : /arriendo|arrend|alquil|rentar|renta/.test(v) ? "arrendar" : "comprar";
      ctx.lead.intencion = intencion;
      try {
        Object.assign(ctx.lead, await leads.update(ctx.lead.id, { intencion }));
      } catch (e) {
        console.warn("[tools] No se pudo persistir intencion (revisar migracion leads.intencion):", e.message);
      }
      return `Intencion registrada: ${intencion}. ${
        intencion === "vender"
          ? "El cliente es un PROPIETARIO que quiere vender: no le ofrezcas inventario para comprar; conectalo con el asesor de ventas (intencion vender)."
          : "Sigue asesorando segun lo que busca."
      }`;
    }

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

  if (name === "agendar_cita") {
    if (input.proximo_disponible && input.fecha_hora_iso) {
      return "No mandes fecha_hora_iso junto con proximo_disponible — son excluyentes. Si el cliente ya dio un dia/hora, usa fecha_hora_iso solo; si no propuso nada, usa solo proximo_disponible.";
    }

    const ESP_POR_INTENCION = { vender: "venta", comprar: "venta", arrendar: "arriendo", vehiculos: "vehiculos" };
    const especialidad =
      ESP_POR_INTENCION[ctx.lead.intencion] || (ctx.propertyInteres?.operacion || "").toLowerCase() || "venta";

    const cita = {
      descripcion: input.descripcion,
      fecha_hora: input.fecha_hora_iso || null,
      tipo: input.tipo || "llamada",
      estado: "solicitada",
      creada_at: new Date().toISOString(),
    };
    // La ref del inmueble de la cita, cuando la hay (Juan, 2026-09-04). Es el
    // unico camino por el que la propiedad llega al aviso de un COLEGA: el no
    // tiene property_ref_origen ni ctx.propertyInteres (ver engine.js). Se
    // guarda solo si vino, para no cambiarle el shape a las citas de siempre.
    if (input.ref) cita.ref = String(input.ref).trim();

    // PROXIMO DISPONIBLE (Juan, 2026-08-21): "todo lo que digan que cuando se
    // puede ver inmediatamente se agenda... si el calendario esta todo
    // disponible utilizalo y ocupa un espacio". El cliente pregunto por ver
    // la propiedad SIN proponer dia/hora — en vez de preguntarle (como hacia
    // antes), el sistema busca el primer espacio libre y lo agenda de una.
    // Necesita el asesor resuelto ANTES de poder buscar en su agenda.
    if (input.proximo_disponible) {
      let advisor = null;
      try {
        advisor = await resolveLeadAdvisor(ctx, especialidad);
      } catch (e) {
        console.warn("[tools] No se pudo resolver el asesor para buscar el proximo disponible:", e.message);
      }
      if (!advisor) {
        return "No pude resolver el asesor para buscar un espacio libre. Preguntale al cliente que dia y hora le queda mejor y agenda con fecha_hora_iso en vez de proximo_disponible.";
      }
      let slot = null;
      try {
        slot = await appointments.proximoDisponible(ctx.org.id, advisor);
      } catch (e) {
        console.warn("[tools] No se pudo buscar el proximo disponible:", e.message);
      }
      if (!slot) {
        return "No encontre ningun espacio libre en las proximas semanas — la agenda del asesor esta muy llena. Preguntale al cliente que dia y hora le queda mejor y agenda con fecha_hora_iso en vez de proximo_disponible.";
      }
      cita.fecha_hora = slot;
      cita.origen = "auto";
    }

    // Con dia/hora concretos (dado por el cliente, o recien encontrado
    // arriba): resolver el asesor de la especialidad (misma logica que
    // transferir_a_asesor) y validar SU agenda antes de confirmar. Sin
    // fecha_hora (cliente vago, sin proximo_disponible) no hay nada que
    // validar: se guarda como texto, como siempre.
    if (cita.fecha_hora) {
      let advisor = null;
      try {
        advisor = await resolveLeadAdvisor(ctx, especialidad);
      } catch (e) {
        console.warn("[tools] No se pudo resolver el asesor para validar la agenda:", e.message);
      }
      if (advisor) {
        let dispo = { disponible: true };
        try {
          dispo = await appointments.checkAvailability(ctx.org.id, advisor, cita.fecha_hora, { excludeLeadId: ctx.lead.id });
        } catch (e) {
          console.warn("[tools] No se pudo validar la disponibilidad de la agenda:", e.message);
        }
        if (!dispo.disponible) {
          // proximoDisponible encontro un choque de ultimo momento (otra cita
          // se agendo justo entre la busqueda y esta validacion): el error es
          // nuestro, no del cliente — no tiene sentido pedirle otro horario.
          if (cita.origen === "auto") {
            return "El espacio que encontre se ocupo justo antes de confirmar. Volve a intentar con proximo_disponible.";
          }
          const motivo =
            dispo.motivo === "fuera_de_horario"
              ? "ese horario esta fuera del horario de atencion del asesor"
              : "el asesor ya tiene otra cita a esa hora";
          // NO se persiste la cita: se le pide al cliente otro horario.
          return `No se pudo agendar: ${motivo}. Ofrecele al cliente proponer OTRO dia u hora; no inventes horarios libres, preguntale que otro momento le sirve y vuelve a intentar agendar.`;
        }
        // Estampa el asesor dueno de la agenda (para el calendario grupal y el
        // anti-choque) y prepara el aviso inmediato de la cita.
        if (advisor.auth_user_id) cita.advisor_id = advisor.auth_user_id;
        ctx.appointmentAlert = ctx.colega
          ? await armarAvisoCitaColega(ctx, advisor, cita, cita.ref)
          : { advisorPhone: advisor.phone, advisorAlert: buildAppointmentAlert(advisor, ctx.lead, cita) };
      }
    } else if (ctx.colega) {
      // Un colega que no fijo dia/hora ("la otra semana lo llevo") tampoco
      // puede quedar sin aviso: a diferencia de un cliente, a el NUNCA se lo
      // transfiere (transferir_a_asesor esta bloqueado para colegas), asi que
      // no hay un segundo momento en el que esta cita le llegue a alguien —
      // se perderia entera. Sin fecha_hora no hay agenda que validar: solo se
      // resuelve a quien avisarle. (Juan, 2026-09-04)
      let advisor = null;
      try {
        advisor = await resolveLeadAdvisor(ctx, especialidad);
      } catch (e) {
        console.warn("[tools] No se pudo resolver a quien avisarle la cita del colega:", e.message);
      }
      if (advisor) ctx.appointmentAlert = await armarAvisoCitaColega(ctx, advisor, cita, cita.ref);
    }

    // En memoria: la cita viaja al asesor en la alerta aunque la persistencia falle.
    ctx.cita = cita;
    ctx.lead.cita = cita;
    // Persistencia best-effort: si la columna `cita` aun no existe (migracion
    // pendiente) no rompas la conversacion — el seam para el calendario queda
    // igual, solo se activa cuando la migracion corra.
    try {
      Object.assign(ctx.lead, await leads.update(ctx.lead.id, { cita }));
    } catch (e) {
      console.warn("[tools] No se pudo persistir la cita (revisar migracion leads.cita):", e.message);
    }

    // "me lo pones en el super admin tambien y lo marcas para yo hacerle
    // seguimiento... avisanos" — cita.origen="auto" ya la marca (el
    // Calendario del equipo puede distinguirla) y esto le avisa a Juan.
    if (cita.origen === "auto") {
      avisarCitaAutoAgendada(ctx, cita).catch((e) =>
        console.warn("[tools] No se pudo avisar la cita auto-agendada:", e.message)
      );
    }

    const notificado = ctx.appointmentAlert
      ? " El asesor ya fue notificado de la cita."
      : " Cuando transfieras al asesor la vera en la alerta.";
    return `Cita registrada: ${cita.descripcion}${cita.fecha_hora ? ` (${cita.fecha_hora})` : ""} — tipo ${cita.tipo}.${notificado} Confirma al cliente con calidez, repitiendo EXACTAMENTE el dia y la hora agendados, y deja claro el siguiente paso.`;
  }

  if (name === "consultar_guia_legal") {
    const topic = LEGAL_TOPICS[input.tema];
    if (!topic) {
      return "Tema no cubierto por la guia. Dile al cliente que ese punto especifico se lo confirma el asesor con el abogado de la inmobiliaria, y ofrece transferirlo.";
    }
    return `${topic.contenido}\n\n${LEGAL_DISCLAIMER}`;
  }

  if (name === "transferir_a_asesor") {
    // GATE DE COLEGA (code review post-merge, 2026-08-24 — mismo criterio que
    // maybeCaptadorAlert en tools.js:244). Un colega de otra inmobiliaria
    // puede llegar hasta aca porque promptColega SI le ofrece buscar_propiedades
    // (ver el texto de la linea ~410, tambien corregido en esta revision, que
    // se lo sugeria en texto). Si el modelo la llamara igual, engine.js
    // marcaria el lead como 'transferido' y armaria buildAdvisorAlert — el
    // mismo aviso FALSO de "un cliente se intereso en tu propiedad" que este
    // gate ya existia para eliminar en maybeCaptadorAlert, entrando por otra
    // puerta. El colega no es un lead: su pedido va por registrar_demanda_colega.
    if (ctx.colega) {
      return "No transfieras a un colega de otra inmobiliaria: no es un cliente nuestro, es un par que busca para SU cliente. Si tiene un pedido concreto (agendar, mas info, coordinar), usa registrar_demanda_colega en su lugar.";
    }
    // La intencion (registrada antes con registrar_dato_lead, mas deliberada y
    // confiable) MANDA sobre la especialidad que adivine el modelo aqui: evita
    // enrutamientos absurdos, ej. mandar un vendedor al asesor de vehiculos.
    const intencion = ctx.lead.intencion || input.intencion || (input.especialidad === "vehiculos" ? "vehiculos" : null);
    if (intencion) ctx.lead.intencion = intencion;
    const ESP_POR_INTENCION = { vender: "venta", comprar: "venta", arrendar: "arriendo", vehiculos: "vehiculos" };
    const especialidad =
      ESP_POR_INTENCION[intencion] ||
      input.especialidad ||
      (ctx.propertyInteres?.operacion || "").toLowerCase() ||
      "venta";
    const advisor = await resolveLeadAdvisor(ctx, especialidad);
    if (!advisor) {
      return "No hay asesor configurado para esta organizacion. Pide disculpas y dile al cliente que pronto lo contactaran.";
    }
    ctx.transfer = { motivo: input.motivo || "Cliente solicito asesor", advisor, especialidad };
    const catMap = { venta: "compra", arriendo: "alquiler" };
    // Un vendedor no es del tablero "compra": su categoria es "otros" (captacion).
    const categoria = intencion === "vender" ? "otros" : catMap[especialidad] || "otros";
    const patch = {};
    if (categoria !== ctx.lead.categoria) patch.categoria = categoria;
    // Si el asesor tiene login en el CRM, el lead queda bajo su owner al instante.
    if (advisor.auth_user_id && !ctx.lead.owner_id) {
      patch.owner_id = advisor.auth_user_id;
      patch.owner_assigned_at = new Date().toISOString();
    }
    if (Object.keys(patch).length > 0) {
      Object.assign(ctx.lead, await leads.update(ctx.lead.id, patch));
    }
    // Persistencia best-effort de la intencion (columna nueva, migracion pendiente).
    if (intencion) {
      try {
        Object.assign(ctx.lead, await leads.update(ctx.lead.id, { intencion }));
      } catch (e) {
        console.warn("[tools] No se pudo persistir intencion (revisar migracion leads.intencion):", e.message);
      }
    }
    const link = buildClientLink(advisor, ctx.lead, ctx.propertyInteres, ctx.cita);
    return `Transferencia registrada al asesor de ${especialidad}: ${advisor.name}. Ya fue alertado con el resumen del cliente. En tu respuesta despidete brevemente e incluye este link EXACTO para que el cliente hable directo con el asesor:\n${link}`;
  }

  if (name === "registrar_propiedad_aliado") {
    // Sin el nombre de quien comparte no se registra nada (decision 2026-07-24):
    // la red de aliados vale por saber a QUIEN avisarle, no por la ficha sola.
    if (!String(input?.contacto_nombre || "").trim()) {
      return "NO registre la propiedad: falta el nombre de quien la comparte. Antes que nada, pide el nombre del asesor o colega que esta ingresando la propiedad (y su inmobiliaria si aplica), y vuelve a llamar esta herramienta cuando lo tengas.";
    }
    // Quien comparte la propiedad NUNCA se califica como lead comprador: no se
    // toca ctx.lead.categoria/estado/score aqui, a diferencia de las demas tools.
    try {
      await allyProperties.create(ctx.org.id, {
        ...input,
        contacto_telefono: ctx.lead.phone,
        lead_id: ctx.lead.id,
        mensaje_original: ctx.lastUserMessage || null,
      });
    } catch (e) {
      console.warn("[tools] No se pudo persistir la propiedad de aliado (revisar migracion ally_properties):", e.message);
    }
    return "Propiedad de aliado registrada para la red. Agradece brevemente a quien la compartio, en 1-2 frases, SIN tratarlo como cliente interesado en comprar: no lo califiques con registrar_dato_lead, no le armes ficha, no lo transfieras a un asesor de ventas.";
  }

  if (name === "registrar_demanda_colega") {
    return registrarDemandaColega(input, ctx);
  }

  if (name === "registrar_mandato_compra") {
    return registrarMandatoCompra(input, ctx);
  }

  if (name === "consultar_radar_grupos") {
    return consultarRadarGrupos(input, ctx);
  }

  if (name === "registrar_resultado_radar") {
    return registrarResultadoRadar(input, ctx);
  }

  if (name === "aprobar_pedido_radar") {
    return aprobarPedidoRadar(input, ctx);
  }

  if (name === "rechazar_pedido_radar") {
    return rechazarPedidoRadar(input, ctx);
  }

  return `Herramienta desconocida: ${name}`;
}

// El pedido de un colega, reenviado por un asesor a Sofi.
//
// Es la contraparte viva de `registrar_propiedad_aliado`. Existe porque el
// reenvio es la otra via segura para leer los grupos: el asesor ve el pedido
// bueno entre mil mensajes, se lo manda a Sofi por la Cloud API oficial —
// funcion nativa de WhatsApp, cero riesgo de baneo— y Sofi hace en dos
// segundos lo que el no puede hacer a mano: cruzarlo contra todo el
// inventario y contestarle con las refs que calzan.
//
// Antes de esto, un reenvio de demanda no dejaba rastro: Sofi listaba unas
// propiedades en el chat y la informacion moria ahi. No entraba al CRM, no
// tenia estado, no se podia repartir entre asesores ni contar en el digest.
async function registrarDemandaColega(input, ctx) {
  const contacto = String(input?.contacto_nombre || "").trim();
  if (!contacto) {
    return "NO registre el pedido: falta el nombre del colega que lo hace. Preguntale de quien es el pedido y volve a llamar esta herramienta cuando lo tengas.";
  }

  // TELEFONO DE CONTACTO (code review post-merge, 2026-08-24): cuando quien
  // escribe es el propio colega (ctx.colega — chat directo con Sofi, no un
  // asesor reenviando), el numero real ya esta en ctx.lead.phone: es el mismo
  // WhatsApp desde el que esta escribiendo AHORA. Dejar que el modelo lo saque
  // del texto (input.contacto_telefono) es innecesario y arriesgado: si el
  // colega no lo repite en el mensaje, la fila queda sin telefono con el que
  // devolverle la llamada aunque lo tengamos a mano. Cuando es un asesor
  // reenviando un pedido visto en un grupo (ctx.colega ausente), el numero del
  // colega NO esta en ctx — ahi si hace falta lo que el mensaje reenviado
  // traiga o lo que el asesor tipee.
  const contactoTelefono = ctx.colega ? ctx.lead.phone : (input.contacto_telefono || "");

  // Se traduce al shape del clasificador para poder reusar el mismo motor de
  // cruce que corre sobre los exports: mismas compuertas (zona por token
  // exacto, precio como banda), mismos puntajes, mismas razones.
  const clasificado = {
    clase: "demanda",
    confianza: 1,
    operacion: String(input.operacion || "").toLowerCase(),
    tipo: input.tipo || "",
    zona: input.zona || "",
    ciudad: input.ciudad || "",
    precio_min: input.presupuesto_min || 0,
    precio_max: input.presupuesto_max || 0,
    habitaciones: input.habitaciones || 0,
    contacto: contactoTelefono || "",
    notas: input.detalle || "",
    mensaje: {
      autor: contacto,
      texto: ctx.lastUserMessage || "",
      // La demanda reenviada es de ahora: el asesor la acaba de ver.
      fechaIso: new Date().toISOString(),
    },
  };

  const { demandas } = await cruzarGrupos([clasificado], { org: ctx.org });
  const demanda = demandas[0] || { ...clasificado, matches: [] };
  const matches = demanda.matches || [];

  // Persistir es best-effort: si la tabla o la migracion no estan, el asesor
  // igual se lleva la respuesta con los matches, que es el valor inmediato.
  try {
    const grupo = await whatsappGroups.asegurarGrupoVirtual(ctx.org.id, {
      prefijo: "reenvio",
      nombre: input.grupo || "Reenvíos a Sofi",
    });
    await groupSignals.create(ctx.org.id, {
      group_id: grupo.id,
      // Dos asesores que reenvian el mismo pedido caen en el mismo id y el
      // indice unico lo deduplica: el segundo no crea una senal nueva.
      wa_message_id: "reenvio:" + crypto
        .createHash("sha256")
        .update(`${plano(contacto)}|${plano(ctx.lastUserMessage || "")}`)
        .digest("hex").slice(0, 40),
      autor_nombre: contacto,
      autor_telefono: contactoTelefono || null,
      clase: "demanda",
      confianza: 1,
      operacion: clasificado.operacion || null,
      tipo: input.tipo || null,
      zona: input.zona || null,
      ciudad: input.ciudad || null,
      precio_min: input.presupuesto_min || null,
      precio_max: input.presupuesto_max || null,
      habitaciones: input.habitaciones || null,
      contacto: contactoTelefono || null,
      texto_original: ctx.lastUserMessage || null,
      matches,
      origen: "reenvio",
      fecha_mensaje: clasificado.mensaje.fechaIso,
    });
  } catch (e) {
    console.warn("[tools] No se pudo persistir la demanda del colega:", e.message);
  }

  // AVISO INMEDIATO A UNA PERSONA cuando quien pide es el colega mismo, no un
  // asesor reenviando (ver avisarDemandaColegaInmediata arriba y el punto 2
  // de .superpowers/sdd/fix-post-merge-report.md para la justificacion
  // completa). Best-effort y disparado sin esperar (no bloquea la respuesta
  // al colega): un fallo aca no debe demorarle la confirmacion.
  if (ctx.colega) {
    avisarDemandaColegaInmediata(ctx, { contacto, contactoTelefono, matches, clasificado }).catch((e) =>
      console.warn("[tools] No se pudo avisar la demanda del colega:", e.message)
    );
  }

  if (matches.length === 0) {
    const porque = demanda.sinZona
      ? " El pedido no trae zona ni ciudad, asi que no se pudo cruzar: si el colega la menciona, pasamela y lo vuelvo a mirar."
      : "";
    return `Pedido de ${contacto} registrado. NO tenemos nada que calce.${porque} Deciselo asi al asesor, corto y sin adornos.`;
  }

  const lista = matches
    .map((m) => {
      const fuente = m.fuente === "diamond" ? "propia" : `de aliado${m.inmobiliaria ? ` (${m.inmobiliaria})` : ""}`;
      return `- ${m.ref ? `ref ${m.ref}` : "sin ref"} · ${fuente} · ${m.zona || "sin zona"} · ${m.precio || "sin precio"}${m.habitaciones ? ` · ${m.habitaciones} alcobas` : ""} · calza por: ${m.razones.join(", ")}${m.link ? `\n  ${m.link}` : ""}`;
    })
    .join("\n");

  return `Pedido de ${contacto} registrado. Calzan ${matches.length} ${matches.length === 1 ? "propiedad" : "propiedades"}:\n${lista}\n\nPasale la lista al asesor tal cual, con los links. Recordale que el le escribe al colega desde su telefono — vos no escribis en ningun grupo. Si hay propiedad propia, esa va primero: la comision completa vale mas que la compartida.`;
}

// Un cliente comprador de la casa, cargado por su asesor. A partir de acá cada
// oferta que un colega publique en un grupo se cruza contra esto
// (src/groups/avisar-mandato.js).
//
// LA CONFIRMACION NO ES CORTESIA. Un mandato mal leido filtra mal para siempre y
// no se queja: los falsos negativos son invisibles por definicion. Repetir campo
// por campo lo que se entendio es la unica forma de que el asesor lo cache, y es
// la misma leccion que dejo el pedido recortado del 2026-08-24 (migracion
// group_signals_exigencias).
async function registrarMandatoCompra(input, ctx) {
  if (!ctx.advisor) {
    return "Esta herramienta es interna del equipo: solo un asesor de la casa puede registrar un mandato de compra. No la uses con un cliente.";
  }
  if (!String(input.cliente_nombre || "").trim()) {
    return "Falta el nombre del cliente. Preguntale de quién es el mandato antes de registrarlo.";
  }
  if (!String(input.operacion || "").trim()) {
    return "Falta si el cliente compra o arrienda. Preguntale al asesor antes de registrar el mandato.";
  }

  let fila;
  try {
    fila = await mandatos.crear(ctx.org.id, {
      ...input,
      operacion: input.operacion ? String(input.operacion).toLowerCase() : null,
      advisor_id: ctx.advisor.id,
    });
  } catch (e) {
    console.error("[radar] no se pudo guardar el mandato de compra:", e.message);
    return "No pude guardar el mandato — avisale a Juan, puede ser que falte correr una migración en la base.";
  }

  const pesos = (n) => `$${Number(n).toLocaleString("es-CO")}`;
  const lineas = [`Listo, guardé el mandato de ${fila.cliente_nombre}:`];
  const que = [
    fila.operacion === "arriendo" ? "Arriendo" : fila.operacion === "venta" ? "Compra" : null,
    fila.tipo || null,
    fila.precio_max ? `hasta ${pesos(fila.precio_max)}` : null,
    fila.plazo ? `por ${fila.plazo}` : null,
  ].filter(Boolean).join(" ");
  if (que) lineas.push(`· ${que}`);

  const medidas = [
    fila.area_min ? `mínimo ${fila.area_min} m²` : null,
    fila.habitaciones ? `${fila.habitaciones} habitaciones${fila.flexible_habitaciones ? " (acepta una menos con estudio o servicio)" : ""}` : null,
    fila.banos ? `${fila.banos} baños` : null,
    fila.garajes ? `${fila.garajes} garajes` : null,
    fila.estrato ? `estrato ${fila.estrato}` : null,
  ].filter(Boolean);
  if (medidas.length) lineas.push(`· ${medidas.join(", ")}`);

  const zonas = Array.isArray(fila.zonas) ? fila.zonas : [];
  if (zonas.length) lineas.push(`· Zonas: ${zonas.join(", ")}${fila.ciudad ? ` (${fila.ciudad})` : ""}`);
  const excl = Array.isArray(fila.zonas_excluidas) ? fila.zonas_excluidas : [];
  if (excl.length) lineas.push(`· Descarta: ${excl.join(", ")}`);

  const exig = Array.isArray(fila.exigencias) ? fila.exigencias : [];
  if (exig.length) lineas.push(`· Debe tener: ${exig.join(", ")}`);

  lineas.push("", "¿Está bien así o corrijo algo? Desde ahora, cada propiedad que un colega publique en los grupos y le sirva, te la mando.");
  return lineas.join("\n");
}

// El detalle del radar, bajo demanda.
//
// Cierra el circuito del digest: la plantilla de las 7am solo puede llevar un
// resumen (los parametros de Meta no admiten saltos de linea), asi que el
// asesor responde y —con la ventana de 24h ya abierta por esa respuesta— aca
// se le manda todo en texto libre.
async function consultarRadarGrupos(input, ctx) {
  const dias = input?.dias > 0 ? input.dias : 7;
  const desde = new Date(Date.now() - dias * 86400000).toISOString();

  let señales;
  try {
    señales = await groupSignals.list(ctx.org.id, { clase: input?.clase || null, limit: 100 });
  } catch (e) {
    console.warn("[tools] No se pudo leer el radar de grupos:", e.message);
    return "No pude consultar el radar en este momento. Decile al asesor que lo mire en el CRM, en la pantalla de Grupos.";
  }

  // Por fecha del MENSAJE cuando la hay: en un export, created_at es el dia de
  // la subida y todas las señales parecerian de hoy.
  const recientes = (señales || []).filter((s) => (s.fecha_mensaje || s.created_at) >= desde);
  if (recientes.length === 0) {
    return `No hay nada nuevo en el radar de los ultimos ${dias} dias. Deciselo corto, sin adornos.`;
  }

  const demandas = recientes.filter((s) => s.clase === "demanda" && (s.matches || []).length > 0);
  const ofertas = recientes.filter((s) => s.clase === "oferta");
  const bloques = [];

  if (demandas.length > 0) {
    bloques.push(
      `PEDIDOS DE COLEGAS QUE CALZAN (${demandas.length}):\n` +
      demandas.slice(0, 10).map((s) => {
        const que = [s.tipo, s.zona].filter(Boolean).join(" en ") || "algo";
        const tope = s.precio_max ? ` hasta $${Number(s.precio_max).toLocaleString("es-CO")}` : "";
        const refs = (s.matches || []).slice(0, 3)
          .map((m) => `${m.ref || "sin ref"}${m.fuente === "aliado" ? " (aliado)" : ""}`)
          .join(", ");
        return `- ${s.autor_nombre || "Un colega"} busca ${que}${tope} → tenemos ${refs}`;
      }).join("\n")
    );
  }

  if (ofertas.length > 0) {
    bloques.push(
      `PROPIEDADES DE COLEGAS (${ofertas.length}):\n` +
      ofertas.slice(0, 10).map((s) => {
        const que = [s.tipo, s.zona].filter(Boolean).join(" en ") || "propiedad";
        const precio = s.precio_max ? ` $${Number(s.precio_max).toLocaleString("es-CO")}` : "";
        return `- ${que}${precio} — ${s.autor_nombre || "sin contacto"}`;
      }).join("\n")
    );
  }

  if (bloques.length === 0) {
    return `Hay ${recientes.length} señales de los ultimos ${dias} dias, pero ningun pedido calza con el inventario. Deciselo asi.`;
  }

  return `${bloques.join("\n\n")}\n\nPasaselo al asesor en este formato, sin agregar propiedades que no esten en la lista. Recordale que EL le escribe al colega desde su telefono: vos no escribis en ningun grupo. El detalle completo, con el borrador listo para copiar, esta en el CRM → Grupos.`;
}

// Cierra el circuito que abre alerta-asesor.js ("Contame en que quedo... con
// eso el radar aprende"): hasta ahora esa respuesta se perdia en la
// conversacion, sin quedar registrada en ningun lado.
//
// A CUAL pedido se refiere, en orden de confianza:
//   1. ctx.radarSignalId — la asesora cito (swipe-to-reply) el aviso exacto;
//      viene resuelto desde el webhook (src/channels/whatsapp.js), no hay que
//      preguntar nada.
//   2. Un solo pendiente sin resultado — si solo tiene uno, es ese.
//   3. Varios pendientes — se listan para que Sofi pregunte. Adivinar mal aca
//      registraria el resultado equivocado sobre el pedido equivocado, que es
//      peor que no registrar nada.
// Pedidos del radar que le avisaron a este asesor y que TODAVIA no tienen
// ningun resultado registrado — ni "si" (aprobado/publicado, que ya sale del
// pool porque pendientesDeAviso exige respondida_at null), ni "no"
// (descartado — signal_events es lo unico que lo sabe, ver
// rechazarPedidoRadar), ni un resultado de llamada. Compartido por las tres
// herramientas del radar que le preguntan "¿a cual pedido te referis?": sin
// esto, un pedido que la asesora YA resolvio (aprobo, rechazo o conto en que
// quedo) le seguiria apareciendo en la lista para desambiguar la proxima vez.
async function pendientesSinResultado(ctx) {
  const pendientes = await groupSignals.pendientesDeAviso(ctx.org.id, ctx.advisor.id);
  if (pendientes.length === 0) return pendientes;
  // signalEvents es el Learning Domain — Radar depende de el, nunca al
  // reves, ver src/data/signal-events.js.
  const ids = pendientes.map((s) => s.id);
  const ultimos = await signalEvents.ultimoPorSenal(ctx.org.id, ids).catch(() => new Map());
  return pendientes.filter((s) => !ultimos.has(s.id));
}

function desambiguar(pendientes, cual) {
  if (!cual || pendientes.length <= 1) return pendientes;
  const q = String(cual).toLowerCase();
  const filtrados = pendientes.filter((s) =>
    `${s.texto_original || ""} ${s.zona || ""} ${s.tipo || ""}`.toLowerCase().includes(q)
  );
  return filtrados.length >= 1 ? filtrados : pendientes;
}

function listaPendientes(pendientes) {
  return pendientes.slice(0, 5).map((s) => `- ${(s.texto_original || "").replace(/\s+/g, " ").slice(0, 90)}`).join("\n");
}

async function registrarResultadoRadar(input, ctx) {
  if (!ctx.advisor) {
    return "Esta herramienta es para cuando un asesor de la casa cuenta el resultado de un pedido del radar. No aplica con un cliente.";
  }

  let signalId = ctx.radarSignalId || null;

  if (!signalId) {
    let pendientes;
    try {
      pendientes = await pendientesSinResultado(ctx);
    } catch (e) {
      console.warn("[tools] No se pudieron leer los avisos pendientes del radar:", e.message);
      return "No pude consultar los pedidos pendientes en este momento. Decile que lo intente de nuevo en un rato.";
    }

    if (pendientes.length === 0) {
      return "No encuentro ningun pedido del radar pendiente de resultado para vos. Si es sobre otra cosa, no uses esta herramienta.";
    }

    pendientes = desambiguar(pendientes, input?.cual);

    if (pendientes.length > 1) {
      return `Tenes ${pendientes.length} pedidos del radar sin resultado todavia:\n${listaPendientes(pendientes)}\n\nPreguntale al asesor a cual se refiere (o que cite el mensaje del aviso) antes de registrar nada.`;
    }

    signalId = pendientes[0].id;
  }

  try {
    await signalEvents.registrar(ctx.org.id, {
      signalId,
      advisorId: ctx.advisor.id,
      tipo: input.tipo,
      motivo: input.motivo || null,
    });
  } catch (e) {
    console.warn("[tools] No se pudo registrar el resultado del radar:", e.message);
    return "No pude guardar el resultado. Decile al asesor que lo intente de nuevo en un rato, o que lo registre desde el CRM en Grupos.";
  }

  return "Listo, quedo registrado. Gracias por contarme — eso es justo lo que hace que el radar mejore.";
}

// Publica un pedido que el radar callo por poco (Juan, 2026-08-20): "que
// desde el mismo celular se responda en el grupo correspondiente al mensaje
// correspondiente". El aviso lo manda src/groups/vivo.js#avisarCercano; esto
// es el otro lado, cuando el asesor contesta "si". Reusa exactamente el mismo
// motor de publicacion que aprobar_pedido_radar en Sofi-Comando
// (src/groups/vivo.js#aprobarManual) — misma via auditada, mismo registro.
async function aprobarPedidoRadar(input, ctx) {
  if (!ctx.advisor) {
    return "Esta herramienta es para cuando un asesor de la casa aprueba un pedido del radar. No aplica con un cliente.";
  }

  let signalId = ctx.radarSignalId || null;

  if (!signalId) {
    let pendientes;
    try {
      pendientes = await pendientesSinResultado(ctx);
    } catch (e) {
      console.warn("[tools] No se pudieron leer los avisos pendientes del radar:", e.message);
      return "No pude consultar los pedidos pendientes en este momento.";
    }
    if (pendientes.length === 0) {
      return "No encuentro ningun pedido del radar esperando tu aprobacion en este momento.";
    }
    pendientes = desambiguar(pendientes, input?.cual);
    if (pendientes.length > 1) {
      return `Tenes ${pendientes.length} pedidos esperando aprobacion:\n${listaPendientes(pendientes)}\n\nPreguntale a cual se refiere (o que cite el aviso) antes de publicar nada.`;
    }
    signalId = pendientes[0].id;
  }

  // Require tardio a proposito: src/groups/vivo.js importa src/channels/whatsapp.js,
  // que a su vez importa src/agent/engine.js, que importa este archivo — un
  // require al tope crearia una dependencia circular.
  const vivo = require("../groups/vivo");
  const r = await vivo.aprobarManual(ctx.org, signalId);

  switch (r.resultado) {
    case "publicado":
      return `Listo, publicado en el grupo:\n\n${r.texto}`;
    case "ya_respondida":
      return "Ese pedido ya se habia publicado — no hay nada que hacer.";
    case "sin_propiedades_publicables":
      return "La candidata ya no pasa la compuerta de calidad (puede que el inventario haya cambiado) — no se publico.";
    case "grupo_no_habilitado":
    case "grupo_no_encontrado":
      return "Ese grupo ya no esta habilitado para responder.";
    case "sesion_ambigua":
      return "No hay exactamente una sesion de WhatsApp activa — no se puede saber por cual linea publicar.";
    // Frenos de volumen de la linea (Juan, 2026-09-04). El pedido no se
    // pierde: sigue esperando, se le puede escribir a mano.
    case "limite_linea_alcanzado":
      return "La linea ya llego a su tope de mensajes por hoy — no se mando. El pedido sigue ahi; escribile vos a mano.";
    case "limite_linea_no_verificable":
      return "No pude contar cuantos mensajes mando la linea hoy, y ante la duda no escribo. El pedido sigue ahi.";
    case "cuota_whatsapp_agotada":
      return "La linea agoto su cuota de mensajes de WhatsApp de este mes (no es un limite nuestro, lo pone WhatsApp) — hay que escribirle a mano.";
    case "error_envio":
      return `El envio fallo: ${r.error || "sin detalle"}.`;
    default:
      return `No se pudo publicar (${r.resultado}).`;
  }
}

// El "no" de un aviso "Tenés un match del radar que no salió solo" (Juan,
// 2026-08-20): "explica en el mensaje que debe responder si o no para que
// se reenvie, asi no vamos a tener diferencias". Antes un "no" no llamaba
// ninguna herramienta — literalmente no quedaba registrado en ningun lado, y
// un pedido que la asesora descarto se veia identico a uno que nunca leyo.
// Usa el mismo tipo DESCARTADO del Learning Domain que ya existia para "no
// haberla tomado nunca" (ver src/data/signal-events.js) — no hace falta un
// tipo nuevo, esto es exactamente ese caso.
async function rechazarPedidoRadar(input, ctx) {
  if (!ctx.advisor) {
    return "Esta herramienta es para cuando un asesor de la casa descarta un pedido del radar. No aplica con un cliente.";
  }

  let signalId = ctx.radarSignalId || null;

  if (!signalId) {
    let pendientes;
    try {
      pendientes = await pendientesSinResultado(ctx);
    } catch (e) {
      console.warn("[tools] No se pudieron leer los avisos pendientes del radar:", e.message);
      return "No pude consultar los pedidos pendientes en este momento.";
    }
    if (pendientes.length === 0) {
      return "No encuentro ningun pedido del radar esperando tu respuesta en este momento. Si es sobre otra cosa, no uses esta herramienta.";
    }
    pendientes = desambiguar(pendientes, input?.cual);
    if (pendientes.length > 1) {
      return `Tenes ${pendientes.length} pedidos esperando tu respuesta:\n${listaPendientes(pendientes)}\n\nPreguntale a cual se refiere (o que cite el aviso) antes de descartar nada.`;
    }
    signalId = pendientes[0].id;
  }

  try {
    await signalEvents.registrar(ctx.org.id, {
      signalId,
      advisorId: ctx.advisor.id,
      tipo: "DESCARTADO",
      motivo: input?.motivo || null,
    });
  } catch (e) {
    console.warn("[tools] No se pudo registrar el descarte del radar:", e.message);
    return "No pude guardar que no sirve. Decile al asesor que lo intente de nuevo en un rato.";
  }

  return "Listo, quedo registrado que no sirve. Gracias por responder — asi el radar no queda con dudas de que paso con este pedido.";
}

module.exports = {
  TOOL_DEFINITIONS, executeTool, maybeCaptadorAlert, registrarDemandaColega, consultarRadarGrupos,
  registrarResultadoRadar, aprobarPedidoRadar, rechazarPedidoRadar, registrarMandatoCompra,
};
