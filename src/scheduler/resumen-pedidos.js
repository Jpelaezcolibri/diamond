// Resumen de pedidos para la asesora del radar (Juan, 2026-10-17).
//
// POR QUE EXISTE. Con ASESORA_SOLO_VISITAS la asesora dejo de recibir los
// pedidos que no salian solos, y nadie los atendia: el 16-17 oct entraron 29
// pedidos, 5 salieron solos y en 8 teniamos una ficha que ofrecer y nadie se
// entero. Juan pidio un resumen: "como hacemos para que Daiana reciba la
// informacion sobre los pedidos que se hicieron y a quienes les debe copiar".
//
// QUE LLEVA. Solo los pedidos que NO se contestaron (ni solos ni a mano) y
// donde SI hay inventario propio que se puede ofrecer: quien, en que grupo,
// que pidio, que ficha, que confirmar antes (el motivo por el que no salio
// sola), su contacto y el texto listo para copiar. Los pedidos sin ficha van
// en una sola linea con el total. Sin pendientes no sale nada.
//
// CUANDO. 12 m. (pedidos desde las 5 p. m. de ayer) y 5 p. m. (desde las 12).
//
// Es una excepcion explicita a ASESORA_SOLO_VISITAS (Juan, mismo dia), con su
// propio interruptor: RADAR_RESUMEN_PEDIDOS=false lo apaga entero.

const publicable = require("../groups/publicable");
const { ficha, primerNombre } = require("../groups/redactar");
const { hourInBogota } = require("./followups");

const HORAS = String(process.env.RESUMEN_PEDIDOS_HORAS || "12,17").split(",").map(Number);
const MAX_PEDIDOS = 8;
const MAX_FICHAS_POR_PEDIDO = 2;
// Una ficha frenada con puntaje bajo es ruido para la asesora: en la vista
// previa del 2026-10-17 entraba una de 60 puntos en zona vecina.
const PUNTAJE_MINIMO = 70;
const VALORES_APAGADO = new Set(["false", "0", "no", "off"]);
const BOGOTA_UTC = 5; // Colombia no tiene horario de verano

let ultimoTurno = null;

function activo() {
  return !VALORES_APAGADO.has(String(process.env.RADAR_RESUMEN_PEDIDOS ?? "").trim().toLowerCase());
}

// El turno anterior al de `ahora`: a las 12 mira desde las 17 de ayer; a las
// 17, desde las 12 de hoy.
function ventana(ahora = new Date()) {
  const hora = hourInBogota(ahora);
  const turnos = [...HORAS].sort((a, b) => a - b);
  const hoy = [...turnos].reverse().find((h) => h <= hora);
  // Antes del primer turno del dia, el turno vigente es el ultimo de ayer.
  const diasAtras = hoy === undefined ? 1 : 0;
  const actual = hoy ?? turnos[turnos.length - 1];
  const idx = turnos.indexOf(actual);
  const previo = idx > 0 ? turnos[idx - 1] : turnos[turnos.length - 1];
  const fechaBogota = new Date(ahora.getTime() - BOGOTA_UTC * 3600e3);
  const desde = new Date(Date.UTC(fechaBogota.getUTCFullYear(), fechaBogota.getUTCMonth(), fechaBogota.getUTCDate(), previo + BOGOTA_UTC));
  desde.setUTCDate(desde.getUTCDate() - diasAtras - (idx === 0 ? 1 : 0));
  return { desde, hasta: ahora, turno: actual };
}

function limpiarNombre(nombre) {
  const partes = String(nombre || "").replace(/[‎‏]/g, "").split(/\n/).map((s) => s.trim()).filter(Boolean);
  return partes.pop() || "Colega";
}

function horaLegible(iso) {
  return new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", weekday: "short", hour: "numeric", minute: "2-digit" });
}

// Las fichas que se le pueden ofrecer a este pedido: inventario propio, sin un
// motivo de "nunca ofrecer". Las que no salieron solas traen QUE confirmar.
function fichasOfrecibles(matches, señal, opciones) {
  const propias = (matches || []).filter((m) => m && m.fuente === "diamond");
  const { publicables, descartados } = publicable.filtrar(propias, opciones);
  const porRef = new Map(propias.map((m) => [String(m.ref), m]));
  const frenadas = descartados
    .map((d) => ({ match: porRef.get(String(d.ref)), clase: publicable.clasificarMotivos(d.motivos), motivos: d.motivos }))
    .filter((d) => d.match && d.clase.ofrecible && Number(d.match.puntaje) >= PUNTAJE_MINIMO)
    .map((d) => ({ match: d.match, confirmar: d.clase.soloPublicacion }));
  return [...publicables.map((m) => ({ match: m, confirmar: [] })), ...frenadas]
    .sort((a, b) => a.confirmar.length - b.confirmar.length || Number(b.match.puntaje) - Number(a.match.puntaje))
    .slice(0, MAX_FICHAS_POR_PEDIDO);
}

