// Empaqueta el nucleo del EPE para el navegador.
//
// POR QUE UN BUNDLE Y NO UNA COPIA: el lexico se va a tunear —ya tiene fixes
// documentados, como el de "Buenos Aires" o el de "loma" generica—. Una copia
// manual diverge en silencio: el sensor descartaria cosas que el servidor
// habria aceptado, y eso son falsos negativos invisibles. Generando el bundle
// del mismo archivo que usa el servidor, divergir es estructuralmente
// imposible.
//
// SIN MINIFICAR, a proposito: el bundle lo tiene que poder leer un revisor de
// la Chrome Web Store y cualquiera que audite que el nucleo no manda nada a
// ningun lado. Pesa unos pocos KB; ahorrar bytes no compra nada aca.
//
// IIFE y no ESM: el content script de una extension MV3 se carga como script
// clasico. Formato global `EPE`.

import { build } from "esbuild";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SALIDA = join(AQUI, "dist/epe.js");

mkdirSync(join(AQUI, "dist"), { recursive: true });

const version = JSON.parse(readFileSync(join(AQUI, "package.json"), "utf8")).version;

await build({
  entryPoints: [join(AQUI, "core/index.js")],
  bundle: true,
  format: "iife",
  globalName: "EPE",
  platform: "browser",
  target: "chrome110",
  minify: false,
  outfile: SALIDA,
  banner: {
    js:
      `// EPE ${version} — nucleo de procesamiento local. Generado por epe/build.mjs.\n` +
      `// NO EDITAR A MANO: se regenera desde epe/core/ y src/groups/.\n` +
      `// Este codigo no hace red, no toca el DOM y no conoce la cuenta del asesor.`,
  },
});

const bytes = readFileSync(SALIDA).length;
console.log(`epe/dist/epe.js — ${(bytes / 1024).toFixed(1)} KB`);
