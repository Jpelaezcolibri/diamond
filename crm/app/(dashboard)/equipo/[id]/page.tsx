import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import type { Conversation, Message } from "@/lib/types";
import ChatView from "@/components/chat-view";

export const dynamic = "force-dynamic";

// Mismo visor que /inbox/[id] (ChatView no le importa si el lead es un
// cliente o un asesor) — solo cambia el guardia de admin y de donde se
// navega. Se duplica la página en vez de compartirla porque las dos rutas
// deben poder evolucionar por separado (ej. acciones propias de un lead que
// no tienen sentido acá, como "asignar dueño").
export default async function EquipoChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user)) redirect("/sofi");

  const { data: conv } = await supabase
    .from("conversations")
    .select("*, leads(*)")
    .eq("id", id)
    .single();
  if (!conv) notFound();

  const { data: messages } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })
    .limit(500);

  return (
    <ChatView
      conversation={conv as Conversation}
      initialMessages={(messages || []) as Message[]}
    />
  );
}
