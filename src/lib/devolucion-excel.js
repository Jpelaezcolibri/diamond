// La asesora le devuelve a Sofi el Excel de pendientes (spec 2026-10-30 §6):
// leer, validar cada fila, aplicar lo valido y contestarle con el resumen y lo
// que falta corregir. Una fila con error no frena las demas; las filas sin
// resultado no son error (siguen pendientes).
const px = require("./pendientes-excel");
const cp = require("../data/contactos-pendientes");

const XLSX = /spreadsheetml|ms-excel|\.xlsx?$/i;
function esExcel(extras) {
  return Boolean(extras && extras.type === "document" && XLSX.test(String(extras.media_mime || "")));
}

const BLOQUE_MS = () => require("./agenda-reglas").DURACION_MIN * 60 * 1000;

function depsPorDefecto() {
  return {
    descargar: async (url) => Buffer.from(await (await fetch(url)).arrayBuffer()),
    lead: (orgId, id) => require("../data/leads").findById(orgId, id),
    refExiste: async (org, ref) => Boolean(await require("../data/properties").findByRef(org, ref)),
    // ¿La asesora ya tiene una visita viva que se cruce con esta hora?
    choca: async (org, advisor, iso, leadId) => {
      const citasOrg = await require("../data/appointments").citasDeLaOrg(org.id);
      const ocupadas = require("../data/rotacion-citas").ocupadasDe(citasOrg, advisor, { excluirLeadId: leadId });
      const t = new Date(iso).getTime();
      return ocupadas.some((f) => Math.abs(new Date(f).getTime() - t) < BLOQUE_MS());
    },
    aplicar: (args) => require("./aplicar-pendiente").aplicar(args),
  };
}

const RESUMEN = { visita: "visita confirmada", nota: "con nota", no_contesta: "vuelve a salir (no contesta)", cerrado: "cerrado", descartado: "descartado" };

async function procesar({ org, advisor, mediaUrl, ahora = new Date(), deps = null }) {
  const d = { ...depsPorDefecto(), ...(deps || {}) };
  const nombre = String(advisor.name || "").split(/\s+/)[0];
  let buffer;
  try { buffer = await d.descargar(mediaUrl); } catch { buffer = null; }
  const libro = buffer ? await px.leerLibro(buffer) : { ok: false, error: "ilegible" };
  if (!libro.ok) {
    return libro.error === "no_es_nuestro"
      ? `${nombre}, ese Excel no es uno de los de pendientes que te mandé. Devuélveme el que te llegó, con la columna Resultado llena.`
      : `${nombre}, no lo pude abrir. Mándame el archivo de Excel (.xlsx) que te llegó, no una foto ni un PDF.`;
  }
  const conResultado = libro.filas.filter((f) => f.resultado);
  if (conResultado.length === 0) return `${nombre}, recibí el Excel pero no veo ningún resultado llenado. Llena la columna Resultado de las personas que ya contactaste y me lo devuelves.`;

  const pendientes = await cp.porCodigos(org.id, conResultado.map((f) => f.codigo));
  const porCodigo = new Map(pendientes.map((p) => [p.codigo, p]));
  const errores = [];
  const cuenta = {};
  let ya = 0;
  for (const f of conResultado) {
    const err = (msg) => errores.push(`fila ${f.fila} (${f.codigo}): ${msg}`);
    try {
      const p = porCodigo.get(f.codigo);
      if (!p) { err("ese código no existe"); continue; }
      if (p.asesor_id && p.asesor_id !== advisor.id) { err("no es tuyo, es de otra asesora"); continue; }
      if (!["pendiente", "enviado"].includes(p.estado)) { ya++; continue; }
      const v = px.validarFila(f, { ahora });
      if (v.vacia) continue;
      if (!v.ok) { err(v.error); continue; }
      if (v.accion.tipo === "visita") {
        if (!(await d.refExiste(org, v.accion.ref))) { err(`la ref ${v.accion.ref} no está en el inventario`); continue; }
        if (await d.choca(org, advisor, v.accion.fechaHoraIso, p.lead_id)) { err("ya tienes otra visita a esa hora"); continue; }
      }
      const lead = await d.lead(org.id, p.lead_id);
      if (!lead) { err("no encontré a esa persona en el CRM"); continue; }
      const r = await d.aplicar({ org, advisor, pendiente: p, lead, accion: v.accion, archivoUrl: mediaUrl });
      if (r.resumen === "ya_aplicado") { ya++; continue; }
      cuenta[r.resumen] = (cuenta[r.resumen] || 0) + 1;
    } catch (e) {
      console.error("[devolucion-excel] fila", f.fila, e.message);
      err("no la pude aplicar por un error mío; intenta de nuevo más tarde");
    }
  }
  const total = Object.values(cuenta).reduce((a, b) => a + b, 0);
  const partes = Object.entries(cuenta).map(([k, n]) => `${n} ${RESUMEN[k] || k}`).join(", ");
  let txt = total ? `Listo, ${nombre}: apliqué ${total} en el CRM (${partes}).` : `${nombre}, no apliqué nada nuevo.`;
  if (ya) txt += ` ${ya} ya estaban aplicadas de antes.`;
  if (errores.length) txt += `\n\nMe faltan ${errores.length}:\n- ${errores.join("\n- ")}\n\nCorrígelas y devuélveme el Excel cuando quieras.`;
  console.log(`[devolucion-excel] ${advisor.name}: aplicadas=${total} ya=${ya} errores=${errores.length}`);
  return txt;
}

module.exports = { esExcel, procesar };
