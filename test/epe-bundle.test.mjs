// Verifica el BUNDLE construido, no el fuente.
//
// `test/prefilter-puro.test.js` revisa el árbol de `require` leyendo los
// archivos. Eso alcanza para el código propio, pero no ve lo que esbuild
// resuelve: un `require` transitivo, un polyfill que el bundler inyecta, o una
// dependencia que entra por un camino que el recorredor no siguió.
//
// Este test corre el build de verdad e inspecciona el resultado. Es la última
// compuerta antes de que el núcleo llegue al navegador de un asesor.

import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const EPE = join(RAIZ, "epe");
const BUNDLE = join(EPE, "dist/epe.js");

// El build necesita esbuild instalado. Si no está, se salta en vez de fallar:
// un clone limpio no debería romper `npm test` del bot, que no tiene
// devDependencies a propósito.
const hayEsbuild = existsSync(join(EPE, "node_modules/esbuild"));

test("el bundle se construye sin errores", { skip: !hayEsbuild && "falta: cd epe && npm install" }, () => {
  execFileSync("node", [join(EPE, "build.mjs")], { cwd: EPE, stdio: "pipe" });
  assert.ok(existsSync(BUNDLE), "no se generó epe/dist/epe.js");
});

test("el bundle no arrastra nada del servidor", { skip: !hayEsbuild && "falta: cd epe && npm install" }, () => {
  const js = readFileSync(BUNDLE, "utf8");

  // Cada patrón, con el motivo por el que sería un problema en el navegador.
  const PROHIBIDO = [
    [/\brequire\s*\(/, "quedó un require sin resolver — no existe en el navegador"],
    [/["']node:/, "referencia a un módulo de Node"],
    [/\bprocess\.env\b/, "variable de entorno — el sensor no tiene entorno"],
    [/\bsupabase\b/i, "cliente de base de datos"],
    [/\bfetch\s*\(/, "red — el núcleo nunca habla con nadie"],
    [/\bXMLHttpRequest\b/, "red"],
    [/\bchrome\./, "API de extensión — el núcleo no conoce a su host"],
    [/\bdocument\./, "DOM — el núcleo recibe mensajes ya extraídos, no lee la pantalla"],
    [/ANTHROPIC|sk-ant-/i, "credencial o proveedor de IA"],
  ];

  const encontrados = PROHIBIDO
    .filter(([patron]) => patron.test(js))
    .map(([patron, motivo]) => `${patron} → ${motivo}`);

  assert.deepStrictEqual(encontrados, [], `El bundle no es apto para el navegador:\n  ${encontrados.join("\n  ")}`);
});

test("el bundle expone EPE.procesar y corre sin Node", { skip: !hayEsbuild && "falta: cd epe && npm install" }, async () => {
  // Se evalúa el bundle en un contexto donde `require` y `process` NO existen,
  // que es la situación real de un content script. Si el código los tocara,
  // esto reventaría.
  const js = readFileSync(BUNDLE, "utf8");
  const fabricar = new Function(
    "globalThis",
    `"use strict"; var require = undefined, process = undefined, module = undefined, exports = undefined;
     ${js}
     return EPE;`
  );
  const EPE = fabricar(globalThis);

  assert.strictEqual(typeof EPE.procesar, "function");

  const r = await EPE.procesar([
    {
      id: "1",
      texto: "Tengo cliente para apto 3 alcobas en Laureles hasta 600 millones",
      autor: "Marcela",
      instanteIso: new Date().toISOString(),
      esSistema: false,
      esMultimedia: false,
    },
    {
      id: "2",
      texto: "Buenos días a todos",
      autor: "Andrés",
      instanteIso: new Date().toISOString(),
      esSistema: false,
      esMultimedia: false,
    },
  ]);

  assert.strictEqual(r.aEnviar.length, 1, "debería pasar solo el mensaje con señal inmobiliaria");
  assert.strictEqual(r.aEnviar[0].id, "1");
  assert.strictEqual(r.metricas.tasaDescarte, 0.5);
});

test("el bundle lleva el aviso de que es generado", { skip: !hayEsbuild && "falta: cd epe && npm install" }, () => {
  // Sin esto, alguien edita dist/ a mano y el cambio se pierde en el próximo
  // build — o peor, el sensor y el servidor divergen sin que nadie lo note.
  const js = readFileSync(BUNDLE, "utf8");
  assert.match(js, /NO EDITAR A MANO/);
});
