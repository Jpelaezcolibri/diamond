import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Conversation, Message } from "@/lib/types";
import ChatView from "@/components/chat-view";

export const dynamic = "force-dynamic";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

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
