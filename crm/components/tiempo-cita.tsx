"use client";

// Contador de una visita por confirmar (brief citas-avisos §4): "Pasa a la
// siguiente asesora en X min" o "Se cancela en X h". Se calcula en el
// navegador y se refresca cada minuto; en rojo si faltan menos de 15 min.
// Antes de montar no pinta nada, para no chocar con la hora del servidor.
import { useEffect, useState } from "react";
import { tiempoRestante, type CitaTiempo } from "@/lib/cita-tiempo";

export default function TiempoCita({ cita, oscuro = false }: { cita: CitaTiempo | null | undefined; oscuro?: boolean }) {
  const [ahora, setAhora] = useState<number | null>(null);
  useEffect(() => {
    setAhora(Date.now());
    const t = setInterval(() => setAhora(Date.now()), 60 * 1000);
    return () => clearInterval(t);
  }, []);
  if (ahora == null) return null;
  const r = tiempoRestante(cita, ahora);
  if (!r) return null;
  const color = r.urgente ? (oscuro ? "text-red-300" : "text-red-600") : oscuro ? "text-slate-200" : "text-amber-900";
  return <div className={`text-xs font-semibold ${color}`}>⏳ {r.texto}</div>;
}
