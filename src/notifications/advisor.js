// Etiquetas legibles de la intencion del cliente para la alerta al asesor.
const INTENCION_LABEL = {
  vender: "QUIERE VENDER su propiedad",
  comprar: "quiere comprar",
  arrendar: "quiere arrendar",
  vehiculos: "pregunta por vehiculos",
};

// Palabra para el tipo de cita en los mensajes ("la visita", "la llamada"...).
const CITA_TIPO_LABEL = {
  visita: "la visita",
  llamada: "la llamada",
  asesoria: "la asesoría",
};

// Fecha/hora legible en Colombia a partir del ISO de la cita.
// Devuelve null si el ISO no es parseable (se cae a la descripcion del cliente).
function formatCitaFechaHora(fechaHoraIso) {
  if (!fechaHoraIso) return null;
  const date = new Date(fechaHoraIso);
  if (isNaN(date.getTime())) return null;
  const fecha = new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Bogota",
  }).format(date);
  const hora = new Intl.DateTimeFormat("es-CO", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Bogota",
  }).format(date);
  return { fecha, hora };
}

// Link wa.me para que el cliente contacte al asesor con contexto prellenado.
// El texto depende de la INTENCION: un vendedor no debe llegar con un mensaje
// de "estoy interesado en esta propiedad" apuntando al inmueble por el que entro.
// Si hay CITA agendada, el mensaje confirma la cita (dia y hora), no el interes:
// el cliente ya paso esa etapa con Sofi.
function buildClientLink(advisor, lead, propertyInteres, cita) {
  const intencion = lead.intencion;
  const en = lead.idioma === "en";
  const saludo = en
    ? lead.nombre ? `Hi, I'm ${lead.nombre}. ` : "Hi, "
    : lead.nombre ? `Hola, soy ${lead.nombre}. ` : "Hola, ";
  const citaObj = cita || lead.cita;
  let texto;
  if (citaObj && (citaObj.fecha_hora || citaObj.descripcion)) {
    const tipoLabel = en
      ? { visita: "the visit", llamada: "the call", asesoria: "the consultation" }[citaObj.tipo] || "the appointment"
      : CITA_TIPO_LABEL[citaObj.tipo] || "la cita";
    const fechaHora = formatCitaFechaHora(citaObj.fecha_hora);
    texto = fechaHora
      ? en
        ? `${saludo}I want to confirm ${tipoLabel} on ${fechaHora.fecha} at ${fechaHora.hora}`
        : `${saludo}quiero confirmar ${tipoLabel} para el ${fechaHora.fecha} a las ${fechaHora.hora}`
      : en
        ? `${saludo}I want to confirm ${tipoLabel}: ${citaObj.descripcion}`
        : `${saludo}quiero confirmar ${tipoLabel}: ${citaObj.descripcion}`;
  } else if (intencion === "vender") {
    texto = en ? `${saludo}I want to sell my property with you` : `${saludo}quiero vender mi propiedad con ustedes`;
  } else if (advisor.especialidad === "vehiculos" || intencion === "vehiculos") {
    texto = en ? `${saludo}I'm interested in a vehicle` : `${saludo}estoy interesado en un vehiculo`;
  } else {
    const ref = propertyInteres?.link || lead.property_ref_origen;
    texto = ref
      ? en
        ? `${saludo}I'm interested in this property: ${ref}`
        : `${saludo}estoy interesado en esta propiedad: ${ref}`
      : en
        ? `${saludo}I'm interested in a property`
        : `${saludo}estoy interesado en una propiedad`;
  }
  return `https://wa.me/${advisor.phone}?text=${encodeURIComponent(texto)}`;
}

// Linea de idioma para las alertas al asesor (que van SIEMPRE en español):
// el asesor debe saber ANTES de llamar que este cliente se atiende en ingles.
function idiomaLine(lead) {
  return lead.idioma === "en" ? "Idioma: INGLÉS — este cliente se atiende en inglés" : null;
}

