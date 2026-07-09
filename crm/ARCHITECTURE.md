# Arquitectura — CRM Diamond (inbox del bot inmobiliario)

## Contexto
- **Qué hace la app:** plataforma web para el equipo de Diamond: ver las conversaciones de WhatsApp que atiende Sofi en tiempo real, intervenir manualmente cuando un asesor quiera tomar el control, y gestionar los leads calificados (score, forma de pago, estado).
- **Usuarios objetivo:** Juan + 1-3 asesores de la inmobiliaria. Una sola organización por ahora.
- **Escala esperada (12 meses):** decenas de conversaciones/día, < 10 usuarios internos. Volumen pequeño.
- **Equipo:** 1 desarrollador (Juan) asistido por Claude. Stack dominado: Next.js + React + Supabase + Shadcn/Tailwind.
- **Restricciones clave:** MVP esta semana; el bot Express ya existe y ya soporta Supabase; presupuesto mínimo (Vercel free + Railway ~5 USD + Supabase free).

## Decisión
**Arquitectura elegida:** 3-tier con Supabase como única fuente de verdad, en el mismo repositorio (carpeta `crm/`).

**Stack:**
- **Frontend/CRM:** Next.js 15 + React 19 + TypeScript + Shadcn/ui + Tailwind 4, desplegado en Vercel (root directory `crm/`).
- **Datos:** la MISMA Supabase del bot (tablas `organizations`, `properties`, `leads`, `conversations`, `messages`). Supabase Auth para el login del equipo. Supabase Realtime para actualizar el inbox en vivo.
- **Backend bot (existente):** Express en Railway. Se le agregan 2 cosas: respetar el modo "humano" de una conversación (Sofi se pausa) y un endpoint `POST /api/send` protegido con API key para que el CRM envíe mensajes manuales por la Cloud API.

```
Cliente WhatsApp ──► Meta Cloud API ──► Bot Express (Railway) ──► Supabase ◄── CRM Next.js (Vercel)
                          ▲                                          │ Realtime      │
                          └────────── POST /api/send (API key) ◄─────┴───────────────┘
```

## Justificación
- **Es el stack que Juan ya domina** (idéntico a LicitaAI/WorkPilot): cero curva de aprendizaje, MVP alcanzable en días.
- **Supabase compartida elimina sincronización**: el bot ya escribe leads/conversaciones/mensajes ahí; el CRM solo los lee. Realtime viene gratis (suscripción a la tabla `messages`).
- **El envío manual pasa por el bot, no directo a Meta**: una sola pieza conoce el token de WhatsApp y las reglas de envío (ventana 24h, formato). El CRM llama al bot con API key. Regla "una tabla, un dueño" respetada para la lógica de mensajería.
- **Mismo repo, deploys separados**: bot → Railway (raíz), CRM → Vercel (`crm/`). Un solo lugar para versionar el schema (`db/schema.sql`).
- **Auth resuelto por Supabase Auth** (email/password con lista blanca de correos del equipo): no se construye auth a mano.

## Alternativas consideradas y descartadas
- **Panel HTML servido por el mismo Express** — descartada: construir un inbox decente (tiempo real, chat UI) sin React sería más lento y de peor calidad que con el stack que Juan domina.
- **Migrar el bot a Next.js API routes (todo en Vercel)** — descartada: reescritura innecesaria del bot que ya funciona; los webhooks de Meta y procesos del agente viven mejor en un servidor persistente.
- **CRM de terceros (Chatwoot, Kommo)** — descartada por ahora: pierde el control del scoring/calificación propio y agrega costo mensual; puede reevaluarse si el equipo crece.

## Estructura de carpetas
```
bot-inmobiliario/
├── src/                    # bot existente (Express)
│   ├── agent/
│   ├── channels/
│   ├── data/
│   └── api/                # NUEVO: endpoints para el CRM (send, takeover)
├── db/schema.sql           # schema compartido (+ modo de conversacion, tabla team)
└── crm/                    # NUEVO: Next.js
    ├── app/
    │   ├── (auth)/login/
    │   └── (dashboard)/
    │       ├── inbox/          # lista + chat en tiempo real
    │       └── leads/          # tabla de leads con score y filtros
    ├── components/         # Shadcn/ui
    ├── lib/                # supabase client, api client del bot
    └── ARCHITECTURE.md     # este archivo
```

## Trade-offs aceptados
- Sacrificamos separación total de repos para ganar velocidad y un solo schema versionado.
- El CRM depende de que el bot esté arriba para enviar mensajes manuales (aceptable: si el bot está caído, WhatsApp tampoco responde).
- Sin roles/permisos finos en el MVP (todos los del equipo ven todo): suficiente para 1-4 usuarios de una misma inmobiliaria.

## Camino de evolución
- **A 3-6 meses:** si entran más inmobiliarias → activar multi-tenant en el CRM (filtro por `org_id` + roles por organización; el schema ya lo soporta).
- **A 6-12 meses:** métricas y embudo (conversión por estado, tiempos de respuesta), asignación de leads a asesores, notas internas por lead.
- Si el volumen de mensajes crece mucho → mover el envío a una cola (deferred).

## Decisiones diferidas
- Notificaciones push/email al asesor cuando hay transferencia (el MVP usa la alerta de WhatsApp existente).
- Multi-tenant en el CRM (schema listo, UI después).
- Plantillas de mensajes (HSM) para reabrir conversaciones fuera de la ventana de 24h.

## Módulo Marketing (DMAP)

`app/(dashboard)/marketing/` consume el microservicio DMAP (`dmap/`, ver [dmap/ARCHITECTURE.md](../dmap/ARCHITECTURE.md)) con el mismo patrón que el bot: lecturas directas a Supabase (`publications`, `publication_assets`, `publication_events`, `sync_runs`, `property_change_events`, `social_connections`), mutaciones vía proxy server-side en `app/api/marketing/*` (mismo patrón que `app/api/send` ↔ bot) usando `lib/dmap.ts`.

Variables de entorno adicionales (agregar a `.env.local`, nunca commitear):
```
DMAP_API_URL=http://localhost:3010     # o la URL de Railway en producción
DMAP_API_KEY=                          # debe coincidir con DMAP_API_KEY del servicio dmap/
```

Solo visible para usuarios con rol `admin` (nav condicional en `app/(dashboard)/layout.tsx`, guard en `app/(dashboard)/marketing/layout.tsx`).
