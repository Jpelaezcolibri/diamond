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
  score: number;
  estado: string;
  property_ref_origen: string | null;
  source: string;
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
  created_at: string;
};

export const ESTADO_COLORS: Record<string, string> = {
  nuevo: "bg-slate-100 text-slate-700",
  en_conversacion: "bg-blue-100 text-blue-700",
  calificado: "bg-amber-100 text-amber-800",
  transferido: "bg-green-100 text-green-700",
  descartado: "bg-red-100 text-red-700",
};
