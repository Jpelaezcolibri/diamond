# Plan 5 — App de asesores, Fase 1: solo lo mío, Para atender, notificaciones y PWA

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada asesor entre al CRM (instalable en el celular) y vea solo lo suyo, un inicio "Para atender" con sus pendientes, y una campana con notificaciones en vivo y push para los eventos de citas y pedidos de contacto.

**Architecture:** Tablas `notificaciones` y `push_suscripciones` (RLS: cada asesor ve las suyas por `advisors.auth_user_id = auth.uid()`). El bot escribe las notificaciones y manda el push con `web-push` (`src/notifications/notificar.js`). El CRM filtra por asesor en el servidor (helper `lib/mi-asesor.ts`), muestra la campana con Realtime y registra el service worker y la suscripción push.

**Tech Stack:** Bot Node.js + `node:test` + `web-push`; CRM Next.js 15 + Supabase SSR + Tailwind 4 (sin runner de tests: verificación con `npm run build` y `npm run lint`).

Spec: `docs/superpowers/specs/2026-10-07-app-diamond-asesores-design.md` §2–4, §7 F1.

## Global Constraints

- "Solo lo mío" se aplica en el servidor (queries), no solo en la UI. Admin ve todo. El calendario de visitas es de todo el equipo.
- Lo de un asesor: `leads.owner_id = auth.uid()` **o** `leads.transferido_advisor_id = advisor.id` **o** `leads.cita->>asesor_id = advisor.id` **o** `leads.cita->>advisor_id = auth.uid()`.
- Notificaciones: campana + push para todos los tipos; WhatsApp solo `cita_por_confirmar` (ya sale por plantilla) y `asesor_solicitado` (ya sale por texto). Un fallo de notificación nunca tumba el flujo que la dispara.
- La clave pública VAPID es pública (va en el código del CRM); la privada solo en Railway (`VAPID_PRIVATE_KEY`).
- Bot: `npm test` en verde (baseline 2127). CRM: `npm run build` sin errores.

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `db/migrations/2026-10-07_notificaciones.sql` | tablas, RLS, Realtime |
| `src/notifications/notificar.js` | escribir notificación + push |
| `src/notifications/aviso-cita.js`, `src/scheduler/citas-escalera.js`, `src/lib/confirmar-cita.js`, `src/agent/tools.js` | disparar notificaciones |
| `crm/lib/mi-asesor.ts` | auth user → fila de advisors; filtro "solo lo mío" |
| `crm/app/(dashboard)/{leads,kanban,inbox}/page.tsx` | aplicar el filtro a no-admin |
| `crm/components/campana.tsx` | campana con Realtime |
| `crm/app/(dashboard)/pendientes/page.tsx` | "Para atender" |
| `crm/app/manifest.ts`, `crm/public/sw.js`, `crm/components/activar-notificaciones.tsx`, `crm/app/api/push/suscribir/route.ts`, `crm/middleware.ts` | PWA y push |

### Task 1: Migración
`db/migrations/2026-10-07_notificaciones.sql`: tablas del spec §4.1; índices `(advisor_id, created_at desc)` y `(advisor_id) where leida_at is null`; RLS `select`/`update` en `notificaciones` y `select`/`insert`/`delete` en `push_suscripciones` con `advisor_id in (select id from advisors where auth_user_id = auth.uid())`; `alter publication supabase_realtime add table notificaciones`. La corre Juan; se verifica por REST.

### Task 2: notificar.js (bot)
- `notificar({ orgId, advisor, tipo, titulo, cuerpo, link, leadId }, deps?) -> { ok, push }`: inserta la fila (service key) y manda push a cada suscripción del asesor con `web-push` (payload `{ titulo, cuerpo, link }`); suscripción con 404/410 se borra. Sin `VAPID_PRIVATE_KEY` solo inserta. Nunca lanza.
- Tests con deps inyectadas: inserta con los campos; manda push a 2 suscripciones; borra la 410; sin VAPID no intenta push; si el insert falla devuelve `{ ok: false }` sin lanzar.

### Task 3: Disparadores (bot)
- `aviso-cita.js`: `cita_por_confirmar` → "Nueva visita por confirmar", link `/calendario`.
- `citas-escalera.js` rotar: al nuevo `cita_por_confirmar`; al anterior `cita_reasignada` ("La visita de X pasó a Asesor N"). Cortar: `cita_cancelada` al actual.
- `confirmar-cita.js`: a los otros del historial `cita_confirmada` ("La confirmó Asesor N"); `pedirOtroHorario`: `cita_cancelada`.
- `tools.js` `pedirContactoAsesora`: `asesor_solicitado` a la asesora (link `/inbox`).
- Tests: con `notificar` mockeado, cada camino llama con el `tipo` correcto.

### Task 4: Solo lo mío (CRM)
- `crm/lib/mi-asesor.ts`: `miAsesor(supabase, user)` (fila de advisors por `auth_user_id`) y `filtroMisLeads(query, user, advisor)` que agrega el `.or(...)` de Global Constraints.
- Leads, Kanban e Inbox: si no es admin, aplicar el filtro (Inbox filtra por `leads.id` de los suyos). `npm run build`.

### Task 5: Campana y Para atender (CRM)
- `components/campana.tsx` (client): cuenta no leídas, lista desplegable, Realtime `INSERT` en `notificaciones` filtrado por `advisor_id`; marcar leída al abrir. Reemplaza el 🔔 del layout (para admin sin fila de asesor, se mantiene el de leads calificados).
- `pendientes/page.tsx`: citas `propuesta` donde es el asesor actual (con hora del corte), notificaciones `asesor_solicitado` no leídas, sus leads en `en_conversacion` sin respuesta hace > 2 h. Link "Para atender" primero en el nav; el middleware manda a los asesores a `/pendientes` al entrar.

### Task 6: PWA y push (CRM)
- `app/manifest.ts` (standalone, `start_url: "/pendientes"`, ícono `app/icon.png`); `public/sw.js` (cachea `/_next/static`, nunca `/api`; `push` → `showNotification`; `notificationclick` → abrir `link`); `components/activar-notificaciones.tsx` (registra el SW, pide permiso, suscribe con la clave pública, `POST /api/push/suscribir`); en iPhone sin instalar, explica "Agregar a pantalla de inicio".
- `app/api/push/suscribir/route.ts`: guarda la suscripción del asesor actual.
- `middleware.ts`: excluir `sw.js` y `manifest.webmanifest` del matcher.

### Task 7: Despliegue
- Generar claves VAPID (`npx web-push generate-vapid-keys`); `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:juankpela10@gmail.com` en Railway `diamond`; la pública en `crm/lib/push.ts`.
- Juan corre la migración; verificación REST; push a `main`; deploys SUCCESS (Railway + Vercel).
- Prueba en celular (Juan): instalar, activar notificaciones, provocar una notificación de prueba.
