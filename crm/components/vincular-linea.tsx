"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

export type Sesion = {
  id: string;
  nombre: string;
  estado: string;
  escucha_desde: string | null;
  ultima_senal_at: string | null;
};

type Estado = { status: string | null; qr: string | null; error: string | null };

async function llamar(accion: string, nombre: string) {
  const res = await fetch("/api/grupos/sesion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accion, nombre }),
  }).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) : {};
  if (!res || !res.ok) throw new Error(body.error || "El bot no respondió");
  return body;
}

export default function VincularLinea({ sesiones }: { sesiones: Sesion[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [nombre, setNombre] = useState(sesiones[0]?.nombre || "");
  const [estado, setEstado] = useState<Estado | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  // El QR caduca en segundos y WAHA lo refresca solo: hay que volver a
  // pedirlo, no cachearlo. Se deja de sondear apenas queda vinculada.
  useEffect(() => {
    if (!nombre || estado?.status === "WORKING") {
      if (poll.current) clearInterval(poll.current);
      return;
    }
    const tick = async () => {
      try {
        const r = await llamar("estado", nombre);
        setEstado({ status: r.status, qr: r.qr, error: r.error });
        if (r.status === "WORKING") startTransition(() => router.refresh());
      } catch {
        /* transitorio: el siguiente tick reintenta */
      }
    };
    tick();
    poll.current = setInterval(tick, 5000);
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
  }, [nombre, estado?.status, router]);

  async function accion(a: "crear" | "importar") {
    setOcupado(a);
    setError(null);
    setAviso(null);
    try {
      const r = await llamar(a, nombre);
      if (a === "importar") setAviso(`${r.nuevos} grupo(s) nuevo(s) de ${r.total}. Todos entran apagados.`);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falló");
    } finally {
      setOcupado(null);
    }
  }

  const vinculada = estado?.status === "WORKING";
  const sesion = sesiones.find((s) => s.nombre === nombre);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">Nombre de la sesión</span>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
            placeholder="asesor-andres"
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => accion("crear")}
          disabled={!nombre || ocupado !== null}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {ocupado === "crear" ? "Creando…" : "Vincular línea"}
        </button>
        <button
          type="button"
          onClick={() => accion("importar")}
          disabled={!nombre || !vinculada || ocupado !== null}
          title={vinculada ? "" : "Primero hay que vincular la línea"}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-40"
        >
          {ocupado === "importar" ? "Importando…" : "Importar grupos"}
        </button>
      </div>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {aviso && <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{aviso}</p>}

      {estado?.status && (
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="flex-1 text-sm">
            <p>
              Estado:{" "}
              <span className={vinculada ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>
                {estado.status}
              </span>
            </p>
            {sesion?.escucha_desde && (
              <p className="mt-1 text-xs text-slate-500">
                Escucha desde el{" "}
                {new Date(sesion.escucha_desde).toLocaleString("es-CO", { dateStyle: "long", timeStyle: "short" })}.
                Nada anterior a ese momento se procesa, aunque WhatsApp lo sincronice.
              </p>
            )}
            {estado.error && <p className="mt-1 text-xs text-red-600">{estado.error}</p>}
            {vinculada && (
              <p className="mt-2 text-xs text-slate-500">
                Ya podés importar los grupos. Entran todos apagados: prendé de a uno abajo.
              </p>
            )}
          </div>

          {estado.qr && (
            <div className="shrink-0 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:image/png;base64,${estado.qr}`}
                alt="Código QR para vincular la línea"
                className="h-52 w-52 rounded-md border border-slate-200 bg-white"
              />
              <p className="mt-2 max-w-52 text-xs text-slate-500">
                En el teléfono del asesor: <strong>⋮ → Dispositivos vinculados → Vincular un dispositivo</strong>.
                Caduca en segundos y se renueva solo.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
