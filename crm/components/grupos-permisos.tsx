"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type GrupoVivo = {
  id: string;
  jid: string;
  nombre: string | null;
  modo: string;
  responde: boolean;
};

// Dos permisos, no uno. Escuchar un grupo y dejar que el bot hable en él son
// decisiones de riesgo muy distinto:
//
//   escuchar   sus mensajes entran al radar y alimentan el digest de la mañana
//   responder  además, el bot publica ahí, delante de todos los miembros
//
// Importar una línea trae de golpe TODOS sus grupos —la asesora de julio tenía
// 80— así que ambos nacen apagados y se prenden de a uno, a mano.
export default function GruposPermisos({ grupos }: { grupos: GrupoVivo[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Los grupos virtuales (export:, reenvio:) no tienen línea detrás: no se
  // escuchan ni se responden, se alimentan a mano. Mostrarlos acá con toggles
  // que no hacen nada sería mentir sobre lo que hace la pantalla.
  const reales = grupos.filter((g) => g.jid.endsWith("@g.us"));
  const respondiendo = reales.filter((g) => g.responde).length;

  async function cambiar(g: GrupoVivo, campo: "escuchar" | "responder", valor: boolean) {
    if (campo === "responder" && valor && !confirm(
      `El bot va a PUBLICAR mensajes dentro de "${g.nombre || g.jid}".\n\n` +
      "Los ven todos los miembros del grupo y no se pueden borrar.\n\n" +
      "Antes de prenderlo conviene haberlo dejado en modo sombra y revisado a mano " +
      "lo que habría publicado.\n\n¿Seguir?"
    )) return;

    setOcupado(`${g.id}:${campo}`);
    setError(null);
    try {
      const res = await fetch("/api/grupos/permiso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: g.id, [campo]: valor }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "No se pudo cambiar el permiso");
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falló");
    } finally {
      setOcupado(null);
    }
  }

  if (reales.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
        Todavía no hay grupos importados. Vinculá una línea arriba y tocá{" "}
        <strong>Importar grupos</strong>.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium text-slate-600">Grupos de la línea ({reales.length})</p>
        <p className="text-xs text-slate-500">
          {respondiendo === 0
            ? "El bot no responde en ninguno"
            : `El bot responde en ${respondiendo}`}
        </p>
      </div>

      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <ul className="divide-y divide-slate-100">
        {reales.map((g) => {
          const escucha = g.modo !== "ignorar";
          return (
            <li key={g.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1 truncate text-sm text-slate-800">
                {g.nombre || <span className="text-slate-400">Grupo sin nombre</span>}
              </span>

              <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={escucha}
                  disabled={ocupado !== null}
                  onChange={(e) => cambiar(g, "escuchar", e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Escuchar
              </label>

              <label
                className={[
                  "flex shrink-0 items-center gap-1.5 text-xs",
                  escucha ? "text-slate-600" : "text-slate-300",
                ].join(" ")}
                title={escucha ? "" : "Primero hay que escuchar el grupo"}
              >
                <input
                  type="checkbox"
                  checked={g.responde}
                  disabled={!escucha || ocupado !== null}
                  onChange={(e) => cambiar(g, "responder", e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Responder
              </label>

              {g.responde && (
                <span className="shrink-0 rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  publica
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-xs text-slate-500">
        Apagar <strong>Escuchar</strong> apaga también <strong>Responder</strong>: un permiso
        guardado sobre un grupo apagado se reactivaría solo el día que alguien lo vuelva a prender.
      </p>
    </div>
  );
}