// Formatea la cita para la alerta. Muestra el texto tal como lo dijo el cliente
// (siempre fiable) y, si existe, la fecha/hora estructurada.
function formatCita(cita) {
  if (!cita || !cita.descripcion) return null;
  const tipo = cita.tipo ? ` (${cita.tipo})` : "";
  return `Cita solicitada: ${cita.descripcion}${tipo}`;
}

// Link "agregar a Google Calendar" para el asesor (sincronizacion de calendario
// sin OAuth: un tap y la cita queda en su calendario, duracion 1 hora).
function buildCalendarLink(cita, lead) {
  const fechaHora = cita && cita.fecha_hora ? new Date(cita.fecha_hora) : null;
  if (!fechaHora || isNaN(fechaHora.getTime())) return null;
  const toBasic = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const start = toBasic(fechaHora);
  const end = toBasic(new Date(fechaHora.getTime() + 60 * 60 * 1000));
  const tipo = cita.tipo ? cita.tipo.charAt(0).toUpperCase() + cita.tipo.slice(1) : "Cita";
  const title = `${tipo} — ${lead.nombre || "Cliente"} (+${lead.phone})`;
  const details = [cita.descripcion, lead.property_ref_origen && `Propiedad: ${lead.property_ref_origen}`]
    .filter(Boolean)
    .join("\n");
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", title);
  url.searchParams.set("dates", `${start}/${end}`);
  url.searchParams.set("details", details);
  url.searchParams.set("ctz", "America/Bogota");
  return url.toString();
}

// Detalle de una posible coincidencia en la red de aliados para la alerta del
// asesor — nunca se le muestra al cliente, solo aqui. El asesor DEBE confirmar
// disponibilidad antes de ofrecerla (la propiedad puede ya no estar disponible).
function formatAllyMatch(allyMatch) {
  if (!allyMatch) return null;
  const tipo = allyMatch.tipo || "Propiedad";
  const zona = allyMatch.zona ? ` en ${allyMatch.zona}` : "";
  const precio = allyMatch.precio ? `, ${allyMatch.precio}` : "";
  const ref = allyMatch.ref ? ` (ref ${allyMatch.ref})` : "";
  const contacto = allyMatch.contacto_nombre || "sin nombre";
  const inmobiliaria = allyMatch.inmobiliaria_origen || "inmobiliaria sin especificar";
  const telefono = allyMatch.contacto_telefono ? `, tel +${allyMatch.contacto_telefono}` : "";
  return `Posible match en red de aliados: ${tipo}${zona}${precio}${ref} — contacto: ${contacto} (${inmobiliaria})${telefono}. CONFIRMA disponibilidad antes de ofrecerla al cliente.`;
}

// Aviso INMEDIATO al asesor DUENO de una propiedad de colega cuando un cliente
// pregunta por algo similar — a diferencia de formatAllyMatch (nota dentro de
// la alerta de transferencia), este mensaje viaja solo, apenas se detecta el
// match, sin esperar a que el cliente califique o se transfiera.
function buildAllyClientMatchAlert(allyProperty, lead) {
  const tipo = allyProperty.tipo || "propiedad";
  const zona = allyProperty.zona ? ` en ${allyProperty.zona}` : "";
  const precio = allyProperty.precio ? `, ${allyProperty.precio}` : "";
  const ref = allyProperty.ref ? ` (ref ${allyProperty.ref})` : "";
  const contacto = allyProperty.contacto_nombre || "tu colega";
  const inmobiliaria = allyProperty.inmobiliaria_origen ? ` de ${allyProperty.inmobiliaria_origen}` : "";
  const clienteNombre = lead.nombre || "Un cliente";
  const clienteTelefono = lead.phone ? ` (+${lead.phone})` : "";
  return [
    "Match con la red de aliados!",
    `${clienteNombre}${clienteTelefono} pregunto por algo similar a la ${tipo}${zona}${precio}${ref} que te comparte ${contacto}${inmobiliaria}.`,
    "Valida disponibilidad con tu colega antes de confirmarle al cliente.",
    // Regla de Juan: si uno pone el cliente y el otro la propiedad, la
    // comision se comparte. Decirlo en el aviso evita que dos asesores lo
    // negocien despues, con el cliente ya en la mano.
    "La comision se comparte: quien tiene el cliente y quien tiene la propiedad se ponen de acuerdo.",
  ].join("\n");
}

