#!/usr/bin/env node
// Pasa a ally_properties las ofertas que ya se detectaron en modo sombra.
//
//   node scripts/backfill-ofertas-grupos.js            (simulacion, no escribe)
//   node scripts/backfill-ofertas-grupos.js --aplicar  (escribe de verdad)
//
// POR QUE HACE FALTA: en modo sombra las ofertas se guardan en group_signals
// pero NO se escriben en ally_properties — sombra detecta y se calla. Al pasar
// un grupo a 'sugerir' solo entran las nuevas: cambiar el modo no reprocesa
// hacia atras. Esto recupera las que quedaron del periodo de evaluacion.
//
// Es idempotente: la dedup de las de origen grupo hace que correrlo dos veces
// refresque la fecha en vez de duplicar.

const config = require("../src/config");
const organizations = require("../src/data/organizations");
const supabase = require("../src/data/supabase");
const allyProperties = require("../src/data/ally-properties");
const whatsappGroups = require("../src/data/whatsapp-groups");
const { operacionCanonica, precioTexto } = require("../src/groups/recomendar");

const APLICAR = process.argv.includes("--aplicar");

// Mismo criterio que recomendar.js: una oferta sin estos datos es una fila
// muerta — Sofi nunca podria recomendarsela a un cliente.
function utilizable(s) {
  const contacto = s.contacto || s.autor_telefono || s.autor_nombre;
  return Boolean(s.tipo && s.zona && (s.precio_max > 0 || s.precio_min > 0) && contacto);
}

async function main() {
  if (!config.supabaseUrl) {
    console.error("\n  Falta SUPABASE_URL: sin base real no hay nada que migrar.\n");
    process.exit(1);
  }

  const org = await organizations.getDefault();

  // El puente es el asesor dueño de la sesion que detecto la oferta. Hoy no
  // guardamos que sesion vio cada mensaje, asi que con UNA sola sesion se
  // resuelve sin ambiguedad; con varias hay que decidirlo a mano.
  const sesiones = (await whatsappGroups.listSessions(org.id)).filter((s) => s.advisor_id);
  if (sesiones.length !== 1) {
    console.error(
      `\n  Hay ${sesiones.length} sesiones con asesor asignado. Este script asume UNA` +
      `\n  para saber a quien atribuir el puente. Con varias, hay que elegir a mano.\n`
    );
    process.exit(1);
  }
  const puente = sesiones[0];

  const { data: ofertas, error } = await supabase
    .from("group_signals").select("*").eq("org_id", org.id).eq("clase", "oferta")
    .order("created_at", { ascending: true });
  if (error) throw error;

  const buenas = ofertas.filter(utilizable);
  const descartadas = ofertas.length - buenas.length;

  console.log(`\n  Ofertas detectadas : ${ofertas.length}`);
  console.log(`  Utilizables        : ${buenas.length}`);
  if (descartadas > 0) console.log(`  Sin datos completos: ${descartadas} (no entran: serian filas muertas)`);
  console.log(`  Puente             : ${puente.nombre}\n`);

  let ok = 0;
  for (const s of buenas) {
    const fila = {
      titulo: (s.texto_original || "").slice(0, 120) || null,
      tipo: s.tipo || null,
      operacion: operacionCanonica(s.operacion),
      precio: precioTexto(s.precio_max || s.precio_min || 0),
      zona: s.zona || null,
      ciudad: s.ciudad || null,
      descripcion: s.texto_original || null,
      contacto_nombre: s.autor_nombre || null,
      contacto_telefono: s.contacto || s.autor_telefono || null,
      mensaje_original: s.texto_original || null,
      origen: "grupo",
      group_id: s.group_id,
      puente_advisor_id: puente.advisor_id,
      // La fecha real de deteccion, no ahora: la vigencia se cuenta desde que
      // el colega la publico. Inflarla seria mentirle al filtro de caducidad.
      visto_en_grupo_at: s.created_at,
    };

    const etiqueta = `${fila.tipo || "?"} en ${fila.zona || "?"} ${fila.precio || "sin precio"}`;
    if (!APLICAR) {
      console.log(`  [simulacion] ${etiqueta}`);
      continue;
    }
    try {
      await allyProperties.create(org.id, fila);
      ok++;
      console.log(`  ✓ ${etiqueta}`);
    } catch (e) {
      console.error(`  ✗ ${etiqueta} — ${e.message}`);
    }
  }

  console.log(
    APLICAR
      ? `\n  Listo: ${ok} propiedad(es) en la red de aliados.\n`
      : `\n  Simulacion. Nada se escribio. Correlo con --aplicar para hacerlo.\n`
  );
}

main().catch((e) => {
  console.error("\n  Error:", e.message, "\n");
  process.exit(1);
});
