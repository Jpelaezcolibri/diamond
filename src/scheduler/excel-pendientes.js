// El Excel de pendientes de cada asesora, a las 8 a. m. y a las 2 p. m., de
// lunes a sabado (spec 2026-10-30 §5). Junta los pendientes abiertos de cada
// asesora, arma el .xlsx y se lo manda: documento si tiene la ventana de 24 h
// abierta; plantilla PENDIENTES_EXCEL_PLANTILLA (encabezado de documento) si
// la tiene cerrada; si no hay plantilla, sus casos pasan a una con la ventana
// abierta, y si ninguna la tiene, campana. Lo que no vuelve sale otra vez en
// el siguiente turno. Interruptor PENDIENTES_EXCEL (apagado salvo "true").
// No lo apaga ASESORA_SOLO_VISITAS (pedido de Juan, 2026-10-30).
const INTERVALO_MIN = 10;
const MAX_FILAS = 40;
const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function minutosBogota(fecha) {
  const t = new Date(fecha.getTime() - 5 * 3600 * 1000);
  return { dia: t.getUTCDay(), min: t.getUTCHours() * 60 + t.getUTCMinutes(), fecha: t.toISOString().slice(0, 10) };
}
// "8am" de 8:00 a 8:29 y "2pm" de 14:00 a 14:29, de lunes a sabado.
function turnoDe(ahora) {
  const { dia, min } = minutosBogota(ahora);
  if (dia === 0) return null;
  if (min >= 480 && min < 510) return "8am";
  if (min >= 840 && min < 870) return "2pm";
  return null;
}
function inicioTurno(ahora, turno) {
  const { fecha } = minutosBogota(ahora);
  return new Date(`${fecha}T${turno === "8am" ? "08" : "14"}:00:00-05:00`).getTime();
}

function depsPorDefecto() {
  const wa = require("../channels/whatsapp");
  return {
    orgs: () => require("../data/organizations").listActive(),
    activo: () => /^(true|1|si|sí|on)$/i.test(String(process.env.PENDIENTES_EXCEL || "")),
    abiertos: async (orgId) => {
      const cp = require("../data/contactos-pendientes");
      return (await cp.disponible()) ? cp.abiertos(orgId) : [];
    },
    ciclo: (orgId) => require("../data/rotacion-citas").asesoresDelCiclo(orgId),
    conVentana: (org, ciclo, ahora) => require("../lib/ventana-asesoras").conVentana(org, ciclo, { ahora }),
    lead: (orgId, id) => require("../data/leads").findById(orgId, id),
    mensajes: (convId) => (convId ? require("../data/conversations").getRecentMessages(convId, 16) : []),
    armarCaso: (args) => require("../lib/caso-pendiente").armarCaso({ ...args, crmUrl: String(process.env.CRM_PUBLIC_URL || "").trim().replace(/\/$/, "") || null }),
    armarLibro: (args) => require("../lib/pendientes-excel").armarLibro(args),
    subir: (org, buffer, filename) => wa.uploadMediaToMeta(org, buffer, MIME, filename),
    documento: (org, tel, mediaId, filename) => wa.sendWhatsAppMedia(org, tel, { type: "document", mediaId, filename }),
    plantilla: (org, tel, args) => wa.sendWhatsAppTemplate(org, tel, args),
    texto: (org, tel, t) => require("../lib/mensaje-asesor").enviarYRegistrar(org, tel, t),
    marcarEnviados: (ids, o) => require("../data/contactos-pendientes").marcarEnviados(ids, o),
    campana: (args) => require("../notifications/avisar-asesor").avisarAsesor(args),
    nombrePlantilla: String(process.env.PENDIENTES_EXCEL_PLANTILLA || "").trim() || null,
  };
}

const tel = (a) => String((a && a.phone) || "").replace(/\D/g, "");
const fechaCorta = (ahora) => new Date(ahora.getTime() - 5 * 3600 * 1000).toLocaleDateString("es-CO", { timeZone: "UTC", day: "numeric", month: "short" }).replace(".", "");

