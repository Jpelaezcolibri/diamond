// ¿Le esta escribiendo a la linea del radar un agente automatico de otra
// inmobiliaria? (Juan, 2026-10-28: "identifica siempre si es un agente para
// que no tengamos confusiones"; caso elizabeth muriel).
//
// - Marcado en colegas_grupos.es_agente: agente, siempre.
// - Dos o mas mensajes automaticos en el hilo (rechaza-bot.js): agente, y
//   queda marcado.
// - Uno solo: este hilo no se clasifica, pero no se marca. Una persona tambien
//   escribe "gracias por tu mensaje".
// El clasificador de la linea (dm.js) marca ademas al agente que redacta
// distinto cada vez y que ninguna frase atrapa.
const colegas = require("../data/colegas");
const { esAutorespuesta } = require("./rechaza-bot");

async function detectar(org, { identidad = {}, nombre = null, textos = [] } = {}) {
  const marcado = await colegas.esAgente(org.id, identidad).catch(() => null);
  if (marcado === true) return { agente: true, marcado: true, motivo: "marcado" };

  const automaticos = (textos || []).filter(esAutorespuesta);
  if (automaticos.length >= 2) {
    const r = await marcar(org, { identidad, nombre, motivo: `frases automaticas: "${String(automaticos[0]).slice(0, 120)}"` });
    return { agente: true, marcado: r.ok, motivo: "frases" };
  }
  if (automaticos.length === 1) return { agente: true, marcado: false, motivo: "frase" };
  return { agente: false, marcado: false };
}

async function marcar(org, { identidad = {}, nombre = null, motivo = null } = {}) {
  const r = await colegas.marcarAgente(org.id, { lid: identidad.lid, telefono: identidad.telefono, nombre, motivo }).catch(() => ({ ok: false }));
  if (r.ok) console.log(`[agente-linea] ${nombre || identidad.lid || identidad.telefono} marcado como agente automatico (${motivo})`);
  return r;
}

module.exports = { detectar, marcar };
