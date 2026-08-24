// El colega que publica un pedido queda registrado.
//
// Es el limite de alcance que se decidio a proposito (ver la migracion
// 2026-08-22_colegas_grupos.sql): se guarda a quien PUBLICA algo que cruzamos,
// no se barren los 1.012 participantes visibles. Este test es lo que impide que
// ese limite se corra sin querer.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const fuente = fs.readFileSync(path.join(__dirname, "..", "src", "groups", "vivo.js"), "utf8");

test("vivo.js registra al colega en el directorio", () => {
  assert.match(fuente, /require\("\.\/directorio"\)/, "vivo.js tiene que usar el directorio");
  assert.match(fuente, /directorio\.registrar\(/, "tiene que llamar a directorio.registrar");
});

test("el registro NO bloquea el pipeline si falla", () => {
  // Guardar un contacto es un efecto lateral: si la base o WAHA fallan, el
  // pedido tiene que seguir su curso igual.
  const linea = fuente.split("\n").find((l) => l.includes("directorio.registrar("));
  assert.ok(linea, "deberia existir la llamada");
  const bloque = fuente.slice(fuente.indexOf("directorio.registrar("), fuente.indexOf("directorio.registrar(") + 400);
  assert.match(bloque, /catch/, "la llamada tiene que estar protegida con catch");
});

test("no se barre la lista de participantes desde vivo.js", () => {
  // Poblar el directorio en masa es justamente lo que el alcance excluye.
  assert.doesNotMatch(
    fuente,
    /participantesDeGrupo/,
    "vivo.js no debe listar participantes: el directorio resuelve de a un colega, sobre interaccion real"
  );
});

test("la sesion de WAHA llega hasta vivo.js", () => {
  // Sin el nombre de la sesion el directorio no puede refrescar el grupo, el
  // indice arranca vacio y la resolucion da 0%: la fase no mediria nada.
  assert.match(fuente, /sesion\s*=\s*null/, "procesarMensaje tiene que recibir `sesion` en las opciones");

  const canal = fs.readFileSync(path.join(__dirname, "..", "src", "channels", "whatsapp-group.js"), "utf8");
  const i = canal.indexOf("vivo.procesarMensaje(");
  assert.ok(i > -1);
  assert.match(canal.slice(i, i + 500), /sesion:\s*ev\.sesion/, "el canal tiene que pasar ev.sesion");
});
