// Serializa el procesamiento de mensajes por usuario (org+phone). Sin esto,
// 2-3 mensajes seguidos del mismo cliente (patron normal de un chat real)
// disparan procesarMensaje en paralelo: el segundo insert de lead choca
// contra el unique (org_id, phone), dos conversaciones "activas" se crean a
// la vez, y dos llamadas a Claude con historiales desincronizados terminan
// en doble respuesta o silencio. Cada key encadena sus tareas en orden;
// keys distintas (usuarios distintos) corren en paralelo sin bloquearse.
const queues = new Map(); // key -> promesa de la ultima tarea encolada

// Encola fn() para que corra despues de que termine la tarea anterior de la
// misma key (si la hay). Devuelve la promesa de ESTA tarea (se resuelve o
// rechaza segun fn, sin importar si la anterior fallo — una tarea fallida
// nunca deja la cola trabada para las siguientes).
function enqueue(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(key, next);
  // Limpieza: si esta sigue siendo la ultima tarea de la key cuando termina
  // (exito o error), se borra la entrada para no acumular memoria por cada
  // usuario que haya escrito alguna vez. El .catch(() => {}) es solo para
  // que esta rama de limpieza no dispare un unhandledRejection — el error
  // real ya viaja en `next`, que es lo que el llamador espera.
  next.catch(() => {}).then(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
  return next;
}

module.exports = { enqueue };
