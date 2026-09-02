// El ritmo al que se le puede escribir a una asesora.
//
// POR QUE EXISTE (Juan, 2026-09-02): "no quiero que seas tan insistente". El
// 2 de septiembre, entre las 05:59 y las 08:33 —menos de tres horas— salieron
// 23 mensajes a Natalia y 14 a Catherine, ninguna respondio, y WhatsApp
// rechazo CUATRO con `(#131056) pair rate limit hit`: el limite de frecuencia
// entre un numero de negocio y una persona. Tres ofertas del mismo mandato
// salieron en el mismo minuto. El volumen dejo de ser solo molesto y empezo a
// costar entregas.
//
// COMO SE USA. Los dos caminos que le escriben a una asesora —el aviso de una
// oportunidad (src/groups/vivo.js) y el de una oferta que le sirve a un
// mandato (src/groups/avisar-mandato.js)— preguntan primero. Si la respuesta
// es no, NO envian y tampoco marcan nada: el pendiente queda en la base y la
// bandeja de salida (src/scheduler/avisos-salida.js) lo entrega agrupado con
// todo lo demas que se haya acumulado.
//
// Con trafico bajo esto no cambia nada: el primer aviso pasa siempre, sale en
// el momento, y se ve igual que antes. La agrupacion aparece solo en la
// rafaga, que es cuando molesta.
//
// EN MEMORIA A PROPOSITO. Es un acelerador, no un invariante: si el proceso
// reinicia, lo peor que pasa es que el proximo aviso salga enseguida — que es
// exactamente lo que se quiere. Guardarlo en la base seria pagar una escritura
// por aviso para proteger algo que no hace falta proteger.

const VENTANA_MIN = Number(process.env.AVISOS_VENTANA_MIN || 10);

const ultimoEnvio = new Map();

/** ¿Se le puede escribir YA a esta asesora, o hay que dejarlo en cola? */
function puedeEnviar(advisorId, ahora = Date.now()) {
  if (!advisorId) return true; // sin asesora identificada no hay a quien espaciar
  const previo = ultimoEnvio.get(advisorId);
  if (!previo) return true;
  return ahora - previo >= VENTANA_MIN * 60 * 1000;
}

/** Se llama DESPUES de un envio que salio bien. */
function registrarEnvio(advisorId, ahora = Date.now()) {
  if (advisorId) ultimoEnvio.set(advisorId, ahora);
}

function _reset() {
  ultimoEnvio.clear();
}

module.exports = { puedeEnviar, registrarEnvio, VENTANA_MIN, _reset };