/**
 * @param filas [{ señal, matches }] — señal con grupo y telefono ya resueltos
 * @returns {{ items, sinFicha, mensajes }}
 */
function armar(filas, opciones = {}) {
  const pendientes = (filas || []).filter(({ señal }) => señal && señal.respuesta_modo !== "auto" && !señal.respondida_at);
  const items = [];
  let sinFicha = 0;
  for (const { señal, matches } of pendientes) {
    const fichas = fichasOfrecibles(matches, señal, opciones);
    if (!fichas.length) { sinFicha++; continue; }
    items.push({ señal, fichas });
  }
  if (!items.length) return { items, sinFicha, mensajes: [] };

  const mostrados = items.slice(0, MAX_PEDIDOS);
  const encabezado = [
    `📋 *Pedidos de colegas para atender* (${items.length})`,
    "No se contestaron solos y tenemos algo que ofrecerles. En cada uno va el contacto y el texto listo para copiar.",
    sinFicha ? `Además entraron ${sinFicha} pedido(s) sin propiedad nuestra que calce (están en el CRM, en Grupos).` : null,
    items.length > MAX_PEDIDOS ? `Acá van los ${MAX_PEDIDOS} más recientes; el resto está en el CRM, en Grupos.` : null,
  ].filter(Boolean).join("\n");

  const mensajes = [encabezado];
  mostrados.forEach(({ señal, fichas }, i) => {
    const nombre = limpiarNombre(señal.autor_nombre);
    const saludo = primerNombre(nombre) ? `Hola ${primerNombre(nombre)}` : "Hola";
    const contacto = señal.telefono ? `wa.me/${String(señal.telefono).replace(/\D/g, "")}` : "sin número: escríbele desde el grupo (toca su nombre)";
    // Cada advertencia va con su ref: en el pedido de Clara la "zona de al
    // lado" era de la segunda ficha y se leia como si fuera de las dos.
    const confirmar = fichas
      .filter((f) => f.confirmar.length)
      .map((f) => `⚠️ ${f.match.ref}: ${f.confirmar.map((m) => publicable.MOTIVOS_LEGIBLES[m] || m).join("; ")}`);
    const bloquesFicha = fichas.map((f, j) => ficha(f.match, j + 1, { detalleFalta: publicable.aclaracionParaColega(f.confirmar) }));
    mensajes.push([
      `*${i + 1}. ${nombre}* · ${señal.grupo || "grupo"} · ${horaLegible(señal.created_at)}`,
      `📞 ${contacto}`,
      `*Pidió:* ${String(señal.texto_original || "").replace(/[*_]/g, "").replace(/\s+/g, " ").slice(0, 220)}`,
      `*Ofrecerle:* ${fichas.map((f) => f.match.ref).join(", ")}`,
      ...confirmar,
      "",
      "*Texto para copiar:*",
      `${saludo}, vi tu pedido en el grupo ${señal.grupo || ""}. Te comparto lo que tengo:`,
      ...bloquesFicha,
      "¿Te agendo una visita?",
    ].join("\n"));
  });
  return { items, sinFicha, mensajes };
}

function depsPorDefecto() {
  return {
    orgs: () => require("../data/organizations").listActive(),
    señales: (org, desde, hasta) => cargarSeñales(org, desde, hasta),
    asesor: (org) => require("../data/advisors").findAsesorPrincipalRadar(org),
    enviar: (org, tel, texto) => require("../lib/mensaje-asesor").enviarYRegistrar(org, tel, texto),
    plantilla: (org, tel) => require("../channels/whatsapp").sendWhatsAppTemplate(org, tel, { name: "aviso_app", bodyParams: ["pedidos de colegas para atender"] }),
    notificar: (args) => require("../notifications/notificar").notificar(args),
  };
}

