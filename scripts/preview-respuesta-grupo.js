// Previsualiza, SIN publicar nada, el mensaje que el radar en vivo enviaria a
// un grupo gremial ante una demanda dada.
//
// Es la herramienta de la fase de sombra: cruza contra el inventario REAL (solo
// lectura), aplica la compuerta de calidad y muestra el texto exacto, mas el
// detalle de que se descarto y por que. Sirve para auditar la calidad del
// inventario antes de que un colega vea un solo mensaje.
//
//   node scripts/preview-respuesta-grupo.js
//   node scripts/preview-respuesta-grupo.js --zona laureles --max 800000000 --tipo apartamento
//
// El clasificador (Haiku) NO se invoca: se arma el clasificado a mano para que
// la prueba sea gratis y determinista.

require("dotenv").config();

const { cruzar } = require("../src/groups/match");
const publicable = require("../src/groups/publicable");
const redactar = require("../src/groups/redactar");
const organizations = require("../src/data/organizations");
const syncEstado = require("../src/data/sync-estado");
const verificarLink = require("../src/groups/verificar-link");

function arg(nombre, porDefecto) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
}

// Por defecto, el ejemplo real que motivo el modulo.
const clasificado = {
  id: "preview",
  clase: "demanda",
  confianza: 0.95,
  operacion: arg("operacion", "venta"),
  tipo: arg("tipo", "apartamento"),
  zona: arg("zona", "el poblado"),
  ciudad: arg("ciudad", "medellin"),
  precio_min: Number(arg("min", 0)),
  precio_max: Number(arg("max", 1200000000)),
  habitaciones: Number(arg("habitaciones", 0)),
  area_min: Number(arg("area", 100)),
  banos: 0,
  garajes: Number(arg("garajes", 1)),
  estrato: 0,
  contacto: "",
  notas: "",
  mensaje: { autor: arg("autor", "Patricia Gomez"), texto: "(demanda de prueba)", instanteIso: new Date().toISOString() },
};

(async () => {
  const org = await organizations.getDefault();
  console.log(`Org: ${org.name}`);
  console.log(
    `Demanda: ${clasificado.operacion} · ${clasificado.tipo} · ${clasificado.zona} · ` +
      `hasta $${clasificado.precio_max.toLocaleString("es-CO")} · desde ${clasificado.area_min}m²\n`
  );

  const { demandas } = await cruzar([clasificado], { org });
  const d = demandas[0];

  console.log(`Matches del motor: ${d.matches.length}`);
  for (const m of d.matches) {
    console.log(`  [${String(m.puntaje).padStart(3)}] ${m.fuente.padEnd(7)} ${String(m.ref).padEnd(10)} ${m.zona} — ${m.precio} — ${m.area}`);
  }

  const inventario = await syncEstado.estadoDelInventario(org.id);
  console.log(
    `\nInventario: ultimo sync ${inventario.iso || "desconocido"}` +
      (inventario.horas !== null ? ` (hace ${inventario.horas} h)` : "") +
      ` -> ${inventario.fresco ? "fresco" : "VIEJO, no se publica nada"}`
  );

  const { publicables: candidatas, descartados } = publicable.filtrar(d.matches, {
    syncFresco: inventario.fresco,
  });
  console.log(`\nPasan la compuerta de calidad: ${candidatas.length} de ${d.matches.length}`);
  for (const x of descartados) console.log(`  descartada ${x.ref}: ${x.motivos.join(", ")}`);

  // Verificacion real contra Wasi: que el link que se va a publicar abra de
  // verdad (ver la nota de diseno en src/groups/verificar-link.js).
  const { verificadas: publicables, rotas } = await verificarLink.verificar(candidatas);
  if (candidatas.length) {
    console.log(`\nLinks de Wasi que abren: ${publicables.length} de ${candidatas.length}`);
    for (const r of rotas) console.log(`  ROTO ${r.ref}: ${r.link}`);
  }

  // Sin asesor: el mensaje es "blanqueado" a proposito, no deriva a nadie de
  // Diamond — ver la nota de diseno en src/groups/redactar.js.
  const texto = redactar.mensajeGrupo({ autor_nombre: clasificado.mensaje.autor }, publicables);
  console.log("\n══════════ MENSAJE QUE SE PUBLICARIA ══════════");
  console.log(texto === null ? "(nada: el bot calla)" : texto);
  console.log("═══════════════════════════════════════════════");
  process.exit(0);
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
