// Pausa en una conversacion (2026-10-17). Caso +573245934862: pregunto el
// 2-sep por "venta en Envigado hasta 400" y volvio el 17-oct con "Compra en
// poblado"; Sofi le aplico el presupuesto viejo como si fuera de hoy. Ni el
// historial ni los datos guardados le llegaban con fecha.
//
// Devuelve cuantos dias tienen los datos de ANTES de la pausa mas reciente de
// al menos PAUSA_MINIMA_DIAS, o 0 si la conversacion es continua.

const PAUSA_MINIMA_DIAS = 7;
const DIA_MS = 24 * 60 * 60 * 1000;

function diasDePausa(mensajes, ahora = new Date()) {
  const fechados = (mensajes || []).filter((m) => m && m.created_at);
  for (let i = fechados.length - 1; i > 0; i--) {
    const despues = new Date(fechados[i].created_at).getTime();
    const antes = new Date(fechados[i - 1].created_at).getTime();
    if (despues - antes >= PAUSA_MINIMA_DIAS * DIA_MS) return Math.floor((ahora.getTime() - antes) / DIA_MS);
  }
  return 0;
}

// Solo lo de los ultimos 7 dias llega al modelo (Juan, 2026-10-17: "todos los
// mensajes que tengan mas de 7 dias no se tome el historial"). Lo anterior
// queda resumido en los datos guardados del cliente, que con una pausa llegan
// marcados para confirmar (prompts.js#bloqueDatos).
//
// La API exige que la conversacion empiece por el usuario. Si lo vigente
// arranca con un mensaje de Sofi (la plantilla para retomar un chat, por
// ejemplo), se antepone una nota que dice lo que de verdad paso.
const NOTA_RECORTE = "[Conversación retomada: los mensajes anteriores tienen más de 7 días y no se muestran.]";

function historialVigente(mensajes, ahora = new Date(), dias = PAUSA_MINIMA_DIAS) {
  const lista = mensajes || [];
  const limite = ahora.getTime() - dias * DIA_MS;
  const vigentes = lista.filter((m) => !m.created_at || new Date(m.created_at).getTime() >= limite);
  if (vigentes.length === lista.length) return lista;
  if (vigentes.length && vigentes[0].role === "assistant") return [{ role: "user", content: NOTA_RECORTE }, ...vigentes];
  return vigentes;
}

module.exports = { diasDePausa, historialVigente, PAUSA_MINIMA_DIAS };
