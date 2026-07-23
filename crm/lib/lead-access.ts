import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/auth";

type AdminClient = ReturnType<typeof createAdminClient>;

export async function leadIdForConversation(admin: AdminClient, conversationId: string): Promise<string | null> {
  const { data } = await admin.from("conversations").select("lead_id").eq("id", conversationId).maybeSingle();
  return data?.lead_id ?? null;
}

// Bloquea con 403/404 si el usuario no puede actuar sobre este lead (no es el
// owner ni admin). Usar antes de cualquier accion que "atienda" al cliente:
// enviar mensaje, cambiar modo bot/humano, etc. Solo lectura — no reclama
// ownership (ver claim/estado routes para el update atomico que sí lo hace).
// Atender un cliente reclama su ownership: si el lead esta libre, queda bajo
// el asesor que lo esta atendiendo (tomar control del chat o escribirle).
// Los admins triagean sin auto-asignarse, igual que en el kanban. El update es
// condicional y atomico (`owner_id is null`) para que dos asesores simultaneos
// no se pisen; si ya tiene dueno, no hace nada.
export async function claimLeadIfFree(admin: AdminClient, user: User, leadId: string): Promise<void> {
  if (isAdmin(user)) return;
  const now = new Date().toISOString();
  await admin
    .from("leads")
    .update({ owner_id: user.id, owner_assigned_at: now, updated_at: now })
    .eq("id", leadId)
    .is("owner_id", null);
}

export async function assertOwnsLead(admin: AdminClient, user: User, leadId: string): Promise<NextResponse | null> {
  const { data: lead, error } = await admin.from("leads").select("owner_id").eq("id", leadId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!lead) return NextResponse.json({ error: "Lead no encontrado" }, { status: 404 });
  if (lead.owner_id && lead.owner_id !== user.id && !isAdmin(user)) {
    return NextResponse.json({ error: "Este lead ya está siendo atendido por otro asesor" }, { status: 403 });
  }
  return null;
}