// Aviso al asesor cuando un COLEGA pide algo en un grupo gremial y Diamond lo
// tiene. El asesor lee esto, decide, y publica EL desde su telefono: Sofi no
// escribe en ningun grupo.
//
// El texto se entrega como BORRADOR, no como bloque para pegar tal cual. Si el
// asesor pega quince veces el mismo formato milimetrico, el grupo lo huele tan
// rapido como a un bot; que pase por sus manos y su forma de escribir es parte
// de la defensa, no un tramite.
function buildGroupDemandAlert(demanda, mensaje) {
  const quien = mensaje.autor || "Un colega";
  const grupo = mensaje.grupo ? ` en ${mensaje.grupo}` : "";
  const pedido = [
    demanda.operacion,
    demanda.tipo,
    demanda.zona ? `en ${demanda.zona}` : null,
    demanda.habitaciones > 0 ? `${demanda.habitaciones} alcobas` : null,
    demanda.precio_max > 0 ? `hasta $${Number(demanda.precio_max).toLocaleString("es-CO")}` : null,
  ].filter(Boolean).join(", ");

  // Cada opcion con su link a la ficha de la landing propia. Sin el, el asesor
  // tiene que ir a buscar la referencia a mano antes de poder decir nada — y
  // estos mensajes llegan mientras esta haciendo otra cosa.
  //
  // Solo llegan aca el inventario propio y los aliados que registro un asesor
  // (ver filtrosAliados en src/groups/match.js): lo que Sofi vio al pasar en un
  // grupo NO se le ofrece a un colega.
  const refs = (demanda.matches || []).flatMap((m) => {
    const linea = [
      `· ${m.titulo || m.ref || "Propiedad"}`,
      [m.zona, m.precio, m.habitaciones > 0 ? `${m.habitaciones} alcobas` : null].filter(Boolean).join(" · "),
      m.fuente === "aliado" ? `De la red de aliados${m.inmobiliaria ? ` (${m.inmobiliaria})` : ""} — confirma disponibilidad antes de ofrecerla.` : null,
      m.link || null,
    ].filter(Boolean);
    return linea.length > 1 ? [linea[0], ...linea.slice(1).map((l) => `  ${l}`)] : linea;
  });

  return [
    `${quien} pide${grupo}:`,
    `"${(mensaje.texto || "").slice(0, 300)}"`,
    "",
    pedido ? `Busca: ${pedido}` : null,
    `Tenemos ${(demanda.matches || []).length} opcion(es):`,
    ...refs,
    "",
    mensaje.grupo ? `Respondele en el grupo "${mensaje.grupo}".` : null,
    "Escribile vos desde tu telefono — con tus palabras, no copiando esto tal cual.",
    "Si la propiedad es de otro asesor de Diamond, la comision se comparte entre ustedes.",
  ].filter((l) => l !== null).join("\n");
}

// Aviso INMEDIATO al asesor CAPTADOR de una propiedad del inventario propio
// cuando un cliente muestra interes en ella — viaja apenas se detecta, sin
// esperar calificacion ni transferencia (dedup en property_owner_alerts).
function buildCaptadorInterestAlert(property, lead) {
  const clienteNombre = lead.nombre || "Un cliente";
  const clienteTelefono = lead.phone ? ` (+${lead.phone})` : "";
  const zona = property.zona ? ` en ${property.zona}` : "";
  return [
    "Cliente interesado en tu propiedad!",
    `${clienteNombre}${clienteTelefono} esta preguntando por la ref ${property.ref} — ${property.titulo}${zona}.`,
    idiomaLine(lead),
    "Sofi lo esta atendiendo; si califica, te lo transfiere directo.",
  ].filter(Boolean).join("\n");
}

