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

module.exports = { diasDePausa, PAUSA_MINIMA_DIAS };
