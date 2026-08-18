"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { absoluteDateTime, dayLabel } from "@/lib/types";
import { hora } from "@/lib/fecha";

export type CommandMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

// Mismo separador de dia que chat-view.tsx ("Hoy", "Ayer", "14 de julio").
function DaySeparator({ label }: { label: string }) {
  return (
    <div className="my-2 flex justify-center">
      <span className="rounded-lg bg-white/90 px-3 py-1 text-[11px] font-medium text-slate-500 shadow-sm">
        {label}
      </span>
    </div>
  );
}

// Chat del Centro de Comando (SOFI). Espeja el patron de chat-view.tsx pero sin
// toggle bot/humano ni media. SI tiene Realtime (agregado 2026-08-18): el feed
// del radar (src/groups/feed-comando.js) le escribe mensajes al admin desde un
// proceso de fondo — sin esto, esos mensajes solo aparecerian recargando la
// pagina, y el feed dejaria de sentirse "en vivo". El asesor (user) va a la
// derecha; SOFI (assistant) a la izquierda.
export default function SofiCommandChat({
  sessionId,
  initialMessages,
  initialHasMore = false,
  initialError,
}: {
  sessionId: string | null;
  initialMessages: CommandMessage[];
  initialHasMore?: boolean;
  initialError: string | null;
}) {
  const [messages, setMessages] = useState<CommandMessage[]>(initialMessages);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Distingue "llego un mensaje nuevo" (autoscroll abajo) de "cargue historial
  // viejo" (mantener la posicion) — sin esto, paginar te patea al fondo.
  const prependingRef = useRef(false);

  useEffect(() => {
    if (prependingRef.current) {
      prependingRef.current = false;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Escucha mensajes nuevos de la sesion ABIERTA (la que ensureSession
  // retoma tanto para esta pestaña como para el feed del radar de fondo).
  //
  // handleSend ya agrega su propio turno de forma optimista (id "local-...",
  // ver append() mas abajo) para que la respuesta de Sofi se sienta
  // instantanea — no espera a Realtime. Sin el chequeo de abajo, ESE mismo
  // mensaje volveria a aparecer duplicado cuando el INSERT real le llegue por
  // este canal unos milisegundos despues. Si encuentra el placeholder local
  // que originó ese mensaje (mismo rol + contenido), lo reemplaza por la fila
  // real en vez de agregarlo de nuevo; si no hay placeholder — el caso del
  // feed del radar, que nadie tecleo en esta pestaña — lo agrega como nuevo.
  useEffect(() => {
    if (!sessionId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`command-messages-${sessionId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "command_messages", filter: `session_id=eq.${sessionId}` },
        (payload) => {
          const msg = payload.new as CommandMessage;
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            const idx = prev.findIndex((m) => m.id.startsWith("local-") && m.role === msg.role && m.content === msg.content);
            if (idx === -1) return [...prev, msg];
            const copia = [...prev];
            copia[idx] = msg;
            return copia;
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId]);

  // Scroll-up al tope: trae la pagina anterior del historial (tipo WhatsApp).
  async function loadOlder() {
    if (loadingOlder || !hasMore || messages.length === 0) return;
    setLoadingOlder(true);
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight || 0;
    const res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "history", before: messages[0].created_at }),
    }).catch(() => null);
    if (res && res.ok) {
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data.messages) && data.messages.length > 0) {
        prependingRef.current = true;
        setMessages((prev) => [...data.messages, ...prev]);
        // Mantiene a la vista el mensaje donde estaba el usuario.
        requestAnimationFrame(() => {
          if (el) el.scrollTop = el.scrollHeight - prevHeight;
        });
      }
      setHasMore(Boolean(data.hasMore));
    }
    setLoadingOlder(false);
  }

  function handleScroll() {
    const el = scrollRef.current;
    if (el && el.scrollTop < 40) void loadOlder();
  }

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
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 space-y-1 overflow-y-auto bg-[#efeae2] p-4" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, rgba(0,0,0,0.04) 1px, transparent 0)", backgroundSize: "18px 18px" }}>
        {loadingOlder && (
          <p className="py-1 text-center text-xs text-slate-400">Cargando historial…</p>
        )}
        {!loadingOlder && hasMore && messages.length > 0 && (
          <button onClick={() => void loadOlder()} className="mx-auto block rounded-lg bg-white/90 px-3 py-1 text-[11px] font-medium text-slate-500 shadow-sm hover:text-slate-700">
            Cargar mensajes anteriores
          </button>
        )}
        {messages.length === 0 && !error && (
          <p className="mt-8 text-center text-sm text-slate-500">SOFI está preparando tu día…</p>
        )}
        {messages.map((m, i) => {
          const mine = m.role === "user";
          const prev = messages[i - 1];
          const showDaySeparator =
            !prev || new Date(m.created_at).toDateString() !== new Date(prev.created_at).toDateString();
          return (
            <div key={m.id}>
              {showDaySeparator && <DaySeparator label={dayLabel(m.created_at)} />}
              <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`relative max-w-[78%] rounded-lg px-3 py-2 text-sm shadow-sm ${
                    mine ? "rounded-tr-none bg-[#d9fdd3]" : "rounded-tl-none bg-white"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-slate-400">
                    <span title={absoluteDateTime(m.created_at)}>{hora(m.created_at)}</span>
                  </div>
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
