// EPE — hashing. Corre igual en Node y en el navegador.
//
// ESTE ARCHIVO VIAJA AL NAVEGADOR. No puede importar `node:*`, Supabase,
// `process.env` ni tocar el DOM.
//
// Por que WebCrypto y no `node:crypto`: el nucleo tiene que correr en los dos
// runtimes, y `globalThis.crypto.subtle` existe en ambos (Node 20+ y todo
// navegador moderno). Una sola API, sin ramas ni inyeccion de dependencias.
//
// El precio es que `crypto.subtle` es asincrono, asi que todo lo que hashea es
// async. Se acepta: las alternativas eran ramificar por runtime o meter una
// implementacion de SHA-256 en JS puro, y las dos agregan mas codigo y mas
// superficie de error que un `await`.
//
// VERIFICADO, no asumido: SHA-256 sobre los mismos bytes da exactamente el
// mismo hex en las dos implementaciones — incluidos acentos y cadena vacia.
// Importa porque `idDeMensaje` alimenta el indice unico de `group_signals`: si
// el hash cambiara, las filas ya persistidas quedarian huerfanas y cada mensaje
// se reprocesaria como nuevo. Lo congela test/epe-hash.test.js con vectores
// fijos tomados de la implementacion vieja.

const { plano } = require("../../src/groups/texto");

async function sha256Hex(texto) {
  const bytes = new TextEncoder().encode(String(texto));
  const buf = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Id estable y determinista de un mensaje dentro de un grupo.
//
// `group_signals` tiene un indice unico (org_id, group_id, wa_message_id) y un
// export .txt no trae ningun id de WhatsApp. Derivarlo del contenido hace que
// re-subir el mismo export —o uno mas largo que lo contenga— no duplique ni una
// fila ni un centavo de IA.
//
// El prefijo y el orden de la semilla son parte del contrato persistido: NO se
// cambian sin una migracion.
async function idDeMensaje(m) {
  const semilla = `${m.grupo}|${m.instanteIso || ""}|${m.autor || ""}|${plano(m.texto)}`;
  return "export:" + (await sha256Hex(semilla)).slice(0, 40);
}

// Huella de CONTENIDO, deliberadamente SIN el grupo: los colegas difunden el
// mismo aviso en diez grupos a la vez. De 494 señales medidas en vivo, 312 eran
// repeticiones — es el mayor ahorro de IA del pipeline despues del prefiltro.
async function huella(m) {
  return sha256Hex(`${plano(m.autor)}|${plano(m.texto)}`);
}

module.exports = { sha256Hex, idDeMensaje, huella };
