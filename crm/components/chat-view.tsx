"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ESTADO_COLORS, ESTADO_LABELS, absoluteDateTime, dayLabel, type Conversation, type Message } from "@/lib/types";

function hora(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function DaySeparator({ label }: { label: string }) {
  return (
    <div className="my-2 flex justify-center">
      <span className="rounded-lg bg-white/90 px-3 py-1 text-[11px] font-medium text-slate-500 shadow-sm">
        {label}
      </span>
    </div>
  );
}

function MediaContent({ m }: { m: Message }) {
  if (m.type === "image" && m.media_url) {
    return (
      <a href={m.media_url} target="_blank" rel="noreferrer">
        <img src={m.media_url} alt="imagen" className="mb-1 max-h-64 rounded-lg object-cover" />
      </a>
    );
  }
  if (m.type === "audio" && m.media_url) {
    return <audio controls src={m.media_url} className="mb-1 h-10 w-56 max-w-full" />;
  }
  if ((m.type === "document" || m.type === "video") && m.media_url) {
    return (
      <a href={m.media_url} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-sm underline">
        📎 Abrir archivo
      </a>
    );
  }
  return null;
}

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
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`messages-${conversation.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversation.id}` },
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
      body: JSON.stringify({ conversationId: conversation.id, text: text.trim(), replyToId: replyTo?.id || null }),
    });
    if (res.ok) {
      setText("");
      setReplyTo(null);
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "No se pudo enviar");
    }
    setSending(false);
  }

  async function sendFile(file: File | Blob, filename: string) {
    setSending(true);
    setError(null);
    const form = new FormData();
    form.append("conversationId", conversation.id);
    form.append("file", file, filename);
    form.append("filename", filename);
    if (replyTo) form.append("replyToId", replyTo.id);
    const res = await fetch("/api/media", { method: "POST", body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "No se pudo enviar el archivo");
    } else {
      setReplyTo(null);
    }
    setSending(false);
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime =
        ["audio/ogg;codecs=opus", "audio/mp4", "audio/webm;codecs=opus"].find((t) =>
          MediaRecorder.isTypeSupported(t)
        ) || "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = rec.mimeType || "audio/webm";
        const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm";
        const blob = new Blob(chunksRef.current, { type });
        void sendFile(blob, `nota-de-voz.${ext}`);
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setError("No se pudo acceder al micrófono");
    }
  }

  function stopRecording(cancel = false) {
    const rec = recorderRef.current;
    if (!rec) return;
    if (cancel) rec.onstop = null;
    rec.stop();
    if (cancel) rec.stream?.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
    setRecording(false);
  }

  const lead = conversation.leads;
  const canWrite = modo === "humano" && !sending;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-[#f0f2f5] px-3 py-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Link href="/inbox" className="shrink-0 text-slate-500 hover:text-slate-800">←</Link>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 font-semibold text-white sm:h-10 sm:w-10">
            {(lead?.nombre || lead?.phone || "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <span className="truncate">{lead?.nombre || `+${lead?.phone}`}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${ESTADO_COLORS[lead?.estado] || "bg-slate-100"}`}>
                {ESTADO_LABELS[lead?.estado] || lead?.estado} · {lead?.score}
              </span>
            </p>
            <p className="truncate text-xs text-slate-500">
              {modo === "bot" ? "🤖 Sofi atendiendo" : "🙋 Asesor al mando"}
              {lead?.property_ref_origen ? ` · ${lead.property_ref_origen}` : ""}
            </p>
            {lead?.transferido_a_nombre && (
              <p className="truncate text-[11px] text-emerald-700" title={lead.transferido_at ? absoluteDateTime(lead.transferido_at) : undefined}>
                ➜ Transferido a {lead.transferido_a_nombre}
                {lead.transferido_at ? ` · ${absoluteDateTime(lead.transferido_at)}` : ""}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={toggleModo}
          className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium text-white ${
            modo === "bot" ? "bg-purple-600 hover:bg-purple-700" : "bg-emerald-600 hover:bg-emerald-700"
          }`}
        >
          {modo === "bot" ? "🙋 Tomar control" : "🤖 Devolver a Sofi"}
        </button>
      </div>

      {/* Mensajes — lienzo estilo WhatsApp */}
      <div className="flex-1 space-y-1 overflow-y-auto bg-[#efeae2] p-4" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, rgba(0,0,0,0.04) 1px, transparent 0)", backgroundSize: "18px 18px" }}>
        {messages.map((m, i) => {
          const mine = m.role === "assistant";
          const quoted = m.reply_to_id ? byId.get(m.reply_to_id) : null;
          const prev = messages[i - 1];
          const showDaySeparator =
            !prev || new Date(m.created_at).toDateString() !== new Date(prev.created_at).toDateString();
          // Nota de evento (ej. "Transferido a...") — centrada, sin burbuja.
          if (m.role === "system") {
            return (
              <div key={m.id}>
                {showDaySeparator && <DaySeparator label={dayLabel(m.created_at)} />}
                <div className="my-2 flex justify-center">
                  <span
                    title={absoluteDateTime(m.created_at)}
                    className="rounded-lg bg-amber-50 px-3 py-1 text-center text-[11px] font-medium text-amber-800 shadow-sm ring-1 ring-amber-200"
                  >
                    {m.content}
                  </span>
                </div>
              </div>
            );
          }
          return (
            <div key={m.id}>
              {showDaySeparator && <DaySeparator label={dayLabel(m.created_at)} />}
              <div className={`group flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`relative max-w-[78%] rounded-lg px-2.5 py-1.5 text-sm shadow-sm ${
                    mine ? "rounded-tr-none bg-[#d9fdd3]" : "rounded-tl-none bg-white"
                  }`}
                >
                  {quoted && (
                    <div className="mb-1 rounded border-l-4 border-emerald-500 bg-black/5 px-2 py-1 text-xs text-slate-600">
                      <span className="font-semibold">{quoted.role === "user" ? lead?.nombre || "Cliente" : "Diamond"}: </span>
                      {(quoted.content || "").slice(0, 90)}
                    </div>
                  )}
                  <MediaContent m={m} />
                  {m.content && !(m.type && m.type !== "text" && m.content.startsWith("[")) && (
                    <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  )}
                  <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-slate-400">
                    <span title={absoluteDateTime(m.created_at)}>{hora(m.created_at)}</span>
                    {mine && <span className="text-sky-500">✓✓</span>}
                  </div>
                  <button
                    onClick={() => setReplyTo(m)}
                    title="Responder"
                    className="absolute -top-2 right-1 hidden rounded-full border border-slate-200 bg-white px-1.5 text-xs shadow group-hover:block"
                  >
                    ↩
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Cita activa */}
      {replyTo && (
        <div className="flex items-center justify-between border-t border-slate-200 bg-[#f0f2f5] px-4 py-2 text-xs">
          <div className="rounded border-l-4 border-emerald-500 bg-white px-2 py-1">
            Respondiendo a: <span className="text-slate-600">{(replyTo.content || "[archivo]").slice(0, 80)}</span>
          </div>
          <button onClick={() => setReplyTo(null)} className="ml-2 text-slate-500 hover:text-slate-800">✕</button>
        </div>
      )}

      {/* Composer */}
      <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-slate-200 bg-[#f0f2f5] px-3 py-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,audio/*,application/pdf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void sendFile(f, f.name);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={!canWrite}
          onClick={() => fileRef.current?.click()}
          title="Adjuntar imagen, audio o PDF"
          className="rounded-full p-2 text-xl text-slate-500 hover:bg-slate-200 disabled:opacity-40"
        >
          📎
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={modo === "bot" ? "Toma el control para escribir tú..." : "Escribe un mensaje"}
          disabled={!canWrite || recording}
          className="flex-1 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm outline-none focus:border-emerald-500 disabled:bg-slate-100"
        />
        {text.trim() ? (
          <button
            type="submit"
            disabled={!canWrite}
            className="rounded-full bg-emerald-600 p-2 px-4 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            ➤
          </button>
        ) : recording ? (
          <span className="flex items-center gap-1">
            <button type="button" onClick={() => stopRecording(true)} title="Cancelar" className="rounded-full p-2 text-xl hover:bg-slate-200">🗑</button>
            <button type="button" onClick={() => stopRecording(false)} title="Enviar nota de voz" className="animate-pulse rounded-full bg-red-500 p-2 px-4 text-white">■ Enviar</button>
          </span>
        ) : (
          <button
            type="button"
            disabled={!canWrite}
            onClick={startRecording}
            title="Grabar nota de voz"
            className="rounded-full p-2 text-xl text-slate-500 hover:bg-slate-200 disabled:opacity-40"
          >
            🎤
          </button>
        )}
      </form>
      {error && <p className="bg-[#f0f2f5] px-4 pb-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
