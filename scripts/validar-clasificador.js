// Valida el clasificador de grupos (src/groups/classify.js) sobre un set
// CONGELADO de 60 mensajes: 40 pedidos y 12 ofertas reales de produccion con
// la etiqueta que les puso el modelo en vivo, y 8 de ruido escritos a mano.
// Es la misma composicion de la validacion del cache (2026-09-14,
// docs/costo-api-claude.md), que no se habia guardado.
//
//   Congelar (solo lee la base, una vez):
//     node scripts/validar-clasificador.js --congelar
//   Correr un modelo (gasta API, centavos):
//     railway run --service diamond node scripts/validar-clasificador.js --modelo claude-haiku-5-5
//
// Compara cada mensaje contra la etiqueta: clase, operacion, tipo, precio_max
// y zonas. El resultado queda en Claude outputs/validacion-clasificador-<modelo>.json.
const fs = require("fs");
const path = require("path");

const FIXTURE = path.join(__dirname, "..", "test", "fixtures", "classify-congelados.json");
const RUIDO = [
  "Buenos días colegas, bendiciones para todos 🙏",
  "Recuerden que mañana es la reunión de la lonja a las 9 am",
  "¿Alguien sabe si la notaría 15 abre los sábados?",
  "Feliz cumpleaños Marta!! 🎂🎉",
  "Este grupo es solo para pedidos, favor no publicar ofertas",
  "Jajaja qué buena esa",
  "Quién tiene el contacto del avaluador que recomendaron la semana pasada?",
  "Se cayó el sistema de la oficina de registro, paciencia",
];

async function congelar() {
  require("dotenv").config();
  const sb = require("../src/data/supabase");
  const { data: dem, error: e1 } = await sb
    .from("group_signals")
    .select("id, texto_original, clase, operacion, tipo, zonas, zona, precio_max, created_at")
    .eq("clase", "demanda")
    .not("texto_original", "is", null)
    .order("created_at", { ascending: false })
    .limit(400);
  if (e1) throw e1;
  // 28 de venta y 12 de arriendo, para que el arriendo pese aunque sea minoria.
  const venta = dem.filter((d) => d.operacion === "venta").slice(0, 28);
  const arriendo = dem.filter((d) => d.operacion === "arriendo").slice(0, 12);
  const { data: ofe, error: e2 } = await sb
    .from("ally_properties")
    .select("id, mensaje_original, operacion, tipo, created_at")
    .eq("origen", "grupo")
    .not("mensaje_original", "is", null)
    .order("created_at", { ascending: false })
    .limit(12);
  if (e2) throw e2;
  const casos = [
    ...[...venta, ...arriendo].map((d, i) => ({
      id: `d${i + 1}`,
      texto: d.texto_original,
      esperado: { clase: "demanda", operacion: d.operacion || "", tipo: d.tipo || "", precio_max: d.precio_max || 0, zonas: d.zonas || (d.zona ? [d.zona] : []) },
    })),
    ...ofe.map((o, i) => ({ id: `o${i + 1}`, texto: o.mensaje_original, esperado: { clase: "oferta" } })),
    ...RUIDO.map((t, i) => ({ id: `r${i + 1}`, texto: t, esperado: { clase: "ruido" } })),
  ];
  fs.writeFileSync(FIXTURE, JSON.stringify({ congelado: new Date().toISOString(), casos }, null, 1));
  console.log(`Congelados ${casos.length} casos en ${FIXTURE}`);
}

const norm = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

function comparar(caso, r) {
  const e = caso.esperado;
  const out = { id: caso.id, clase_ok: r && r.clase === e.clase };
  if (e.clase === "demanda" && r) {
    out.operacion_ok = norm(r.operacion) === norm(e.operacion);
    out.tipo_ok = !e.tipo || norm(r.tipo).includes(norm(e.tipo)) || norm(e.tipo).includes(norm(r.tipo));
    out.precio_ok = Number(r.precio_max || 0) === Number(e.precio_max || 0);
    const ez = (e.zonas || []).map(norm).filter(Boolean);
    const rz = (r.zonas || []).concat(r.zona ? [r.zona] : []).map(norm).filter(Boolean);
    out.zonas_ok = ez.length === 0 || ez.every((z) => rz.some((x) => x.includes(z) || z.includes(x)));
  }
  return out;
}

async function correr(modelo) {
  process.env.CLAUDE_MODEL_GRUPOS = modelo;
  const { classify, costoDe } = require("../src/groups/classify");
  const { casos } = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const t0 = Date.now();
  const { clasificados, uso, lotesFallidos } = await classify(casos.map((c) => ({ id: c.id, texto: c.texto, autor: "colega" })));
  const porId = new Map(clasificados.map((c) => [c.id, c]));
  const filas = casos.map((c) => ({ ...comparar(c, porId.get(c.id)), obtenido: porId.get(c.id) || null, esperado: c.esperado }));
  const cuenta = (k, f = () => true) => `${filas.filter((x) => f(x) && x[k]).length}/${filas.filter((x) => f(x) && k in x).length}`;
  const resumen = {
    modelo,
    segundos: Math.round((Date.now() - t0) / 100) / 10,
    lotesFallidos,
    clase: cuenta("clase_ok"),
    clase_demanda: cuenta("clase_ok", (x) => x.esperado.clase === "demanda"),
    clase_oferta: cuenta("clase_ok", (x) => x.esperado.clase === "oferta"),
    clase_ruido: cuenta("clase_ok", (x) => x.esperado.clase === "ruido"),
    operacion: cuenta("operacion_ok"),
    tipo: cuenta("tipo_ok"),
    precio_max: cuenta("precio_ok"),
    zonas: cuenta("zonas_ok"),
    uso,
    usd_por_mensaje: costoDe(uso, modelo) / casos.length,
  };
  const destino = path.join(__dirname, "..", "Claude outputs", `validacion-clasificador-${modelo}.json`);
  fs.writeFileSync(destino, JSON.stringify({ resumen, filas }, null, 1));
  console.log(JSON.stringify(resumen, null, 1));
  console.log("Detalle:", destino);
}

const args = process.argv.slice(2);
const i = args.indexOf("--modelo");
(args.includes("--congelar") ? congelar() : correr(i >= 0 ? args[i + 1] : "claude-haiku-5-5")).catch((e) => {
  console.error("Fallo:", e.message);
  process.exit(1);
});