// Señales de la ventana, con el grupo y el telefono del colega resueltos y
// los matches recalculados AHORA (el inventario pudo cambiar, o estar caido
// cuando entro el pedido).
async function cargarSeñales(org, desde, hasta) {
  const supabase = require("../data/supabase");
  if (!supabase) return [];
  const { cruzar } = require("../groups/match");
  const { data: señales, error } = await supabase
    .from("group_signals").select("*").eq("org_id", org.id).eq("clase", "demanda")
    .gte("created_at", desde.toISOString()).lt("created_at", hasta.toISOString()).order("created_at");
  if (error) throw error;
  if (!señales || !señales.length) return [];
  const { data: grupos } = await supabase.from("whatsapp_groups").select("id, nombre").eq("org_id", org.id);
  const nombreGrupo = new Map((grupos || []).map((g) => [g.id, g.nombre]));
  const { data: colegas } = await supabase.from("colegas_grupos").select("lid, telefono").eq("org_id", org.id).not("telefono", "is", null);
  const telPorLid = new Map((colegas || []).map((c) => [String(c.lid).replace(/\D/g, ""), c.telefono]));
  const filas = [];
  for (const s of señales) {
    if (s.respuesta_modo === "auto" || s.respondida_at) continue;
    const lid = String(s.respuesta_destino_lid || s.autor_telefono || "").replace(/\D/g, "");
    const telefono = s.respuesta_destino_telefono || telPorLid.get(lid) || null;
    const { demandas } = await cruzar([s], { org }).catch(() => ({ demandas: [{ matches: [] }] }));
    filas.push({ señal: { ...s, grupo: nombreGrupo.get(s.group_id), telefono }, matches: demandas[0].matches });
  }
  return filas;
}

async function runOnce({ ahora = new Date(), forzar = false, deps = null } = {}) {
  if (!activo()) return { enviados: 0 };
  const hora = hourInBogota(ahora);
  if (!forzar && !HORAS.includes(hora)) return { enviados: 0 };
  const { desde, hasta, turno } = ventana(ahora);
  const clave = `${new Date(ahora.getTime() - BOGOTA_UTC * 3600e3).toISOString().slice(0, 10)}-${turno}`;
  if (!forzar && ultimoTurno === clave) return { enviados: 0 };
  ultimoTurno = clave;

  const d = deps || depsPorDefecto();
  let enviados = 0;
  for (const org of await d.orgs()) {
    try {
      const { items, mensajes } = armar(await d.señales(org, desde, hasta));
      const pendientes = await (d.sinAtender ? d.sinAtender(org, ahora) : require("./respuestas-publicacion").sinAtender(org.id, ahora)).catch(() => []);
      const lineaR = (r) => `• Ref ${r.property_ref} · ${r.colega_nombre || "colega"} (${r.via === "grupo" ? "en el grupo" : "en tu línea"}): "${String(r.primer_texto || "").slice(0, 80)}"`;
      if (pendientes.length) mensajes.push([`⏰ *Respuestas a nuestras publicaciones sin atender* (${pendientes.length})`, ...pendientes.map(lineaR)].join("\n"));
      if (!mensajes.length) continue;
      const asesor = await d.asesor(org);
      const tel = String(process.env.RADAR_REVISOR_PHONE || (asesor && asesor.phone) || "").replace(/\D/g, "");
      if (!tel) continue;

      let ok = true;
      for (const texto of mensajes) {
        const r = await d.enviar(org, tel, texto).catch((e) => ({ ok: false, error: e.message }));
        if (!r || !r.ok) { ok = false; console.warn("[resumen-pedidos] no salio el texto:", r && r.error); break; }
      }
      // Fuera de la ventana de 24 h WhatsApp no deja mandar texto libre: sale
      // la plantilla aprobada y el detalle queda en la app.
      if (!ok) await d.plantilla(org, tel).catch((e) => console.warn("[resumen-pedidos] plantilla:", e.message));
      if (asesor) {
        await d.notificar({
          orgId: org.id, advisor: asesor, tipo: "aviso", link: "/grupos",
          titulo: `${items.length} pedido(s) de colegas para atender`,
          cuerpo: items.map((i) => `${limpiarNombre(i.señal.autor_nombre)}: ${i.fichas.map((f) => f.match.ref).join(", ")}`).join(" · "),
        }).catch(() => {});
      }
      enviados++;
      console.log(`[resumen-pedidos] ${org.name}: ${items.length} pedido(s) · texto ${ok ? "ok" : "no salió, se mandó la plantilla"}`);
    } catch (e) {
      console.error(`[resumen-pedidos] error en ${org.name}:`, e.message);
    }
  }
  return { enviados };
}

function start() {
  if (!activo()) {
    console.log("[resumen-pedidos] apagado (RADAR_RESUMEN_PEDIDOS=false)");
    return;
  }
  const tick = () => runOnce().catch((e) => console.error("[resumen-pedidos] runOnce:", e.message));
  setInterval(tick, 10 * 60 * 1000);
  console.log(`[resumen-pedidos] activo — ${HORAS.map((h) => `${h}h`).join(" y ")} Colombia`);
}

function _reset() {
  ultimoTurno = null;
}

module.exports = { start, runOnce, armar, ventana, cargarSeñales, _reset };
