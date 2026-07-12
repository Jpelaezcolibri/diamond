"use client";

import { useEffect, useRef, useState } from "react";

export type CommandMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

function hora(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

// Chat del Centro de Comando (SOFI). Espeja el patron de chat-view.tsx pero sin
// toggle bot/humano, sin media y sin Realtime: la respuesta llega sincrona en el
// POST. El asesor (user) va a la derecha; SOFI (assistant) a la izquierda.
export default function SofiCommandChat({
  sessionId,
  initialMessages,
  initialError,
}: {
  sessionId: string | null;
  initialMessages: CommandMessage[];
  initialError: string | null;
}) {
  const [messages, setMessages] = useState<CommandMessage[]>(initialMessages);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function append(role: "user" | "assistant", content: string) {
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role, content, created_at: new Date().toISOString() },
    ]);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value || sending || !sessionId) return;
    setSending(true);
    setError(null);
    append("user", value);
    setText("");

    const res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "message", sessionId, text: value }),
    }).catch(() => null);

    if (res && res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.reply) append("assistant", data.reply);
    } else {
      const body = res ? await res.json().catch(() => ({})) : {};
      setError(body.error || "SOFI no respondió (¿el bot está en línea?)");
    }
    setSending(false);
  }

  async function handleClose() {
    if (closing || !sessionId) return;
    setClosing(true);
    setError(null);
    const res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "close", sessionId }),
    }).catch(() => null);

    if (res && res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.summary) append("assistant", data.summary);
    } else {
      const body = res ? await res.json().catch(() => ({})) : {};
      setError(body.error || "No se pudo cerrar el día");
    }
    setClosing(false);
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-[#f0f2f5] px-3 py-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#c9a24b] font-semibold text-white sm:h-10 sm:w-10">S</div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">SOFI · Centro de Comando</p>
            <p className="truncate text-xs text-slate-500">Tu copiloto del día</p>
          </div>
        </div>
        <button
          onClick={handleClose}
          disabled={closing || !sessionId}
          className="shrink-0 whitespace-nowrap rounded-lg bg-slate-700 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40"
        >
          {closing ? "Cerrando…" : "Cerrar el día"}
        </button>
      </div>

      {/* Mensajes */}
      <div className="flex-1 space-y-1 overflow-y-auto bg-[#efeae2] p-4" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, rgba(0,0,0,0.04) 1px, transparent 0)", backgroundSize: "18px 18px" }}>
        {messages.length === 0 && !error && (
          <p className="mt-8 text-center text-sm text-slate-500">SOFI está preparando tu día…</p>
        )}
        {messages.map((m) => {
          const mine = m.role === "user";
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`relative max-w-[78%] rounded-lg px-3 py-2 text-sm shadow-sm ${
                  mine ? "rounded-tr-none bg-[#d9fdd3]" : "rounded-tl-none bg-white"
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{m.content}</p>
                <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-slate-400">
                  {hora(m.created_at)}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-slate-200 bg-[#f0f2f5] px-3 py-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={sessionId ? "Pregúntale a SOFI…" : "SOFI no está disponible"}
          disabled={sending || !sessionId}
          className="flex-1 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm outline-none focus:border-[#c9a24b] disabled:bg-slate-100"
        />
        <button
          type="submit"
          disabled={sending || !sessionId || !text.trim()}
          className="rounded-full bg-[#c9a24b] p-2 px-4 text-sm font-medium text-white hover:bg-[#b8923f] disabled:opacity-40"
        >
          ➤
        </button>
      </form>
      {error && <p className="bg-[#f0f2f5] px-4 pb-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
