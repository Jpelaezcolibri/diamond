// Los avisos post-DM que el freno de ritmo no dejo salir en el momento.
//
// POR QUE EXISTE (Juan, 2026-09-14: "me dicen que llegan muchos mensajes
// para el mismo colega"). El aviso post-DM —"ya le mande por privado a X, y
// esto quedo para vos"— salia en linea desde vivo.js#asistir SIN pasar por el
// freno de ritmo y sin contarse en el. Medido del 07 al 14-sep: Jaime publico
// 8 pedidos en 2 minutos y a la asesora le llegaron 2 post-DM y 1 aviso en 37
// segundos. Ahora el post-DM respeta el mismo freno que el resto: si a la
// asesora se le escribio hace menos de VENTANA_MIN, queda aca y la bandeja de
// salida (src/scheduler/avisos-salida.js) lo entrega junto con lo demas.
//
// POR QUE EN MEMORIA Y NO EN LA BASE. La señal ya quedo resuelta por el DM
// (respondida_at). Marcarla como pendiente de aviso la volveria candidata a
// recordatorio y escalado: el bug de doble escalado del commit 5db7e74 (ver
// la nota en vivo.js). Un reinicio borra la cola; lo que se pierde es el
// resumen de algo que el colega YA recibio, y el pedido sigue en /grupos.
//
// La bandeja MIRA la cola (ver) y saca los items solo si el mensaje se
// entrego (quitar): un envio fallido o una excepcion no pierden nada.

const cola = new Map(); // `${orgId}|${advisorId}` -> [item]

const clave = (orgId, advisorId) => `${orgId}|${advisorId}`;

/**
 * @param item { texto, colega, enviadas: [refs], dudosas: n, faltantes: n, link }
 *   `texto` es el aviso completo, para cuando sale solo; el resto es lo que
 *   usa el digest cuando sale agrupado.
 */
function encolar(orgId, advisorId, item) {
  const k = clave(orgId, advisorId);
  if (!cola.has(k)) cola.set(k, []);
  cola.get(k).push({ ...item, encoladoMs: Date.now() });
}

function ver(orgId, advisorId) {
  return [...(cola.get(clave(orgId, advisorId)) || [])];
}

function quitar(orgId, advisorId, items) {
  const k = clave(orgId, advisorId);
  const quedan = (cola.get(k) || []).filter((i) => !items.includes(i));
  if (quedan.length) cola.set(k, quedan);
  else cola.delete(k);
}

function _reset() {
  cola.clear();
}

module.exports = { encolar, ver, quitar, _reset };
