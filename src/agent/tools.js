const properties = require("../data/properties");
const leads = require("../data/leads");
const advisors = require("../data/advisors");
const allyProperties = require("../data/ally-properties");
const propertyContext = require("../data/property-context");
const appointments = require("../data/appointments");
const { computeScore, isQualified } = require("./qualification");
const { buildClientLink, buildAllyClientMatchAlert, buildAppointmentAlert } = require("../notifications/advisor");
const { LEGAL_TOPICS, LEGAL_DISCLAIMER } = require("./knowledge");

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
      "Registra la cita o preferencia de contacto del cliente con el asesor (dia y hora). Usala cuando el cliente indique cuando quiere que lo contacten, cuando quiere visitar un inmueble, o cuando agenda una asesoria (ej para vender). Si das fecha y hora concretas, el sistema valida la agenda del asesor (horario laboral y que no haya otra cita a esa hora): si el resultado dice que NO se pudo agendar, pidele al cliente otro dia u hora y vuelve a intentar — no insistas con el mismo horario ni inventes horas libres. Llamala ANTES de transferir_a_asesor cuando el cliente ya dio dia/hora, para que el asesor reciba todo junto.",
    input_schema: {
      type: "object",
      properties: {
        descripcion: {
          type: "string",
          description: "La preferencia tal como la dijo el cliente, ej 'manana a las 8 am', 'el jueves en la tarde', 'este fin de semana'",
        },
        fecha_hora_iso: {
          type: "string",
          description:
            "Fecha y hora en formato ISO 8601 con zona horaria de Colombia (-05:00), calculada a partir de la fecha y hora ACTUAL que se te indica en el contexto. Ej '2026-07-05T08:00:00-05:00'. Si el cliente fue vago (ej 'la otra semana') y no puedes fijar una hora exacta, omite este campo.",
        },
        tipo: {
          type: "string",
          enum: ["llamada", "visita", "asesoria"],
          description:
            "llamada: el asesor lo contacta por telefono/WhatsApp. visita: ir a ver un inmueble. asesoria: reunion para vender o recibir asesoria.",
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
        contacto_nombre: { type: "string", description: "Nombre de la persona que comparte la propiedad" },
      },
      required: [],
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
      let posibleMatch = [];
      try {
        posibleMatch = await allyProperties.search(ctx.org.id, { zona: input.zona, tipo: input.tipo, operacion, precioMax: input.precio_max });
      } catch (e) {
        console.warn("[tools] No se pudo buscar en propiedades de aliados:", e.message);
      }
      if (posibleMatch.length > 0) {
        ctx.allyMatch = posibleMatch[0];
        if (ctx.allyMatch.registrado_por) {
          try {
            const esNuevo = await allyProperties.registerAlert(ctx.org.id, ctx.allyMatch.id, ctx.lead.id);
            if (esNuevo) {
              const advisor = await advisors.findByAuthUserId(ctx.org.id, ctx.allyMatch.registrado_por);
              if (advisor) {
                ctx.allyAlert = { advisorPhone: advisor.phone, advisorAlert: buildAllyClientMatchAlert(ctx.allyMatch, ctx.lead) };
              }
            }
          } catch (e) {
            console.warn("[tools] No se pudo generar el aviso inmediato de match de aliado:", e.message);
          }
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
    const cita = {
      descripcion: input.descripcion,
      fecha_hora: input.fecha_hora_iso || null,
      tipo: input.tipo || "llamada",
      estado: "solicitada",
      creada_at: new Date().toISOString(),
    };

    // Con dia/hora concretos: resolver el asesor de la especialidad (misma
    // logica que transferir_a_asesor, sin el input.especialidad que aqui no
    // existe) y validar SU agenda antes de confirmar. Sin fecha_hora (cliente
    // vago) no hay nada que validar: se guarda como texto, como siempre.
    if (cita.fecha_hora) {
      const ESP_POR_INTENCION = { vender: "venta", comprar: "venta", arrendar: "arriendo", vehiculos: "vehiculos" };
      const especialidad =
        ESP_POR_INTENCION[ctx.lead.intencion] || (ctx.propertyInteres?.operacion || "").toLowerCase() || "venta";
      let advisor = null;
      try {
        advisor = await advisors.findForTransfer(ctx.org, especialidad);
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
        ctx.appointmentAlert = { advisorPhone: advisor.phone, advisorAlert: buildAppointmentAlert(advisor, ctx.lead, cita) };
      }
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
    const notificado = ctx.appointmentAlert
      ? " El asesor ya fue notificado de la cita."
      : " Cuando transfieras al asesor la vera en la alerta.";
    return `Cita registrada: ${cita.descripcion}${cita.fecha_hora ? ` (${cita.fecha_hora})` : ""} — tipo ${cita.tipo}.${notificado} Confirma al cliente con calidez, repitiendo el dia y la hora, y deja claro el siguiente paso.`;
  }

  if (name === "consultar_guia_legal") {
    const topic = LEGAL_TOPICS[input.tema];
    if (!topic) {
      return "Tema no cubierto por la guia. Dile al cliente que ese punto especifico se lo confirma el asesor con el abogado de la inmobiliaria, y ofrece transferirlo.";
    }
    return `${topic.contenido}\n\n${LEGAL_DISCLAIMER}`;
  }

  if (name === "transferir_a_asesor") {
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
    const advisor = await advisors.findForTransfer(ctx.org, especialidad);
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

  return `Herramienta desconocida: ${name}`;
}

module.exports = { TOOL_DEFINITIONS, executeTool };
