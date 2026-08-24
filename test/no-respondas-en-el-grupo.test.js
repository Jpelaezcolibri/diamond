// Invariante estructural: ningun modulo puede decirle a un asesor/colega que
// responda EN EL GRUPO gremial.
//
// POR QUE EXISTE. Juan fijo la norma el 2026-08-22: el gremio pide no llenar
// los grupos de informacion, asi que los pedidos se responden al PRIVADO del
// colega, nunca en el grupo. El primer commit que aplico la norma
// (alerta-asesor.js, aviso-cercano.js) lo dice explicito en su propio
// comentario: "cada motivo nuevo era un hueco nuevo". Una revision posterior
// (2026-08-24) encontro que la frase vieja seguia viva en OTROS TRES caminos
// (resumen-equipo.js, y dos avisos en notifications/advisor.js) que nadie
// habia tocado porque el fix original solo paso por los dos archivos donde
// arranco el problema.
//
// Un grep manual no alcanza: hace falta que quede en la suite, igual que
// group-canal.test.js hace con la garantia de "el canal no tiene via de
// salida propia" (ver la nota ahi). Sin esto, el proximo aviso que alguien
// escriba a mano puede reintroducir "respondele en el grupo" y nadie se
// entera hasta que el gremio se queje de nuevo.
//
// Se recorre TODO src/, no una lista de archivos: la garantia es "en ningun
// modulo", y una lista fija se desactualiza el dia que aparece un aviso
// nuevo en un archivo que hoy no existe.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "src");

// Mismo criterio que group-canal.test.js#soloCodigo: solo se pisan lineas
// que son comentario de punta a punta. Las notas historicas de arriba (y las
// de contacto.js, alerta-asesor.js, advisor.js, resumen-equipo.js que
// explican el cambio citando la frase vieja entre comillas) quedan afuera del
// analisis sin falsos positivos.
function soloCodigo(fuente) {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

// Sin tildes: cubre "respondele", "responde", "respondé" (y cualquier otra
// conjugacion) seguido de "en el grupo", venga con o sin acento.
function sinTildes(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const PROHIBIDO = /responde\w*\s+en el grupo/i;

function archivosJs(dir) {
  let resultado = [];
  for (const nombre of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, nombre.name);
    if (nombre.isDirectory()) resultado = resultado.concat(archivosJs(p));
    else if (nombre.isFile() && nombre.name.endsWith(".js")) resultado.push(p);
  }
  return resultado;
}

test("ningun modulo de src/ le dice al asesor que responda en el grupo (fuera de comentarios historicos)", () => {
  const infractores = [];
  for (const archivo of archivosJs(SRC)) {
    const codigo = sinTildes(soloCodigo(fs.readFileSync(archivo, "utf8")));
    if (PROHIBIDO.test(codigo)) infractores.push(path.relative(path.join(__dirname, ".."), archivo));
  }
  assert.deepStrictEqual(
    infractores,
    [],
    `Norma de Juan (2026-08-22): los pedidos se responden al privado del colega, nunca en el grupo. ` +
      `Usa tocarNombreEnGrupo() de src/lib/contacto.js en vez de escribir la instruccion a mano. ` +
      `Archivo(s) con la frase prohibida: ${infractores.join(", ")}`
  );
});
