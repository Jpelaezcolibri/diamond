#!/usr/bin/env node
/**
 * Envia al asesor los pedidos de colegas que tienen match con INVENTARIO PROPIO
 * y que todavia no se le avisaron.
 *
 * Existe porque los avisos de la Fase 2 salen en el momento en que se detecta
 * la demanda, y durante los primeros dias muchos se rechazaron: fuera de la
 * ventana de 24 h de Meta, el texto libre no se entrega. Cuando el asesor le
 * escribe a Sofi la ventana se abre y esos avisos ya se pueden mandar.
 *
 * DOS RESGUARDOS, porque esto le escribe a una persona real:
 *
 *   1. Nunca reenvia. Solo toma las que tienen `enviado_at` en null, y
 *      `enviado_at` se marca UNICAMENTE cuando Meta confirmo la entrega (ver
 *      avisarDemanda en src/groups/recomendar.js). Lo ya recibido no se repite.
 *   2. Sin --enviar no manda nada: imprime exactamente lo que saldria.
 *
 * Uso:
 *   node scripts/enviar-demandas-pendientes.js              (simulacro)
 *   node scripts/enviar-demandas-pendientes.js --enviar
 */

const supabase = require("../src/data/supabase");
const organizations = require("../src/data/organizations");
const advisors = require("../src/data/advisors");
const groupSignals = require("../src/data/group-signals");
const { sendWhatsApp } = require("../src/channels/whatsapp");
const { buildGroupDemandAlert } = require("../src/notifications/advisor");

const APLICAR = process.argv.includes("--enviar");
const PAUSA_MS = 1500;

