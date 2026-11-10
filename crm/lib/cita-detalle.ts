// Todo lo de una visita para el panel de detalle del calendario (Juan,
// 2026-11-09, mockup aprobado): quién va y cómo contactarlo, la propiedad, qué
// pidió, lo pendiente, el historial y los últimos mensajes para responder
// desde ahí. Caso Norha Vélez: la visita estaba confirmada en el calendario y
// nadie del equipo sabía quién era ni cómo escribirle.
//
// Solo lectura, con el cliente admin (el panel lo ve cualquier usuario del
// CRM, igual que el calendario; escribir pasa por /api/send con sus reglas).
import { enlazarWasiPublico } from "@/lib/wasi-link";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export type MensajeCorto = { role: "user" | "assistant"; content: string; createdAt: string };

export type DetalleCita = {
  leadId: string;
  conversationId: string | null;
  modo: "bot" | "humano";
  estado: "propuesta" | "confirmada" | "reprogramada" | "vencida" | "cancelada";
  tipo: string;
  fechaHora: string | null;
  corteAt: string | null;
  asesora: { nombre: string; alias: string | null } | null;
  confirmadaPor: string | null;
  confirmadaAt: string | null;
  persona: {
    nombre: string;
    esColega: boolean;
    celular: string | null; // legible, ej "+57 300 123 4567"
    whatsapp: string | null; // "573001234567" para wa.me
    sinCelularVisible: boolean;
    grupos: string[];
  };
  propiedad: {
    ref: string;
    titulo: string | null;
    tipoOperacion: string | null;
    zona: string | null;
    precio: string | null;
    datos: string[]; // "55m2", "3 habitaciones"...
    foto: string | null;
    linkWasi: string | null;
  } | null;
  refSinFicha: string | null;
  pedido: { texto: string; grupo: string | null; fecha: string } | null;
  pendientes: string[];
  historial: { fecha: string; texto: string }[];
  mensajes: MensajeCorto[];
  ventanaHasta: string | null; // fin de la ventana de 24 h, o null si está cerrada
};

// Mismo formato que reconoce el bot (src/channels/whatsapp.js): usuario de
// WhatsApp que oculta su número, ej "CO.1622610936270244".
const ID_DE_USUARIO = /^[A-Z]{2}\.[A-Za-z0-9.]+$/;

