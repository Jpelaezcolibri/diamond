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
  const saludo = lead.nombre ? `Hola, soy ${lead.nombre}. ` : "Hola, ";
  const citaObj = cita || lead.cita;
  let texto;
  if (citaObj && (citaObj.fecha_hora || citaObj.descripcion)) {
    const tipoLabel = CITA_TIPO_LABEL[citaObj.tipo] || "la cita";
    const fechaHora = formatCitaFechaHora(citaObj.fecha_hora);
    texto = fechaHora
      ? `${saludo}quiero confirmar ${tipoLabel} para el ${fechaHora.fecha} a las ${fechaHora.hora}`
      : `${saludo}quiero confirmar ${tipoLabel}: ${citaObj.descripcion}`;
  } else if (intencion === "vender") {
    texto = `${saludo}quiero vender mi propiedad con ustedes`;
  } else if (advisor.especialidad === "vehiculos" || intencion === "vehiculos") {
    texto = `${saludo}estoy interesado en un vehiculo`;
  } else {
    const ref = propertyInteres?.link || lead.property_ref_origen;
    texto = ref
      ? `${saludo}estoy interesado en esta propiedad: ${ref}`
      : `${saludo}estoy interesado en una propiedad`;
  }
  return `https://wa.me/${advisor.phone}?text=${encodeURIComponent(texto)}`;
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

// Mensaje de alerta que recibe el asesor cuando un lead es transferido.
function buildAdvisorAlert(org, lead, motivo, propertyInteres, especialidad, cita, allyMatch) {
  const intencion = lead.intencion;
  const esVendedor = intencion === "vender";
  const encabezadoIntencion = INTENCION_LABEL[intencion];
  const citaObj = cita || lead.cita;

  const lines = [
    `Nuevo lead ${org.name}!${
      encabezadoIntencion ? ` — ${encabezadoIntencion}` : especialidad ? ` (${especialidad})` : ""
    }`,
    `Cliente: ${lead.nombre || "Sin nombre"}`,
    `Numero: +${lead.phone}`,
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

module.exports = { buildClientLink, buildAdvisorAlert };
