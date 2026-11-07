// El Excel de pendientes de cada asesora, UNA vez al dia (8 a. m., lunes a
// sabado; spec 2026-10-30 §5, cambiado por Juan el 2026-11-07: "las alertas se
// envian una sola vez al dia, no a las 8 y a las 2"). Junta los pendientes en
// cola (estado `pendiente`) de cada asesora, arma el .xlsx y se lo manda:
// documento si tiene la ventana de 24 h abierta; plantilla
// PENDIENTES_EXCEL_PLANTILLA (encabezado de documento) si la tiene cerrada; si
// no hay plantilla, sus casos pasan a una con la ventana abierta, y si ninguna
// la tiene, campana (una vez al dia).
//
// Lo que ya salio en un Excel (estado `enviado`) NO vuelve a salir aunque la
// asesora no lo haya devuelto: solo vuelve a la cola si ella marca "No
// contesta" (aplicar-pendiente.js), si aparece un motivo nuevo
// (contactos-pendientes.abrir) o si es un pendiente nuevo. Caso Catherine
// (2026-11-07): Andrea Strauch le llego tres veces en dos dias.
// Interruptor PENDIENTES_EXCEL (apagado salvo "true"). No lo apaga
// ASESORA_SOLO_VISITAS (pedido de Juan, 2026-10-30).
const ritmo = require("../lib/ritmo-avisos");
const { textoExcel, cuantas } = require("../lib/texto-pendientes");

const INTERVALO_MIN = 10;
const MAX_FILAS = 40;
const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// Hora de Bogota a la que sale (0-23). Ventana de 30 min por si un tick se cae.
const HORA = () => {
  const h = Number(process.env.PENDIENTES_EXCEL_HORA);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 8;
};

function minutosBogota(fecha) {
  const t = new Date(fecha.getTime() - 5 * 3600 * 1000);
  return { dia: t.getUTCDay(), min: t.getUTCHours() * 60 + t.getUTCMinutes(), fecha: t.toISOString().slice(0, 10) };
}
// "8am" de 8:00 a 8:29 (o la hora de PENDIENTES_EXCEL_HORA), de lunes a sabado.
function turnoDe(ahora) {
  const { dia, min } = minutosBogota(ahora);
  if (dia === 0) return null;
  const inicio = HORA() * 60;
  if (min >= inicio && min < inicio + 30) return HORA() < 12 ? `${HORA()}am` : `${HORA() - 12 || 12}pm`;
  return null;
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
const fechaCorta = (ahora) => new Date(ahora.getTime() - 5 * 3600 * 1000).toLocaleDateString("es-CO", { timeZone: "UTC", day: "numeric", month: "short" }).replace(/\./g, "").replace(/\s+de\s+/, " ");

// La campana (cuando nadie tiene la ventana abierta) sale una vez al dia por
// asesora. En memoria a proposito, como ritmo-avisos: tras un reinicio lo
// peor es que salga una vez mas.
let campanaHoy = new Map(); // advisor.id -> fecha (Bogota)

let corriendo = false;
async function runOnce({ ahora = new Date(), deps = null } = {}) {
  const res = { enviados: 0, filas: 0, porPlantilla: 0, reasignados: 0 };
  const turno = turnoDe(ahora);
  const d = { ...depsPorDefecto(), ...(deps || {}) };
  if (!turno || corriendo || !d.activo()) return res;
  corriendo = true;
  try {
    const hoy = minutosBogota(ahora).fecha;
    for (const org of await d.orgs()) {
      const abiertos = await d.abiertos(org.id).catch((e) => { console.error("[excel-pendientes] no se pudieron leer:", e.message); return []; });
      // Solo lo que esta en cola: lo ya enviado no se repite (Juan, 2026-11-07).
      const enCola = abiertos.filter((p) => p.estado === "pendiente");
      if (enCola.length === 0) continue;
      const ciclo = await d.ciclo(org.id).catch(() => []);
      if (ciclo.length === 0) continue;
      const abiertas = await d.conVentana(org, ciclo, ahora).catch(() => []);
      const conVentana = new Set(abiertas.map((a) => a.id));

      // A quien le toca cada pendiente hoy.
      const grupos = new Map(); // advisor.id -> { advisor, filas, porPlantilla }
      for (const p of enCola) {
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
        const lote = filas.slice(0, MAX_FILAS);
        const nombre = String(advisor.name || "").split(/\s+/)[0];
        if (!conVentana.has(advisor.id) && !porPlantilla) {
          if (campanaHoy.get(advisor.id) === hoy || !ritmo.puedeEnviar(advisor.id, ahora.getTime())) continue;
          campanaHoy.set(advisor.id, hoy);
          ritmo.registrarEnvio(advisor.id, ahora.getTime());
          await d.campana({ org, advisor, motivo: "aviso", lead: null, titulo: `Tienes ${cuantas(lote.length)} por contactar`, cuerpo: "Escríbele a Sofi para que te llegue el Excel de pendientes.", whatsapp: true }).catch(() => {});
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
          const loteId = `L-${hoy}-${advisor.id.slice(0, 8)}`;
          const filename = `Pendientes Diamond - ${nombre} - ${fechaCorta(ahora)}.xlsx`;
          const buffer = await d.armarLibro({ loteId, asesorId: advisor.id, casos });
          const mediaId = await d.subir(org, buffer, filename);
          if (porPlantilla) {
            const r = await d.plantilla(org, tel(advisor), { name: d.nombrePlantilla, bodyParams: [cuantas(casos.length)], headerDocument: { id: mediaId, filename } });
            if (!r || !r.ok) throw new Error(`plantilla: ${r && r.error}`);
            res.porPlantilla++;
          } else {
            await d.documento(org, tel(advisor), mediaId, filename);
            await d.texto(org, tel(advisor), textoExcel(nombre, casos));
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
  console.log(`[excel-pendientes] ${depsPorDefecto().activo() ? "activo" : "apagado (PENDIENTES_EXCEL)"} — una vez al día, a las ${HORA()}:00`);
  return timer;
}

function _reset() { campanaHoy = new Map(); corriendo = false; }

module.exports = { runOnce, start, turnoDe, MAX_FILAS, _reset };
