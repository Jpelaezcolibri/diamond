// Service worker de la App de asesores (F1, 2026-10-07).
// - Muestra las notificaciones push que manda el bot (src/notifications/notificar.js).
// - Al tocarlas abre el link en la app (o enfoca la ventana abierta).
// - No cachea /api ni paginas: el CRM es en vivo. Solo lo estatico de Next.
const ESTATICO = "diamond-estatico-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || !url.pathname.startsWith("/_next/static/")) return;
  event.respondWith(
    caches.open(ESTATICO).then(async (cache) => {
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const res = await fetch(event.request);
      if (res.ok) cache.put(event.request, res.clone());
      return res;
    })
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { titulo: event.data ? event.data.text() : "Diamond" };
  }
  event.waitUntil(
    self.registration.showNotification(data.titulo || "Diamond", {
      body: data.cuerpo || "",
      icon: "/icon.png",
      badge: "/icon.png",
      data: { link: data.link || "/pendientes" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/pendientes";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ventanas) => {
      for (const v of ventanas) {
        if ("focus" in v) {
          v.navigate(link);
          return v.focus();
        }
      }
      return self.clients.openWindow(link);
    })
  );
});
