"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type Grupo = {
  id: string;
  jid: string;
  nombre: string | null;
  modo: "ignorar" | "sombra" | "sugerir";
  activo: boolean;
  created_at: string;
};

const MODOS: { valor: Grupo["modo"]; etiqueta: string; ayuda: string }[] = [
  { valor: "ignorar", etiqueta: "Ignorar", ayuda: "Sofi no lo ve. Es el valor por defecto de todo grupo nuevo." },
  { valor: "sombra", etiqueta: "Sombra", ayuda: "Sofi detecta y registra, sin avisarle a nadie. Para evaluar si acierta." },
  { valor: "sugerir", etiqueta: "Sugerir", ayuda: "Sofi avisa al asesor con el borrador listo. (Fase 2 — todavía no envía nada.)" },
];

export default function GruposPanel({ grupos }: { grupos: Grupo[] }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [cambiando, setCambiando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cambiarModo(id: string, modo: Grupo["modo"]) {
    setCambiando(id);
    setError(null);
    const res = await fetch("/api/grupos/modo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, modo }),
    }).catch(() => null);

    setCambiando(null);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => ({})) : {};
      setError(body.error || "No se pudo cambiar el modo");
      return;
    }
    startTransition(() => router.refresh());
  }

  if (grupos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        Todavía no se descubrió ningún grupo. Aparecen solos acá en cuanto la línea vinculada
        reciba un mensaje en alguno — sin procesarlo, sólo registrando que existe.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      {grupos.map((g) => (
        <div
          key={g.id}
          className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900">{g.nombre || "Grupo sin nombre"}</p>
            <p className="truncate font-mono text-xs text-slate-400">{g.jid}</p>
          </div>
          <div className="flex shrink-0 gap-1" role="group" aria-label={`Escucha de ${g.nombre || g.jid}`}>
            {MODOS.map((m) => {
              const activo = g.modo === m.valor;
              return (
                <button
                  key={m.valor}
                  type="button"
                  title={m.ayuda}
                  disabled={cambiando === g.id || pendiente}
                  onClick={() => cambiarModo(g.id, m.valor)}
                  className={[
                    "rounded-md px-3 py-1.5 text-sm font-medium transition",
                    activo
                      ? m.valor === "ignorar"
                        ? "bg-slate-200 text-slate-700"
                        : "bg-emerald-600 text-white"
                      : "text-slate-500 hover:bg-slate-100",
                    cambiando === g.id ? "opacity-50" : "",
                  ].join(" ")}
                >
                  {m.etiqueta}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
