// Link wa.me para que el cliente contacte al asesor con contexto prellenado
function buildClientLink(org, lead, propertyInteres) {
  const ref = propertyInteres?.link || lead.property_ref_origen;
  const texto = ref
    ? `Hola, estoy interesado en esta propiedad: ${ref}`
    : "Hola, estoy interesado en una propiedad";
  return `https://wa.me/${org.advisor_phone}?text=${encodeURIComponent(texto)}`;
}

// Mensaje de alerta que recibe el asesor cuando un lead es transferido
function buildAdvisorAlert(org, lead, motivo, propertyInteres) {
  const lines = [
    `Nuevo lead ${org.name}!`,
    `Cliente: ${lead.nombre || "Sin nombre"}`,
    `Numero: +${lead.phone}`,
    lead.presupuesto && `Presupuesto: ${lead.presupuesto}`,
    lead.zona_interes && `Zona: ${lead.zona_interes}`,
    lead.tipo_interes && `Tipo: ${lead.tipo_interes}`,
    lead.urgencia && `Urgencia: ${lead.urgencia}`,
    lead.forma_pago && `Forma de pago: ${lead.forma_pago}`,
    `Score: ${lead.score}/100`,
    propertyInteres ? `Propiedad de interes: ${propertyInteres.ref} — ${propertyInteres.link}` : lead.property_ref_origen ? `Propiedad de origen: ${lead.property_ref_origen}` : "Consulta general",
    `Motivo: ${motivo}`,
    "Contactar a la brevedad.",
  ].filter(Boolean);
  return lines.join("\n");
}

module.exports = { buildClientLink, buildAdvisorAlert };
