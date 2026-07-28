#!/usr/bin/env node
// Banco de pruebas offline de la Fase 0 — ver
// docs/superpowers/specs/2026-07-28-sofi-grupos-whatsapp-design.md
//
//   node scripts/group-mining/run.js <carpeta-exports> [--sin-ia] [--salida x.html]
//
// NO toca ninguna linea de WhatsApp, no monta infraestructura y solo hace
// lecturas contra Supabase. Su unico proposito es producir los numeros que
// deciden si el proyecto sigue o se cancela.

const fs = require("node:fs");
const path = require("node:path");

const { parseExport, rangoDeFechas } = require("./parse-export");
const { prefilter } = require("./prefilter");

// Umbral de la primera compuerta (spec, "Criterio de decision").
const UMBRAL_DESCARTE = 0.7;

function parseArgs(argv) {
  const args = { carpeta: null, sinIa: false, salida: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sin-ia") args.sinIa = true;
    else if (a === "--salida") args.salida = argv[++i];
    else if (!a.startsWith("--") && !args.carpeta) args.carpeta = a;
  }
  return args;
}

function uso(motivo) {
  console.error(`\n  ${motivo}\n`);
  console.error("  Uso: node scripts/group-mining/run.js <carpeta-exports> [--sin-ia] [--salida reporte.html]\n");
  console.error("  La carpeta debe contener los .txt que produce WhatsApp con");
  console.error('  "Exportar chat -> Sin archivos". Tienen datos de terceros:');
  console.error("  guardala FUERA del repo.\n");
  process.exit(1);
}

// Cada .txt es un grupo. WhatsApp los nombra "Chat de WhatsApp con <grupo>.txt".
function cargarExports(carpeta) {
  const archivos = fs.readdirSync(carpeta).filter((f) => f.toLowerCase().endsWith(".txt"));
  if (archivos.length === 0) uso(`No hay archivos .txt en ${carpeta}`);

  const mensajes = [];
  for (const archivo of archivos) {
    const grupo = path
      .basename(archivo, path.extname(archivo))
      .replace(/^Chat de WhatsApp con /i, "")
      .trim();
    const texto = fs.readFileSync(path.join(carpeta, archivo), "utf8");
    const delGrupo = parseExport(texto, { grupo });
    mensajes.push(...delGrupo);
    console.log(`  · ${grupo}: ${delGrupo.length} mensajes`);
  }
  return mensajes;
}

const pct = (n) => `${(n * 100).toFixed(1)}%`;

function imprimirEmbudo(stats, rango) {
  const porDia = (n) => (rango.dias ? (n / rango.dias).toFixed(1) : "—");

  console.log("\n─── Etapa 0: prefiltro ────────────────────────────────");
  console.log(`  Rango del export : ${rango.desde} → ${rango.hasta} (${rango.dias} días)`);
  console.log(`  Mensajes totales : ${stats.total}  (${porDia(stats.total)}/día)`);
  console.log(`  Descartados      : ${stats.descartados}  (${pct(stats.tasaDescarte)})`);
  for (const [motivo, n] of Object.entries(stats.porMotivo).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${motivo.padEnd(12)} ${n}`);
  }
  console.log(`  Pasan a la IA    : ${stats.pasan}  (${porDia(stats.pasan)}/día)`);

  const ok = stats.tasaDescarte >= UMBRAL_DESCARTE;
  console.log(
    `\n  Compuerta ≥${pct(UMBRAL_DESCARTE)}: ${ok ? "PASA" : "NO PASA"}` +
      (ok ? "" : " — ajustá scripts/group-mining/lexico.js antes de gastar en IA")
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.carpeta) uso("Falta la carpeta con los exports.");
  if (!fs.existsSync(args.carpeta)) uso(`No existe la carpeta ${args.carpeta}`);

  console.log(`\nLeyendo exports de ${path.resolve(args.carpeta)}`);
  const mensajes = cargarExports(args.carpeta);
  const rango = rangoDeFechas(mensajes);

  const { pasan, descartados, stats } = prefilter(mensajes);
  imprimirEmbudo(stats, rango);

  if (args.sinIa) {
    console.log("\n  (--sin-ia: no se llamó a Claude, no se gastó un token)\n");
    return;
  }

  // Las etapas 1-3 se cargan aca a proposito: --sin-ia debe correr sin
  // ANTHROPIC_API_KEY ni SUPABASE_URL configurados.
  const config = require("../../src/config");
  if (!config.supabaseUrl) {
    uso(
      "Sin SUPABASE_URL el cruce correría contra el inventario de demo en memoria\n" +
        "  y los matches serían ficticios. Configurá el .env, o usá --sin-ia."
    );
  }

  const { classify } = require("./classify");
  const { cruzar } = require("./match");
  const { generarReporte } = require("./report");

  console.log("\n─── Etapa 1: clasificación ────────────────────────────");
  const { clasificados, uso: usoTokens, lotesFallidos } = await classify(pasan);
  const porClase = clasificados.reduce((acc, c) => ({ ...acc, [c.clase]: (acc[c.clase] || 0) + 1 }), {});
  console.log(`  Demanda: ${porClase.demanda || 0}  ·  Oferta: ${porClase.oferta || 0}  ·  Ruido: ${porClase.ruido || 0}`);
  if (lotesFallidos > 0) console.log(`  ⚠ Lotes fallidos: ${lotesFallidos} (ver el reporte)`);

  console.log("\n─── Etapa 2: cruce contra inventario ──────────────────");
  const cruces = await cruzar(clasificados);
  console.log(`  Demandas con al menos un match: ${cruces.demandas.filter((d) => d.matches.length > 0).length}`);
  console.log(`  Ofertas con datos utilizables : ${cruces.ofertas.filter((o) => o.utilizable).length}`);

  const salida = args.salida || path.join(process.cwd(), "reporte-grupos.html");
  generarReporte(salida, { stats, rango, descartados, cruces, usoTokens, lotesFallidos });
  console.log(`\n  Reporte: ${salida}\n`);
}

main().catch((e) => {
  console.error("\n  Error:", e.message, "\n");
  process.exit(1);
});