// Aviso INMEDIATO al asesor cuando se le agenda una visita/cita con dia y hora
// validados contra su agenda — viaja apenas se confirma la cita, sin esperar
// la transferencia (ver ctx.appointmentAlert en tools.js).
function buildAppointmentAlert(advisor, lead, cita) {
  const tipoLabel = { visita: "una visita", llamada: "una llamada", asesoria: "una asesoría" }[cita.tipo] || "una cita";
  const clienteNombre = lead.nombre || "un cliente";
  const clienteTelefono = lead.phone ? ` (+${lead.phone})` : "";
  const fechaHora = formatCitaFechaHora(cita.fecha_hora);
  const cuando = fechaHora ? `el ${fechaHora.fecha} a las ${fechaHora.hora}` : cita.descripcion || "próximamente";
  const inmueble = lead.property_ref_origen ? `\nPropiedad de interés: ${lead.property_ref_origen}` : "";
  const idioma = idiomaLine(lead) ? `\n${idiomaLine(lead)}` : "";
  const calLink = buildCalendarLink(cita, lead);
  const cal = calLink ? `\nAgendar en tu calendario: ${calLink}` : "";
  return `Nueva cita agendada!\nTienes ${tipoLabel} con ${clienteNombre}${clienteTelefono} ${cuando}.${inmueble}${idioma}${cal}`;
}

// Mensaje de alerta que recibe el asesor cuando un lead es transferido.
function buildAdvisorAlert(org, lead, motivo, propertyInteres, especialidad, cita, allyMatch) {
  const intencion = lead.intencion;
  const esVendedor = intencion === "vender";
  const encabezadoIntencion = INTENCION_LABEL[intencion];
  const citaObj = cita || lead.cita;
  // La alerta se construye en el instante de la transferencia: "ahora" ES la
  // fecha/hora de la transferencia (hora Colombia).
  const transferidoEn = formatCitaFechaHora(new Date().toISOString());

  const lines = [
    `Nuevo lead ${org.name}!${
      encabezadoIntencion ? ` — ${encabezadoIntencion}` : especialidad ? ` (${especialidad})` : ""
    }`,
    transferidoEn && `Transferido: ${transferidoEn.fecha}, ${transferidoEn.hora}`,
    `Cliente: ${lead.nombre || "Sin nombre"}`,
    `Numero: +${lead.phone}`,
    idiomaLine(lead),
    lead.presupuesto && `Presupuesto: ${lead.presupuesto}`,
    lead.zona_interes && `Zona: ${lead.zona_interes}`,
    lead.tipo_interes && `Tipo: ${lead.tipo_interes}`,
    lead.urgencia && `Urgencia: ${lead.urgencia}`,
    lead.forma_pago && `Forma de pago: ${lead.forma_pago}`,
    `Score: ${lead.score}/100`,
    formatCita(citaObj),
    citaObj && buildCalendarLink(citaObj, lead) && `Agendar en tu calendario: ${buildCalendarLink(citaObj, lead)}`,
    // Para un vendedor, el inmueble de origen es por donde entro (contexto), no lo
    // que quiere: nunca lo presentes como "propiedad de interes".
    esVendedor
      ? lead.property_ref_origen && `Entro por la publicacion: ${lead.property_ref_origen}`
      : propertyInteres
        ? `Propiedad de interes: ${propertyInteres.ref} — ${propertyInteres.link}`
        : lead.property_ref_origen
          ? `Propiedad de origen: ${lead.property_ref_origen}`
          : "Consulta general",
    formatAllyMatch(allyMatch),
    `Motivo: ${motivo}`,
    "Contactar a la brevedad.",
  ].filter(Boolean);
  return lines.join("\n");
}

module.exports = { buildClientLink, buildAdvisorAlert, buildAllyClientMatchAlert, buildGroupDemandAlert, buildAppointmentAlert, buildCaptadorInterestAlert, formatCitaFechaHora };