// Señales que NO se envían aunque tengan match, con el motivo. Sale por
// argumento para que excluir algo no obligue a tocar el codigo:
//   --excluir=<id>,<id>
//
// El 2026-07-29 hubo un caso claro: el pedido decia "SOLICITO: *SABANETA* ...
// *LAUREL* *BULEVAR ALCAZAR*" y el clasificador tomo las UNIDADES como zona y
// se comio el municipio, asi que matcheo 6 apartamentos de Laureles —otro
// barrio— de hasta $1.200 millones. Mandarselo al asesor para que lo publique
// en un grupo gremial cuesta credibilidad, que es lo unico que no se recupera.
const EXCLUIDAS = new Set(
  (process.argv.find((a) => a.startsWith("--excluir=")) || "").replace("--excluir=", "").split(",").filter(Boolean)
);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!supabase) {
    console.error("Hace falta SUPABASE_URL y SUPABASE_SERVICE_KEY.");
    process.exit(1);
  }
  const org = await organizations.getDefault();

  const { data: senales, error } = await supabase
    .from("group_signals")
    .select("*")
    .eq("org_id", org.id)
    .eq("clase", "demanda")
    .neq("matches", "[]")
    .is("enviado_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const { data: grupos } = await supabase
    .from("whatsapp_groups").select("id, nombre").eq("org_id", org.id);
  const nombreGrupo = new Map((grupos || []).map((g) => [g.id, g.nombre]));

  // Solo inventario propio: es lo que se pidio y es lo unico que el asesor
  // puede ofrecer sin llamar antes a nadie.
  const conPropias = senales
    .map((s) => ({ ...s, propias: (s.matches || []).filter((m) => m.fuente === "diamond") }))
    .filter((s) => s.propias.length > 0)
    .filter((s) => {
      if (!EXCLUIDAS.has(s.id)) return true;
      console.log(`EXCLUIDA a mano: ${(s.autor_nombre || "colega").slice(0, 30)} (${s.id})`);
      return false;
    });

  // ── Dedup por CONTENIDO, no por mensaje ──
  //
  // Los colegas publican el mismo pedido en varios grupos a la vez. El dedup de
  // la base es por wa_message_id, que cambia en cada grupo: correcto para
  // guardar, pero avisar cuatro veces del mismo pedido es spam, y con volumen
  // el asesor deja de leer los avisos. Medido el 2026-07-29: de 9 pendientes,
  // 6 eran de la misma persona y 4 el mismo pedido.
  //
  // Se agrupa por (autor + pedido) y se manda UNO solo, diciendo en que grupos
  // aparecio — que ademas es mejor informacion: le dice donde puede responder.
  const clave = (s) =>
    [s.autor_nombre, s.tipo, s.zona, s.operacion, s.precio_max, s.habitaciones]
      .map((v) => String(v ?? "").trim().toLowerCase()).join("|");

  const porPedido = new Map();
  for (const s of conPropias) {
    const k = clave(s);
    if (!porPedido.has(k)) porPedido.set(k, { ...s, duplicados: [] });
    else porPedido.get(k).duplicados.push(s);
  }
  const pendientes = [...porPedido.values()];

  const repetidos = conPropias.length - pendientes.length;
  console.log(
    `Demandas sin avisar con match propio: ${conPropias.length}\n` +
    `Pedidos distintos a enviar: ${pendientes.length}` +
    (repetidos > 0 ? `  (${repetidos} repetido(s) en otros grupos, se agrupan en un solo aviso)` : "") +
    "\n"
  );
  if (pendientes.length === 0) return;

  // Todas las senales de grupos vienen de la sesion de un asesor; se le avisa
  // a ese, que es quien tiene la relacion con el colega y acceso al grupo.
  const { data: sesiones } = await supabase
    .from("whatsapp_sessions").select("advisor_id").eq("org_id", org.id).not("advisor_id", "is", null);
  const advisorId = sesiones?.[0]?.advisor_id;
  const advisor = advisorId ? await advisors.findById(org.id, advisorId) : null;
  if (!advisor?.phone) {
    console.error("No hay un asesor con telefono asociado a la sesion. No se envia nada.");
    process.exit(1);
  }
  console.log(`Destinatario: ${advisor.name} (${advisor.phone})\n${"=".repeat(64)}\n`);

  let enviados = 0;
  let fallidos = 0;

  for (const s of pendientes) {
    // Todos los grupos donde aparecio el mismo pedido: le dice al asesor por
    // donde puede responder, en vez de mandarle un aviso por cada uno.
    const grupos = [s, ...s.duplicados]
      .map((x) => nombreGrupo.get(x.group_id))
      .filter(Boolean);
    const grupoTexto = [...new Set(grupos)].join(", ") || null;

    const texto = buildGroupDemandAlert(
      { ...s, matches: s.propias },
      { autor: s.autor_nombre, grupo: grupoTexto, texto: s.texto_original }
    );

    if (!APLICAR) {
      console.log(texto);
      console.log("\n" + "-".repeat(64) + "\n");
      continue;
    }

    const r = await sendWhatsApp(org, advisor.phone, texto);
    if (r?.ok) {
      // Se marcan TAMBIEN las copias del mismo pedido en otros grupos: si no,
      // la proxima corrida las vuelve a mandar como si fueran nuevas.
      for (const x of [s, ...s.duplicados]) {
        await groupSignals.marcarEnviada(org.id, x.group_id, x.wa_message_id);
      }
      enviados++;
      console.log(`OK  ${(s.autor_nombre || "colega").slice(0, 28)} — ${s.propias.length} opcion(es)`);
    } else {
      fallidos++;
      console.error(`FALLO  ${(s.autor_nombre || "colega").slice(0, 28)}: ${r?.error || "sin detalle"}`);
      // Si la ventana de 24 h esta cerrada fallan TODOS igual: no tiene
      // sentido seguir golpeando la API ni dejar a medias el lote.
      if (String(r?.error || "").includes("re-engagement") || String(r?.error || "").includes("131047")) {
        console.error("\nLa ventana de 24 h esta cerrada. Pedile al asesor que le escriba a Sofi y volve a correrlo.");
        break;
      }
    }
    await dormir(PAUSA_MS);
  }

  if (!APLICAR) {
    console.log(`Simulacro: ${pendientes.length} mensaje(s) NO enviados. Corre con --enviar para mandarlos.`);
  } else {
    console.log(`\nEnviados: ${enviados}  |  Fallidos: ${fallidos}`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
