"use client";

// Boton para recibir las notificaciones en el celular (App de asesores F1).
// Registra el service worker, pide permiso y guarda la suscripcion push del
// asesor. En iPhone el push solo funciona con la app agregada a la pantalla
// de inicio: si no esta instalada, lo explica en vez de fallar callado.
import { useEffect, useState } from "react";
import { VAPID_PUBLIC_KEY, base64UrlToUint8Array } from "@/lib/push";

type Estado = "cargando" | "no_soportado" | "ios_sin_instalar" | "bloqueado" | "activo" | "inactivo" | "error";

function esIosSinInstalar() {
  const ua = navigator.userAgent || "";
  const ios = /iPhone|iPad|iPod/.test(ua);
  const instalada = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !instalada;
}

export default function ActivarNotificaciones() {
  const [estado, setEstado] = useState<Estado>("cargando");

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setEstado(esIosSinInstalar() ? "ios_sin_instalar" : "no_soportado");
        return;
      }
      if (Notification.permission === "denied") return setEstado("bloqueado");
      const reg = await navigator.serviceWorker.register("/sw.js").catch(() => null);
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      setEstado(sub ? "activo" : "inactivo");
    })();
  }, []);

  async function activar() {
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") return setEstado("bloqueado");
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ||
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToUint8Array(VAPID_PUBLIC_KEY) }));
      const r = await fetch("/api/push/suscribir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      setEstado(r.ok ? "activo" : "error");
    } catch {
      setEstado("error");
    }
  }

  if (estado === "cargando" || estado === "activo") {
    return estado === "activo" ? <span className="text-xs text-emerald-700">🔔 Notificaciones activas en este equipo</span> : null;
  }
  if (estado === "ios_sin_instalar") {
    return <span className="text-xs text-slate-500">En iPhone: tocá Compartir → “Agregar a pantalla de inicio” y abrí la app desde ahí para activar las notificaciones.</span>;
  }
  if (estado === "no_soportado") return <span className="text-xs text-slate-500">Este navegador no recibe notificaciones.</span>;
  if (estado === "bloqueado") return <span className="text-xs text-red-600">Las notificaciones están bloqueadas: activalas en los ajustes del navegador.</span>;
  return (
    <button
      type="button"
      onClick={activar}
      className="rounded-lg bg-[#0b1526] px-3 py-1.5 text-sm font-medium text-[#c9a24b] hover:bg-[#13213a]"
    >
      {estado === "error" ? "Reintentar activar notificaciones" : "🔔 Activar notificaciones en este celular"}
    </button>
  );
}
