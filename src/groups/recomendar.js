// Que hace Sofi con lo que detecta en un grupo — la Fase 2.
//
// En modo 'sombra' no pasa nada: se guarda la senal y listo. En modo 'sugerir':
//
//   · Una OFERTA entra a ally_properties. A partir de ahi el circuito que YA
//     corre en produccion la usa solo: cuando un cliente de Diamond pide algo
//     que no esta en el inventario propio, src/agent/tools.js busca en la red
//     de aliados y avisa al asesor. No hay que construir nada de eso — solo
//     abastecerlo.
//
//   · Una DEMANDA con match dispara un aviso al asesor puente, con las refs
//     que calzan y el borrador listo. El asesor decide y publica EL, desde su
//     telefono. Sofi no escribe en ningun grupo, nunca.

const advisors = require("../data/advisors");
const allyProperties = require("../data/ally-properties");
const groupSignals = require("../data/group-signals");
// Se importa el MODULO y no la funcion suelta: destructurar congela la
// referencia y deja los tests sin forma de mockear el envio — que es
// justamente lo que hay que poder verificar aca.
const canalWhatsapp = require("../channels/whatsapp");
const { buildGroupDemandAlert } = require("../notifications/advisor");

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

// Devuelve 'enviada' | 'fallo' | 'no_aplica'. Los tres casos se distinguen a
// proposito: antes todo terminaba en un `false` mudo, y un rechazo de Meta era
// indistinguible de "esta demanda no ameritaba aviso". Con eso no habia forma
// de contestar si al asesor le habia llegado algo.
async function avisarDemanda(org, demanda) {
  const m = demanda.mensaje;
  if (!m.advisorId) {
    console.warn("[grupos] Demanda con match pero la sesión no tiene asesor asignado: nadie recibe el aviso.");
    return "no_aplica";
  }
  if (!demanda.matches || demanda.matches.length === 0) return "no_aplica";

  const advisor = await advisors.findById(org.id, m.advisorId);
  if (!advisor?.phone) {
    console.warn(`[grupos] El asesor ${m.advisorId} no tiene teléfono cargado: no se le puede avisar.`);
    return "no_aplica";
  }

  const texto = buildGroupDemandAlert(demanda, m);
  // Sale por el numero OFICIAL de Sofi (Cloud API de Meta), no por la linea
  // vinculada: ese es el camino legitimo y su riesgo es cero.
  const r = await canalWhatsapp.sendWhatsApp(org, advisor.phone, texto);

  if (!r?.ok) {
    // Fuera de la ventana de 24 h, Meta rechaza el texto libre y exige
    // plantilla. Ese rechazo pasaba en silencio.
    console.error(`[grupos] El aviso a ${advisor.name} NO salió: ${r?.error || "sin detalle"}`);
    return "fallo";
  }

  console.log(`[grupos] Aviso enviado a ${advisor.name}: demanda de ${m.autor || "un colega"} con ${demanda.matches.length} match(es).`);
  await groupSignals.marcarEnviada(org.id, m.groupId, m.waMessageId);
  return "enviada";
}

// senales: demandas y ofertas ya cruzadas. Solo actua sobre las de grupos en
// modo 'sugerir'. Devuelve el conteo de lo que hizo.
async function recomendar(org, { demandas = [], ofertas = [] }) {
  let aliadas = 0;
  let alertas = 0;
  let alertasFallidas = 0;

  for (const o of ofertas) {
    if (o.mensaje?.modo !== "sugerir") continue;
    // Una oferta sin datos utilizables es una fila muerta: Sofi nunca podria
    // recomendarsela a un cliente. Se detecta igual (queda en group_signals),
    // pero no ensucia la red de aliados.
    if (!o.utilizable) continue;
    try {
      await guardarOferta(org, o);
      aliadas++;
    } catch (e) {
      console.error("[grupos] No se pudo guardar la propiedad de aliado:", e.message);
    }
  }

  for (const d of demandas) {
    if (d.mensaje?.modo !== "sugerir") continue;
    try {
      const r = await avisarDemanda(org, d);
      if (r === "enviada") alertas++;
      else if (r === "fallo") alertasFallidas++;
    } catch (e) {
      alertasFallidas++;
      console.error("[grupos] No se pudo avisar la demanda:", e.message);
    }
  }

  return { aliadas, alertas, alertasFallidas };
}

module.exports = { recomendar, operacionCanonica, precioTexto, guardarOferta };
