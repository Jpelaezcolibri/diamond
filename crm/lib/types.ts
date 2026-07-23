export type Lead = {
  id: string;
  org_id: string;
  phone: string;
  nombre: string | null;
  presupuesto: string | null;
  zona_interes: string | null;
  tipo_interes: string | null;
  urgencia: string | null;
  forma_pago: string | null;
  categoria: "compra" | "alquiler" | "otros";
  score: number;
  estado: string;
  property_ref_origen: string | null;
  source: string;
  /** Referral de Meta (Click-to-WhatsApp Ads) del primer mensaje — null = lead organico. */
  ad_referral: { headline?: string; source_id?: string; source_url?: string; ctwa_clid?: string } | null;
  owner_id: string | null;
  owner_assigned_at: string | null;
  /** Registro de transferencia (migracion 2026-07-23_lead_transferencia).
   *  Opcionales: si la migracion no ha corrido, simplemente no llegan. */
  transferido_advisor_id?: string | null;
  transferido_a_nombre?: string | null;
  transferido_at?: string | null;
  /** Cierre del negocio (Sprint "Cero Leads Perdidos"): estado cerrado_ganado | cerrado_perdido. */
  closed_at?: string | null;
  valor_cierre?: number | null;
  motivo_perdida?: string | null;
  created_at: string;
  updated_at: string;
};

export type Conversation = {
  id: string;
  org_id: string;
  lead_id: string;
  estado: string;
  modo: "bot" | "humano";
  last_activity_at: string;
  created_at: string;
  leads: Lead;
};

// Propiedad de OTRA inmobiliaria que un colega/aliado comparte a la red — NO
// es inventario propio (ver ARCHITECTURE.md, tabla ally_properties). Sofi la
// captura sola; el asesor confirma disponibilidad desde /aliados antes de
// que se use para ofrecerla a un cliente.
export type AllyProperty = {
  id: string;
  org_id: string;
  ref: string | null;
  titulo: string | null;
  tipo: string | null;
  operacion: "Venta" | "Arriendo" | null;
  precio: string | null;
  zona: string | null;
  ciudad: string | null;
  descripcion: string | null;
  inmobiliaria_origen: string | null;
  contacto_nombre: string | null;
  contacto_telefono: string | null;
  lead_id: string | null;
  mensaje_original: string | null;
  estado: "pendiente" | "confirmada" | "no_disponible" | "expirada";
  /** Asesor (auth user) que registro la propiedad desde Sofi-Comando; null = flujo viejo (colega directo al bot). */
  registrado_por?: string | null;
  confirmada_por: string | null;
  confirmada_at: string | null;
  notas: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export const ALLY_ESTADOS = ["pendiente", "confirmada", "no_disponible", "expirada"] as const;

export const ALLY_ESTADO_LABELS: Record<string, string> = {
  pendiente: "Pendiente de revisión",
  confirmada: "Confirmada disponible",
  no_disponible: "Ya no disponible",
  expirada: "Expirada",
};

export const ALLY_ESTADO_COLORS: Record<string, string> = {
  pendiente: "bg-amber-100 text-amber-800",
  confirmada: "bg-emerald-100 text-emerald-700",
  no_disponible: "bg-red-100 text-red-700",
  expirada: "bg-slate-100 text-slate-500",
};

export type Message = {
  id: string;
  conversation_id: string;
  /** 'system' = nota de evento (ej. "Transferido a...") — se muestra centrada, no como burbuja. */
  role: "user" | "assistant" | "system";
  content: string;
  type?: "text" | "image" | "audio" | "document" | "video" | null;
  media_url?: string | null;
  media_mime?: string | null;
  wa_message_id?: string | null;
  reply_to_id?: string | null;
  created_at: string;
};

export const ESTADOS = [
  "nuevo",
  "en_conversacion",
  "calificado",
  "transferido",
  "cerrado_ganado",
  "cerrado_perdido",
  "descartado",
] as const;

export const ESTADO_LABELS: Record<string, string> = {
  nuevo: "Nuevo",
  en_conversacion: "En conversación",
  calificado: "Calificado",
  transferido: "Transferido",
  cerrado_ganado: "Ganado 🏆",
  cerrado_perdido: "Perdido",
  descartado: "Descartado",
};

export const ESTADO_COLORS: Record<string, string> = {
  nuevo: "bg-slate-100 text-slate-700",
  en_conversacion: "bg-blue-100 text-blue-700",
  calificado: "bg-amber-100 text-amber-800",
  transferido: "bg-green-100 text-green-700",
  cerrado_ganado: "bg-emerald-100 text-emerald-800",
  cerrado_perdido: "bg-zinc-200 text-zinc-600",
  descartado: "bg-red-100 text-red-700",
};

export const CATEGORIAS = [
  { key: "compra", label: "🏠 Compra" },
  { key: "alquiler", label: "🔑 Alquiler" },
  { key: "otros", label: "📦 Otros" },
] as const;

export const ESTADO_DOT: Record<string, string> = {
  nuevo: "bg-slate-400",
  en_conversacion: "bg-blue-500",
  calificado: "bg-amber-500",
  transferido: "bg-emerald-500",
  cerrado_ganado: "bg-emerald-600",
  cerrado_perdido: "bg-zinc-400",
  descartado: "bg-red-400",
};

export const ESTADO_COLUMN_THEME: Record<string, { header: string; bg: string; border: string }> = {
  nuevo: { header: "text-slate-600", bg: "bg-slate-100/60", border: "border-t-slate-400" },
  en_conversacion: { header: "text-blue-700", bg: "bg-blue-50/60", border: "border-t-blue-400" },
  calificado: { header: "text-amber-700", bg: "bg-amber-50/60", border: "border-t-amber-400" },
  transferido: { header: "text-emerald-700", bg: "bg-emerald-50/60", border: "border-t-emerald-400" },
  cerrado_ganado: { header: "text-emerald-800", bg: "bg-emerald-100/60", border: "border-t-emerald-600" },
  cerrado_perdido: { header: "text-zinc-600", bg: "bg-zinc-100/60", border: "border-t-zinc-400" },
  descartado: { header: "text-red-700", bg: "bg-red-50/60", border: "border-t-red-300" },
};

// Temperatura del lead segun score — patron estandar de CRMs inmobiliarios (hot/warm/cold)
export function scoreTemperature(score: number) {
  if (score >= 70) return { label: "Caliente", emoji: "🔥", color: "text-red-700", bg: "bg-red-50", border: "border-l-red-400" };
  if (score >= 40) return { label: "Tibio", emoji: "🌤️", color: "text-amber-700", bg: "bg-amber-50", border: "border-l-amber-400" };
  return { label: "Frío", emoji: "❄️", color: "text-sky-700", bg: "bg-sky-50", border: "border-l-sky-300" };
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr} h`;
  const days = Math.floor(hr / 24);
  return `hace ${days} d`;
}

export function absoluteDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-CO", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function dayLabel(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
    if (diffDays === 0) return "Hoy";
    if (diffDays === 1) return "Ayer";
    return d.toLocaleDateString("es-CO", {
      day: "numeric",
      month: "long",
      ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {}),
    });
  } catch {
    return "";
  }
}
