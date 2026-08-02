// Una propiedad que un colega publico en un grupo, normalizada y archivada.
//
// Traduce lo que extrajo el clasificador al shape que exige `ally_properties`
// y la guarda. A partir de ahi el circuito que YA corre en produccion la usa
// solo: cuando un cliente pide algo que no esta en el inventario propio,
// src/agent/tools.js busca en la red de aliados y avisa al asesor. Nunca hubo
// que construir eso — solo abastecerlo, y eso es todo lo que hace este modulo.
//
// Antes vivia aca tambien el aviso inmediato al asesor por cada demanda con
// match. Lo reemplazo el digest diario (src/scheduler/group-digest.js): un
// aviso por pedido funcionaba con la escucha en vivo, donde llegaban de a uno;
// con un export de 30 dias serian decenas de mensajes de golpe sobre cosas de
// hace tres semanas.

const allyProperties = require("../data/ally-properties");

// ally_properties.operacion tiene un check que exige 'Venta' | 'Arriendo'
// capitalizado; el clasificador devuelve minusculas. Sin normalizar, cada
// insercion revienta contra la restriccion.
function operacionCanonica(v) {
  const t = String(v || "").trim().toLowerCase();
  if (t === "venta" || t === "compra") return "Venta";
  if (t === "arriendo" || t === "alquiler") return "Arriendo";
  return null; // permuta u otra: se deja nulo, la columna lo admite
}

// precio en ally_properties es TEXTO (asi lo guarda el flujo historico).
function precioTexto(n) {
  return n > 0 ? `$${Number(n).toLocaleString("es-CO")}` : null;
}

// `vistoEn` existe por el import de exports: ahi los mensajes son de hace dias
// o semanas y sellarlos con `now()` los volveria frescos por otros 7 dias. Una
// oferta de hace tres semanas recomendada como disponible es exactamente el
// dano de reputacion que la caducidad existe para evitar. En vivo el mensaje
// acaba de llegar, asi que `now()` sigue siendo lo correcto por defecto.
async function guardarOferta(org, oferta, { vistoEn = null } = {}) {
  const m = oferta.mensaje;
  const precio = oferta.precio_max || oferta.precio_min || 0;

  return allyProperties.create(org.id, {
    titulo: oferta.notas || null,
    tipo: oferta.tipo || null,
    operacion: operacionCanonica(oferta.operacion),
    precio: precioTexto(precio),
    zona: oferta.zona || null,
    ciudad: oferta.ciudad || null,
    descripcion: oferta.notas || null,
    inmobiliaria_origen: null,
    contacto_nombre: m.autor || null,
    contacto_telefono: oferta.contacto || m.autorTelefono || null,
    mensaje_original: m.texto || null,
    origen: "grupo",
    group_id: m.groupId || null,
    puente_advisor_id: m.advisorId || null,
    visto_en_grupo_at: vistoEn || new Date().toISOString(),
  });
}

module.exports = { guardarOferta, operacionCanonica, precioTexto };
