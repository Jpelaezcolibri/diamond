// Alerta tecnica cuando falla el sync de Wasi (Juan, 2026-10-17).
//
// El 16-oct la cuenta de Wasi estaba suspendida por falta de pago (factura
// 275675), el sync de DMAP dio de baja las 105 propiedades y el radar y Sofi
// se quedaron sin inventario sin que nadie se enterara. DMAP ya no apaga el
// inventario ante un error (wasi-api.source.ts#verificarRespuestaWasi), pero
// tampoco avisa: el sync falla callado y el inventario se envejece.
//
// Este vigilante mira la ultima corrida cada 30 min y, si fallo (o si retiro
// mas de la mitad de lo que vio), le avisa a ALERTA_TECNICA_TO — el numero de
// Juan, nunca el de una asesora — por la plantilla alerta_tecnica. Una vez
// por corrida.

const { enviarAlertaTecnica } = require("../lib/alerta-saldo");

const DOS_DIAS_MS = 2 * 24 * 60 * 60 * 1000;
const avisadas = new Set();

function depsPorDefecto() {
  return {
    ultimaCorrida: async () => {
      const supabase = require("../data/supabase");
      if (!supabase) return null;
      const { data } = await supabase.from("sync_runs").select("id, status, started_at, stats, error").order("started_at", { ascending: false }).limit(1);
      return (data && data[0]) || null;
    },
    enviar: (resumen, detalle) => enviarAlertaTecnica(resumen, detalle),
  };
}

function problemaDe(corrida) {
  if (!corrida) return null;
  if (corrida.status === "failed") return corrida.error || "sin detalle";
  const s = corrida.stats || {};
  if (Number(s.removed) > 5 && Number(s.removed) > Number(s.seen || 0) / 2) {
    return `la corrida retiró ${s.removed} de ${s.seen} propiedades`;
  }
  return null;
}

async function runOnce({ ahora = new Date(), deps = null } = {}) {
  const d = deps || depsPorDefecto();
  const corrida = await d.ultimaCorrida().catch(() => null);
  const problema = problemaDe(corrida);
  if (!problema || avisadas.has(corrida.id)) return { avisado: false };
  if (ahora.getTime() - new Date(corrida.started_at).getTime() > DOS_DIAS_MS) return { avisado: false };
  avisadas.add(corrida.id);
  const avisado = await d
    .enviar("Falló la sincronización con Wasi: el inventario no se está actualizando.", `Sync de Wasi: ${problema}`)
    .catch(() => false);
  return { avisado };
}

function start() {
  const tick = () => runOnce().catch((e) => console.error("[alerta-sync] runOnce:", e.message));
  setTimeout(tick, 2 * 60 * 1000);
  setInterval(tick, 30 * 60 * 1000);
  console.log("[alerta-sync] activo — revisa el sync de Wasi cada 30 min");
}

function _reset() {
  avisadas.clear();
}

module.exports = { start, runOnce, problemaDe, _reset };
