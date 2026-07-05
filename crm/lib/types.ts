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
  owner_id: string | null;
  owner_assigned_at: string | null;
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

export type Message = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  type?: "text" | "image" | "audio" | "document" | "video" | null;
  media_url?: string | null;
  media_mime?: string | null;
  wa_message_id?: string | null;
  reply_to_id?: string | null;
  created_at: string;
};

export const ESTADOS = ["nuevo", "en_conversacion", "calificado", "transferido", "descartado"] as const;

export const ESTADO_LABELS: Record<string, string> = {
  nuevo: "Nuevo",
  en_conversacion: "En conversación",
  calificado: "Calificado",
  transferido: "Transferido",
  descartado: "Descartado",
};

export const ESTADO_COLORS: Record<string, string> = {
  nuevo: "bg-slate-100 text-slate-700",
  en_conversacion: "bg-blue-100 text-blue-700",
  calificado: "bg-amber-100 text-amber-800",
  transferido: "bg-green-100 text-green-700",
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
  descartado: "bg-red-400",
};

export const ESTADO_COLUMN_THEME: Record<string, { header: string; bg: string; border: string }> = {
  nuevo: { header: "text-slate-600", bg: "bg-slate-100/60", border: "border-t-slate-400" },
  en_conversacion: { header: "text-blue-700", bg: "bg-blue-50/60", border: "border-t-blue-400" },
  calificado: { header: "text-amber-700", bg: "bg-amber-50/60", border: "border-t-amber-400" },
  transferido: { header: "text-emerald-700", bg: "bg-emerald-50/60", border: "border-t-emerald-400" },
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
