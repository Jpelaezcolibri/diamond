// Etiquetas legibles de la intencion del cliente para la alerta al asesor.
const INTENCION_LABEL = {
  vender: "QUIERE VENDER su propiedad",
  comprar: "quiere comprar",
  arrendar: "quiere arrendar",
  vehiculos: "pregunta por vehiculos",
};

// Link wa.me para que el cliente contacte al asesor con contexto prellenado.
// El texto depende de la INTENCION: un vendedor no debe llegar con un mensaje
// de "estoy interesado en esta propiedad" apuntando al inmueble por el que entro.
function buildClientLink(advisor, lead, propertyInteres) {
  const intencion = lead.intencion;
  const saludo = lead.nombre ? `Hola, soy ${lead.nombre}. ` : "Hola, ";
  let texto;
  if (intencion === "vender") {
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

// Mensaje de alerta que recibe el asesor cuando un lead es transferido.
function buildAdvisorAlert(org, lead, motivo, propertyInteres, especialidad, cita) {
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
    // Para un vendedor, el inmueble de origen es por donde entro (contexto), no lo
    // que quiere: nunca lo presentes como "propiedad de interes".
    esVendedor
      ? lead.property_ref_origen && `Entro por la publicacion: ${lead.property_ref_origen}`
      : propertyInteres
        ? `Propiedad de interes: ${propertyInteres.ref} — ${propertyInteres.link}`
        : lead.property_ref_origen
          ? `Propiedad de origen: ${lead.property_ref_origen}`
          : "Consulta general",
    `Motivo: ${motivo}`,
    "Contactar a la brevedad.",
  ].filter(Boolean);
  return lines.join("\n");
}

module.exports = { buildClientLink, buildAdvisorAlert };