export function celularLegible(phone: string | null | undefined): string | null {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("57")) return `+57 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  return d.length >= 8 ? `+${d}` : null;
}

function estadoDe(e: string | null | undefined): DetalleCita["estado"] {
  if (e === "propuesta" || e === "reprogramada" || e === "vencida" || e === "cancelada") return e;
  return "confirmada";
}

const VENTANA_MS = 24 * 60 * 60 * 1000;

export async function getDetalleCita(admin: Admin, leadId: string): Promise<DetalleCita | null> {
  const { data: lead } = await admin
    .from("leads")
    // "*" y no una lista: leads.celular puede no existir todavía (migración
    // 2026-11-09_lead_celular.sql) y pedirla por nombre rompería la consulta.
    .select("*")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead || !lead.cita) return null;
  const cita = lead.cita;
  const ref: string | null = cita.ref || lead.property_ref_origen || null;
  const esColega = lead.source === "colega";
  // El celular que dejó en el chat (el bot lo guarda en leads.celular y en
  // cita.celular_contacto) manda sobre el de su WhatsApp. Caso Norha.
  const celularGuardado = String(lead.celular || cita.celular_contacto || "").replace(/\D/g, "");
  const sinCelularVisible = !celularGuardado && ID_DE_USUARIO.test(String(lead.phone || "").trim());

  // Asesoras: la que tiene la cita y las de la rotación (advisors.id).
  const idsAsesoras = [cita.asesor_id, ...((cita.historial || []) as { asesor_id?: string }[]).map((h) => h.asesor_id)].filter(Boolean);
  const { data: asesoras } = idsAsesoras.length
    ? await admin.from("advisors").select("id, name, alias_publico").in("id", idsAsesoras)
    : { data: [] };
  const nombreDe = new Map<string, { nombre: string; alias: string | null }>(
    (asesoras || []).map((a: { id: string; name: string; alias_publico: string | null }) => [a.id, { nombre: a.name, alias: a.alias_publico }]),
  );

  const [propRes, convRes, preguntasRes, colegaRes] = await Promise.all([
    ref ? admin.from("properties").select("ref, titulo, tipo, operacion, zona, ciudad, precio, area, habitaciones, banos, garaje, estrato, link, images").eq("org_id", lead.org_id).eq("ref", ref).maybeSingle() : { data: null },
    admin.from("conversations").select("id, modo").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(1),
    admin.from("preguntas_asesor").select("pregunta, created_at").eq("lead_id", leadId).eq("estado", "pendiente"),
    esColega
      ? admin.from("colegas_grupos").select("nombre, lid, grupos").eq("org_id", lead.org_id).eq("telefono", String(lead.phone || "").replace(/\D/g, "")).limit(1)
      : { data: null },
  ]);

  const p = propRes.data;
  const propiedad: DetalleCita["propiedad"] = p
    ? {
        ref: p.ref,
        titulo: p.titulo,
        tipoOperacion: [p.tipo, p.operacion ? `en ${String(p.operacion).toLowerCase()}` : null].filter(Boolean).join(" ") || null,
        zona: [p.zona, p.ciudad].filter(Boolean).join(", ") || null,
        precio: p.precio,
        datos: [
          p.area,
          p.habitaciones != null ? `${p.habitaciones} habitaciones` : null,
          p.banos != null ? `${p.banos} baños` : null,
          p.garaje != null ? `${p.garaje} parqueadero${Number(p.garaje) === 1 ? "" : "s"}` : null,
          p.estrato ? `estrato ${p.estrato}` : null,
        ].filter(Boolean) as string[],
        foto: Array.isArray(p.images) && p.images.length ? String(p.images[0]) : null,
        linkWasi: enlazarWasiPublico(p.link),
      }
    : null;

  const colega = colegaRes.data && colegaRes.data[0];
  let pedido: DetalleCita["pedido"] = null;
  if (colega && colega.lid) {
    const lid = String(colega.lid).replace(/@lid$/, "");
    const { data: señales } = await admin
      .from("group_signals")
      .select("texto_original, created_at, group_id, respondida_at, respuesta_refs")
      .eq("org_id", lead.org_id)
      .in("respuesta_destino_lid", [`${lid}@lid`, lid])
      .order("created_at", { ascending: false })
      .limit(1);
    const s = señales && señales[0];
    if (s && s.texto_original) {
      const { data: g } = s.group_id ? await admin.from("whatsapp_groups").select("nombre").eq("id", s.group_id).maybeSingle() : { data: null };
      pedido = { texto: String(s.texto_original).replace(/\s+/g, " ").trim(), grupo: g?.nombre || null, fecha: s.created_at };
    }
  }

  const conv = convRes.data && convRes.data[0];
  let mensajes: MensajeCorto[] = [];
  let ventanaHasta: string | null = null;
  if (conv) {
    const { data: msgs } = await admin
      .from("messages")
      .select("role, content, created_at")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: false })
      .limit(6);
    mensajes = ((msgs || []) as { role: "user" | "assistant"; content: string; created_at: string }[])
      .reverse()
      .map((m) => ({ role: m.role, content: m.content, createdAt: m.created_at }));
    const { data: ultimoEntrante } = await admin
      .from("messages")
      .select("created_at")
      .eq("conversation_id", conv.id)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(1);
    const u = ultimoEntrante && ultimoEntrante[0];
    if (u) {
      const fin = new Date(u.created_at).getTime() + VENTANA_MS;
      if (fin > Date.now()) ventanaHasta = new Date(fin).toISOString();
    }
  }

  const pendientes: string[] = ((preguntasRes.data || []) as { pregunta: string }[]).map((q) => `Pregunta sin responder: ${q.pregunta}`);
  if (lead.atencion_pendiente === "pide_asesor") pendientes.unshift("Pidió hablar con una persona y nadie le ha escrito.");
  if (sinCelularVisible) pendientes.push("No tenemos su celular: pídeselo para poder llamar.");

  const historial: DetalleCita["historial"] = [];
  if (pedido) historial.push({ fecha: pedido.fecha, texto: `Publicó su pedido${pedido.grupo ? ` en ${pedido.grupo}` : ""}` });
  if (cita.creada_at) historial.push({ fecha: cita.creada_at, texto: `Visita solicitada${ref ? ` a la Ref ${ref}` : ""}` });
  for (const h of (cita.historial || []) as { desde?: string; asesor_id?: string }[]) {
    if (h.desde && h.asesor_id) historial.push({ fecha: h.desde, texto: `Aviso a ${nombreDe.get(h.asesor_id)?.nombre || "una asesora"}` });
  }
  if (cita.confirmada_at) historial.push({ fecha: cita.confirmada_at, texto: `Confirmada por ${cita.confirmada_por || "el equipo"}` });
  if (lead.atencion_pendiente === "pide_asesor" && lead.atencion_desde) historial.push({ fecha: lead.atencion_desde, texto: "Pidió hablar con una persona" });
  historial.sort((a, b) => a.fecha.localeCompare(b.fecha));

  const asesora = cita.asesor_id ? nombreDe.get(cita.asesor_id) || null : null;
  const d = celularGuardado || (sinCelularVisible ? "" : String(lead.phone || "").replace(/\D/g, ""));
  return {
    leadId,
    conversationId: conv?.id || null,
    modo: conv?.modo === "humano" ? "humano" : "bot",
    estado: estadoDe(cita.estado),
    tipo: cita.tipo || "visita",
    fechaHora: cita.fecha_hora || null,
    corteAt: cita.corte_at || null,
    asesora,
    confirmadaPor: cita.confirmada_por || null,
    confirmadaAt: cita.confirmada_at || null,
    persona: {
      nombre: lead.nombre || colega?.nombre || (esColega ? "Colega sin nombre registrado" : "Cliente sin nombre registrado"),
      esColega,
      celular: d.length >= 8 ? celularLegible(d) : null,
      whatsapp: d.length >= 8 ? d : null,
      sinCelularVisible,
      grupos: Array.isArray(colega?.grupos) ? colega.grupos : [],
    },
    propiedad,
    refSinFicha: !propiedad && ref ? ref : null,
    pedido,
    pendientes,
    historial,
    mensajes,
    ventanaHasta,
  };
}