let corriendo = false;
async function runOnce({ ahora = new Date(), deps = null } = {}) {
  const res = { enviados: 0, filas: 0, porPlantilla: 0, reasignados: 0 };
  const turno = turnoDe(ahora);
  const d = { ...depsPorDefecto(), ...(deps || {}) };
  if (!turno || corriendo || !d.activo()) return res;
  corriendo = true;
  try {
    const desde = inicioTurno(ahora, turno);
    for (const org of await d.orgs()) {
      const abiertos = await d.abiertos(org.id).catch((e) => { console.error("[excel-pendientes] no se pudieron leer:", e.message); return []; });
      if (abiertos.length === 0) continue;
      const ciclo = await d.ciclo(org.id).catch(() => []);
      if (ciclo.length === 0) continue;
      const abiertas = await d.conVentana(org, ciclo, ahora).catch(() => []);
      const conVentana = new Set(abiertas.map((a) => a.id));

      // A quien le toca cada pendiente este turno.
      const grupos = new Map(); // advisor.id -> { advisor, filas, porPlantilla }
      for (const p of abiertos) {
        let a = ciclo.find((x) => x.id === p.asesor_id) || ciclo[0];
        let porPlantilla = false;
        if (!conVentana.has(a.id)) {
          if (d.nombrePlantilla) porPlantilla = true;
          else if (abiertas.length) { a = abiertas[0]; res.reasignados++; }
        }
        if (!grupos.has(a.id)) grupos.set(a.id, { advisor: a, filas: [], porPlantilla });
        grupos.get(a.id).filas.push(p);
      }

      for (const { advisor, filas, porPlantilla } of grupos.values()) {
        // Reinicio dentro del turno: si ya salio este turno, no se repite.
        if (filas.some((p) => p.enviado_at && new Date(p.enviado_at).getTime() >= desde)) continue;
        const lote = filas.slice(0, MAX_FILAS);
        const nombre = String(advisor.name || "").split(/\s+/)[0];
        if (!conVentana.has(advisor.id) && !porPlantilla) {
          await d.campana({ org, advisor, motivo: "aviso", lead: null, titulo: `Tienes ${lote.length} personas por contactar`, cuerpo: "Escríbele a Sofi para que te llegue el Excel de pendientes.", whatsapp: true }).catch(() => {});
          continue;
        }
        try {
          const casos = [];
          for (const p of lote) {
            const lead = await d.lead(org.id, p.lead_id).catch(() => null);
            if (!lead) continue;
            casos.push(await d.armarCaso({ org, pendiente: p, lead, mensajes: await d.mensajes(p.conversation_id).catch(() => []) }));
          }
          if (casos.length === 0) continue;
          const loteId = `L-${minutosBogota(ahora).fecha}-${turno}-${advisor.id.slice(0, 8)}`;
          const filename = `Pendientes Diamond - ${nombre} - ${fechaCorta(ahora)} ${turno}.xlsx`;
          const buffer = await d.armarLibro({ loteId, asesorId: advisor.id, casos });
          const mediaId = await d.subir(org, buffer, filename);
          const instrucciones = `${nombre}, tienes ${casos.length} personas por contactar. Escríbeles o llámalas, llena la columna Resultado (y fecha, hora y ref si agendaste visita) y devuélveme el Excel por este chat.`;
          if (porPlantilla) {
            const r = await d.plantilla(org, tel(advisor), { name: d.nombrePlantilla, bodyParams: [String(casos.length)], headerDocument: { id: mediaId, filename } });
            if (!r || !r.ok) throw new Error(`plantilla: ${r && r.error}`);
            res.porPlantilla++;
          } else {
            await d.documento(org, tel(advisor), mediaId, filename);
            await d.texto(org, tel(advisor), instrucciones);
          }
          await d.marcarEnviados(lote.map((p) => p.id), { loteId, asesorId: advisor.id });
          res.enviados++;
          res.filas += casos.length;
          console.log(`[excel-pendientes] ${turno} -> ${advisor.name}: ${casos.length} pendientes${porPlantilla ? " (plantilla)" : ""}`);
        } catch (e) {
          console.error(`[excel-pendientes] no salio el Excel a ${advisor.name}:`, e.message);
        }
      }
    }
    return res;
  } finally {
    corriendo = false;
  }
}

let timer = null;
function start() {
  const tick = () => runOnce().catch((e) => console.error("[excel-pendientes] runOnce:", e.message));
  timer = setInterval(tick, INTERVALO_MIN * 60 * 1000);
  setTimeout(tick, 2 * 60 * 1000);
  console.log(`[excel-pendientes] ${depsPorDefecto().activo() ? "activo" : "apagado (PENDIENTES_EXCEL)"} — 8 a. m. y 2 p. m.`);
  return timer;
}

module.exports = { runOnce, start, turnoDe, MAX_FILAS };
