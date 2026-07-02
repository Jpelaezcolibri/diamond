"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ESTADO_COLORS, type Conversation, type Message } from "@/lib/types";

export default function ChatView({
  conversation,
  initialMessages,
}: {
  conversation: Conversation;
  initialMessages: Message[];
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [modo, setModo] = useState<"bot" | "humano">(conversation.modo);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`messages-${conversation.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload) => {
          const msg = payload.new as Message;
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversation.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function toggleModo() {
    const next = modo === "bot" ? "humano" : "bot";
    setError(null);
    const res = await fetch("/api/modo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: conversation.id, modo: next }),
    });
    if (res.ok) setModo(next);
    else setError("No se pudo cambiar el modo (¿el bot está en línea?)");
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: conversation.id, text: text.trim() }),
    });
    if (res.ok) {
      setText("");
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "No se pudo enviar (¿el bot está en línea?)");
    }
    setSending(false);
  }

  const lead = conversation.leads;

  return (
    <div className="mx-auto flex h-[calc(100vh-57px)] max-w-3xl flex-col p-4">
      <div className="mb-3 flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <Link href="/inbox" className="text-xs text-slate-400 hover:text-slate-600">
            ← Inbox
          </Link>
          <p className="font-semibold">
            {lead?.nombre || `+${lead?.phone}`}{" "}
            <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${ESTADO_COLORS[lead?.estado] || "bg-slate-100"}`}>
              {lead?.estado} · {lead?.score}
            </span>
          </p>
          <p className="text-xs text-slate-500">
            {[lead?.property_ref_origen && `Propiedad ${lead.property_ref_origen}`, lead?.forma_pago, lead?.urgencia]
              .filter(Boolean)
              .join(" · ") || "Sin datos de calificación aún"}
          </p>
        </div>
        <button
          onClick={toggleModo}
          className={`rounded-lg px-3 py-2 text-xs font-medium ${
            modo === "bot"
              ? "bg-purple-600 text-white hover:bg-purple-700"
              : "bg-emerald-600 text-white hover:bg-emerald-700"
          }`}
        >
          {modo === "bot" ? "🙋 Tomar control" : "🤖 Devolver a Sofi"}
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
            <div
              className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                m.role === "user" ? "bg-slate-100 text-slate-900" : "bg-emerald-600 text-white"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="mt-3 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            modo === "bot" ? "Toma el control para escribir tú..." : "Escribe como asesor..."
          }
          disabled={modo === "bot" || sending}
          className="flex-1 rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none focus:border-slate-500 disabled:bg-slate-100"
        />
        <button
          type="submit"
          disabled={modo === "bot" || sending || !text.trim()}
          className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
        >
          {sending ? "..." : "Enviar"}
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
