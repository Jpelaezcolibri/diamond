"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

export type Sesion = {
  id: string;
  nombre: string;
  estado: string;
  advisor_id: string | null;
  escucha_desde: string | null;
  ultima_senal_at: string | null;
};

export type Asesor = { id: string; name: string; phone: string | null };

type Estado = { status: string | null; qr: string | null; error: string | null };

// Un botón gris sin explicación manda a revisar el lugar equivocado. Cada
// estado de WAHA tiene un motivo distinto y una espera distinta.
function motivoImportarDeshabilitado(nombre: string, status: string | null | undefined) {
  if (!nombre) return "Elegí o creá una línea primero";
  switch (status) {
    case "WORKING": return null;
    case "STARTING": return "La sesión está arrancando. Se habilita sola en unos segundos.";
    case "SCAN_QR_CODE": return "Falta que el asesor escanee el QR.";
    case "STOPPED": return "La sesión está detenida. Tocá «Vincular línea» para levantarla.";
    case "FAILED": return "La sesión falló. Revisá los logs de WAHA.";
    case null: case undefined: return "Consultando el estado de la sesión…";
    default: return `La sesión está en ${status}; hay que esperar a WORKING.`;
  }
}

async function llamar(accion: string, nombre: string, advisorId?: string | null) {
  const res = await fetch("/api/grupos/sesion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accion, nombre, advisorId: advisorId || null }),
  }).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) : {};
  if (!res || !res.ok) throw new Error(body.error || "El bot no respondió");
  return body;
}

export default function VincularLinea({ sesiones, asesores }: { sesiones: Sesion[]; asesores: Asesor[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [nombre, setNombre] = useState(sesiones[0]?.nombre || "");
  const [advisorId, setAdvisorId] = useState(sesiones[0]?.advisor_id || "");
  const [estado, setEstado] = useState<Estado | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cambiar de línea o empezar una nueva. El estado anterior se limpia: dejarlo
  // mostraría el QR de una sesión mientras se ve el nombre de otra.
  function seleccionar(s: Sesion | null) {
    setNombre(s?.nombre || "");
    setAdvisorId(s?.advisor_id || "");
    setEstado(null);
    setError(null);
    setAviso(null);
  }

  // El QR caduca en segundos, así que mientras se espera el escaneo hay que
  // pedirlo seguido. En cualquier otro estado, no: WAHA puede estar peleando
  // por reconectar contra WhatsApp, y consultarlo cada 5 segundos indefinidamente
  // le suma carga justo cuando menos le sirve.
  useEffect(() => {
    if (!nombre || estado?.status === "WORKING") {
      if (poll.current) clearInterval(poll.current);
      return;
    }

    const rapido = estado?.status === "SCAN_QR_CODE" || estado === null;
    const cada = rapido ? 5000 : 20000;
    let intentos = 0;

    const tick = async () => {
      // Tope de ~5 minutos: si en ese rato no se resolvió, no lo va a resolver
      // el siguiente sondeo. Se corta y se avisa, en vez de martillar para
      // siempre con la pestaña abierta y olvidada.
      if (++intentos > (rapido ? 60 : 15)) {
        if (poll.current) clearInterval(poll.current);
        setEstado((e) => (e ? { ...e, error: "Dejé de consultar. Recargá la página para volver a intentar." } : e));
        return;
      }
      try {
        const r = await llamar("estado", nombre);
        setEstado({ status: r.status, qr: r.qr, error: r.error });
        if (r.status === "WORKING") startTransition(() => router.refresh());
      } catch {
        /* transitorio: el siguiente tick reintenta */
      }
    };

    tick();
    poll.current = setInterval(tick, cada);
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
  }, [nombre, estado?.status, router]);

  async function accion(a: "crear" | "importar") {
    setOcupado(a);
    setError(null);
    setAviso(null);
    try {
      const r = await llamar(a, nombre, advisorId);
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

  const nombreDeAsesor = (id: string | null) => asesores.find((a) => a.id === id)?.name || null;
  const esNueva = !sesion;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      {sesiones.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-medium text-slate-600">
            Líneas vinculadas ({sesiones.length})
            {/* Leer no suma riesgo, así que la escucha escala sumando asesores:
                cada uno aporta los grupos en los que ya está. */}
          </p>
          <div className="flex flex-wrap gap-2">
            {sesiones.map((s) => {
              const activa = s.nombre === nombre;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => seleccionar(s)}
                  className={[
                    "rounded-md border px-3 py-2 text-left text-sm transition",
                    activa ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 hover:bg-slate-50",
                  ].join(" ")}
                >
                  <span className="block font-medium">{s.nombre}</span>
                  <span className={activa ? "block text-xs text-slate-300" : "block text-xs text-slate-500"}>
                    {nombreDeAsesor(s.advisor_id) || "sin asesor"}
                    {s.estado === "activa" ? " · activa" : ""}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => seleccionar(null)}
              className={[
                "rounded-md border border-dashed px-3 py-2 text-sm transition",
                esNueva ? "border-slate-900 text-slate-900" : "border-slate-300 text-slate-500 hover:bg-slate-50",
              ].join(" ")}
            >
              + Vincular otra línea
            </button>
          </div>
        </div>
      )}

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
        <label className="flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">Asesor dueño de la línea</span>
          <select
            value={advisorId}
            onChange={(e) => setAdvisorId(e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
          >
            <option value="">Elegí un asesor…</option>
            {asesores.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => accion("crear")}
          disabled={!nombre || !advisorId || ocupado !== null}
          title={advisorId ? "" : "Elegí a quién pertenece la línea"}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {ocupado === "crear" ? "Creando…" : "Vincular línea"}
        </button>
        <button
          type="button"
          onClick={() => accion("importar")}
          disabled={!nombre || !vinculada || ocupado !== null}
          title={motivoImportarDeshabilitado(nombre, estado?.status) || ""}
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
            {sesion && !sesion.advisor_id && (
              <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Esta sesión no tiene asesor asignado. Sin eso, cuando un colega pida algo que
                tenemos <strong>no hay a quién avisarle</strong>. Elegí el asesor arriba y volvé a
                tocar <strong>Vincular línea</strong> — no se desvincula nada, sólo lo asocia.
              </p>
            )}
            {vinculada ? (
              <p className="mt-2 text-xs text-slate-500">
                Ya podés importar los grupos. Entran todos apagados: prendé de a uno abajo.
              </p>
            ) : (
              <p className="mt-2 text-xs text-slate-500">{motivoImportarDeshabilitado(nombre, estado.status)}</p>
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
