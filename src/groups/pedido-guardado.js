// Utilidades compartidas para volver a trabajar un pedido YA guardado
// (group_signals): el rescate en lote (scripts/rescate-pedidos.js) y el
// seguimiento al colega (scheduler/seguimiento-colega.js) usan la MISMA
// reconstruccion del pedido para el motor y el MISMO filtro de lo que Sofi
// descarto, para que no se desvien entre si.

// Las refs que Sofi VIO (las de signal.matches), sin los matches de aliado
// guardados sin ref.
function refsVistas(matchesVistos) {
  return new Set((matchesVistos || []).filter((m) => m && m.ref !== null && m.ref !== undefined).map((m) => String(m.ref)));
}

// Corre el motor para una señal guardada: devuelve sus matches de hoy.
async function cruzarPedidoGuardado(org, s) {
  const { cruzar } = require("./match");
  const r = await cruzar([{ ...s, clase: "demanda", mensaje: {} }], { org });
  return (r && r.demandas && r.demandas[0] && r.demandas[0].matches) || [];
}

// Lo que Sofi ya descarto, con su veredicto guardado. Solo cuenta para las refs
// que Sofi VIO: una que el motor encuentra hoy y antes no, Sofi nunca la juzgo.
// El descarte "de aliado" que no vale se decide con la MISMA funcion del radar
// (vivo.js#rescatarDescartesFalsos: solo si Sofi no aprobo ninguna, solo
// propias de puntaje >= 95), para que el lote y el radar dejen salir lo mismo.
function excluirPorSofi(rev0, matchesVistos, candidatas) {
  if (!rev0) return { quedan: candidatas, excluidas: [] };
  const { rescatarDescartesFalsos } = require("./vivo");
  const rev = rescatarDescartesFalsos(rev0, matchesVistos) || rev0;
  const vistas = refsVistas(matchesVistos);
  const utiles = new Set((rev.refs_utiles || []).map(String));
  const dudosas = new Set((rev.refs_dudosas || []).map(String));
  const motivoDudosa = new Map((rev.dudosas_motivo || []).map((d) => [String(d.ref), d.motivo]));
  const quedan = [];
  const excluidas = [];
  for (const m of candidatas) {
    const ref = String(m.ref);
    if (!vistas.has(ref) || utiles.has(ref)) {
      quedan.push(m);
    } else if (dudosas.has(ref)) {
      const motivo = motivoDudosa.get(ref) || "sin_motivo";
      if (motivo === "aliado" || motivo === "dato_que_no_registramos") quedan.push(m);
      else excluidas.push({ ref, motivo: `sofi_dudosa:${motivo}` });
    } else {
      excluidas.push({ ref, motivo: "sofi_descarto" });
    }
  }
  return { quedan, excluidas };
}

module.exports = { refsVistas, cruzarPedidoGuardado, excluirPorSofi };
