// Entregar un aviso a una asesora, y si su WhatsApp no lo puede recibir,
// entregarlo a otra del equipo.
//
// POR QUE EXISTE (Juan, 2026-09-02): "si la ventana de una esta cerrada
// enviar a la ventana de la otra, esto con el fin de que nunca se pierda
// ninguna posibilidad de hacer negocios".
//
// EL CASO REAL. WhatsApp solo entrega texto libre dentro de las 24 horas
// siguientes a que la persona escriba. Catherine no le escribia a Sofi desde
// el 25 de agosto: su ventana llevaba SIETE DIAS cerrada y todo lo que se le
// mandaba —45 mensajes el 1 de septiembre— se aceptaba en la API y no llegaba
// a su telefono. Una oportunidad que cae en esa ventana no se demora: se
// pierde, y nadie se entera.
//
// COMO FUNCIONA. Se intenta con la asesora que corresponde. Si falla Y el
// motivo es la ventana cerrada, se intenta con las demas activas de la
// especialidad, avisando en el encabezado de quien era el pedido — para que
// quien lo reciba sepa que esta cubriendo a una companera y no crea que le
// reasignaron el cliente.
//
// SOLO por ventana cerrada. Un numero invalido o un error de credenciales no
// se arregla cambiando de destinatario: reintentarlo con otra persona seria
// gastar dos envios para el mismo fallo. Y el tope de frecuencia
// (`pair rate limit`) tampoco, porque es del par negocio-persona: la
// siguiente pasada de la bandeja lo reintenta sola.

const advisors = require("../data/advisors");
const mensajeAsesor = require("./mensaje-asesor");

function soloDigitos(t) {
  return String(t || "").replace(/\D/g, "");
}

/**
 * @param org        organizacion resuelta
 * @param principal  la asesora a la que le toca el aviso ({ id, name, phone })
 * @param texto      el mensaje
 * @returns { ok, wamid, advisor, suplente, error }
 *          `advisor` es quien LO RECIBIO — no siempre es `principal`.
 *          `suplente` es true cuando lo recibio otra persona.
 */
async function entregarConRespaldo(org, principal, texto) {
  const telPrincipal = soloDigitos(principal && principal.phone);
  if (!telPrincipal) return { ok: false, advisor: null, suplente: false, error: "asesora sin telefono" };

  const primero = await mensajeAsesor
    .enviarYRegistrar(org, telPrincipal, texto)
    .catch((e) => ({ ok: false, error: e.message }));
  if (primero && primero.ok) {
    return { ok: true, wamid: primero.wamid || null, advisor: principal, suplente: false, error: null };
  }

  const error = (primero && primero.error) || "sin_respuesta";
  // Solo la ventana cerrada justifica cambiar de destinatario.
  if (!mensajeAsesor.VENTANA_CERRADA.test(error)) {
    return { ok: false, advisor: null, suplente: false, error };
  }

  const equipo = await advisors
    .listElegibles(org.id, { especialidades: ["venta"] })
    .catch(() => []);
  const suplentes = equipo.filter(
    (a) => a.id !== (principal && principal.id) && soloDigitos(a.phone) && soloDigitos(a.phone) !== telPrincipal
  );

  for (const s of suplentes) {
    const aviso = [
      `⚠️ Esto era para ${principal.name || "otra asesora"}, pero su WhatsApp no lo está recibiendo`,
      `(no le escribe a Sofi hace más de 24 h, así que WhatsApp no nos deja entregarle nada).`,
      `Te lo paso a vos para que no se pierda. Si podés, decile que le escriba cualquier cosa a Sofi y el canal se le reabre.`,
      ``,
      texto,
    ].join("\n");
    const r = await mensajeAsesor
      .enviarYRegistrar(org, soloDigitos(s.phone), aviso)
      .catch((e) => ({ ok: false, error: e.message }));
    if (r && r.ok) {
      console.warn(
        `[entrega] la ventana de ${principal.name} esta cerrada: el aviso se entrego a ${s.name} para no perderlo.`
      );
      return { ok: true, wamid: r.wamid || null, advisor: s, suplente: true, error: null };
    }
  }

  return { ok: false, advisor: null, suplente: false, error: `${error} | sin suplente con ventana abierta` };
}

module.exports = { entregarConRespaldo };
