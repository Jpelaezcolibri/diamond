# CLAUDE.md — Diamond (bot inmobiliario + CRM)

Punto de entrada único de este repo para Claude Code. Este archivo se mantiene
liviano a propósito: da orientación general y dice qué documento leer según
la tarea. No dupliques aquí contenido que ya vive en esos documentos —
actualízalo ahí y, si cambia el enrutamiento, actualiza el mapa de abajo.

## 1. Qué es este proyecto

**Diamond**: ecosistema de captación y conversión inmobiliaria para Diamond
Inmobiliaria (Medellín), multi-tenant desde el modelo de datos.
Repo: https://github.com/Jpelaezcolibri/diamond

Cuatro piezas, una sola Supabase como fuente de verdad:

- **Bot** (raíz, `src/`): agente de WhatsApp "Sofi" (Node.js + Express +
  Claude SDK). Atiende clicks en ads, arma fichas, califica leads, transfiere
  al asesor humano.
- **CRM** (`crm/`): Next.js — inbox en vivo de las conversaciones de Sofi,
  gestión de leads, módulo Marketing (consume DMAP).
- **DMAP** (`dmap/`): "Diamond Growth Engine" — microservicio Node/TS/Fastify
  que sincroniza el inventario de Wasi, genera copy y creativos con IA
  (Diamond Cognitive Engine) y publica en Facebook/Instagram.
- **Web** (`web/`): landing pública "REF" (Next.js), multi-tenant por config,
  catálogo + ficha de propiedad + captación de leads.

Equipo: 1 dev (Juan) + Claude Code. Idioma de la app: español (Colombia).
Código: inglés. Commits: español, prefijos convencionales (`feat:`, `fix:`,
`docs:`, `config:`).

## 2. Estado actual (2026-09-04)

- **Radar en observación (desplegado 2026-09-04, commit `aec9fc8`).** Se aflojó
  la política de DM al colega: `match.js` ya no descarta por alcobas de más ni
  por baños/garajes cortos, y se quitó el tope de 2 DMs por colega. Decisión de
  Juan con el riesgo sobre la mesa — spec y plan en `docs/superpowers/`.
  **Hay que mirarlo, no dejarlo correr solo:** WhatsApp le impone a la línea
  ~300 mensajes por mes calendario (`messageCapping`), y hay un cortacircuitos
  que frena los DMs al 80% y deriva todo a la asesora.
  `GET /webhook/grupos/estado` devuelve `dmsUltimas24h` y `cuotaWhatsapp`.
  **Ojo al leerlos: no miden lo mismo.** `dmsUltimas24h` cuenta filas con
  `respuesta_modo='auto'`, que incluye publicaciones viejas en grupo, así que
  está inflado (al desplegar decía 18 contra 13 de WhatsApp en todo el mes).
  El número que manda es `cuotaWhatsapp.usados`.
- **El remote de git quedó en SSH** (2026-09-04). El 403 de HTTPS por la cuenta
  CAPELA127 es historia: `git push origin main` funciona sin rodeos.

- **Objetivo activo:** DMAP Fase 1 cerrada y desplegada (sync, IA de
  creativos, publicación, analytics); foco actual = cerrar los known issues
  antes de sumar features nuevas a DMAP.
- **En producción, las 4 piezas:** bot (Railway), CRM (Vercel,
  `crm.diamondinmobiliaria.com`), DMAP (Railway,
  `dmap-production.up.railway.app`), landing REF (Vercel,
  `diamondinmobiliaria.com`).
- **Restricciones del equipo:** 1 dev, sin admin en la máquina Windows de
  desarrollo, presupuesto de infra mínimo (~5 USD/mes por servicio Railway).
- **Known issue abierto (P2):** `metrics.worker` de DMAP falla el 100% de sus
  corridas (Graph API) — no bloquea ventas. Detalle en
  [dmap/README.md](dmap/README.md).
- **WIP sin pushear:** los motores "designer"/"hybrid" ya están en
  `origin/main` y desplegados. Confirmar igualmente con
  `git log origin/main..HEAD` antes de asumir que un commit local está en
  producción (Railway despliega desde GitHub).
- **Migraciones en Supabase (verificado 2026-09-03 contra producción por
  REST, proyecto `qwqmlmyyswpdypdfvmiv`):** TODAS las columnas y tablas de
  `db/migrations/` hasta `2026-09-03_aviso_link.sql` existen y tienen datos
  reales (10 señales con `aviso_token`, 81 con `aviso_advisor_id`,
  `organizations.mandatos_activos=false`, `directorio_lids` creada,
  `creative_engine='designer'` en la org Diamond). `CRM_PUBLIC_URL` ya está en
  Railway y el arranque lo confirma en el log ("Link de avisos: https://crm...").
  Publicación Realtime verificada 2026-09-03 con `pg_publication_tables`:
  leads, conversations, messages, publication_events, command_messages,
  group_signals y mandato_match_alerts — `2026-08-14_realtime_leads.sql` y
  `2026-09-02_realtime_grupos.sql` corridas. `2026-07-09_dmap_default_designer.sql`
  corrida el mismo día en el mismo bloque (solo el DEFAULT para orgs nuevas).
  `2026-09-04_dm_destinatario.sql` (columnas de auditoría del destinatario del
  DM) corrida y verificada por REST el 2026-09-04.
  **No hay migraciones pendientes.**
  Regla: antes de declarar una migración "pendiente" acá, verificarla con un
  `select` por REST — esta lista estuvo desactualizada del 2026-08-18 al
  2026-09-03.
- **Pendientes de negocio:** teléfonos reales de asesores de arriendo/
  vehículos en `advisors` · corregir precio de la ref `9921388` en Wasi ·
  verificación de empresa en Meta · confirmar las 3 propiedades exclusivas
  del negocio.

## 3. Mapa de módulos

Cargá solo el documento que corresponda a la tarea:

| Si la tarea toca... | Leer |
|---|---|
| Bot de WhatsApp (Sofi, prompts, tools, calificación, canales) | [ARCHITECTURE.md](ARCHITECTURE.md) — incluye reglas de dominio que NO se pueden romper |
| Setup, comandos y tests del bot | [README.md](README.md) |
| CRM (inbox, leads, auth, módulo Marketing) | [crm/ARCHITECTURE.md](crm/ARCHITECTURE.md) |
| DMAP (sync Wasi, IA de creativos, publicación en Meta, analytics) | [dmap/ARCHITECTURE.md](dmap/ARCHITECTURE.md) (diseño completo) + [dmap/README.md](dmap/README.md) (estado real desplegado, comandos, known issues) |
| Landing REF (`web/`) | [web/README.md](web/README.md) (setup, envs, arquitectura) + [web/DESIGN.md](web/DESIGN.md) (sistema visual) |
| Estrategia comercial / Meta Ads / buyer personas / SOPs de venta | [playbook/00-INDICE.md](playbook/00-INDICE.md) — índice de 8 documentos |
| Schema o migraciones de base de datos | [db/schema.sql](db/schema.sql) + `db/migrations/` — única fuente de verdad para las 4 apps |
| Variables de entorno | `.env.example` de cada módulo (raíz, `crm/`, `dmap/`, `web/`) — nunca commitear un `.env` real |

`CAMPAÑAS/` y `DIAMOND/` son carpetas sin versionar con assets de campañas
(PDFs, imágenes, xlsx) — material de referencia, no código.

## 4. Reglas de trabajo

Antes de escribir código nuevo, en este orden:

1. **Reutilizar** — ¿ya existe un módulo, función o tabla que resuelve esto?
   Revisá el módulo correspondiente en el mapa antes de asumir que hace
   falta algo nuevo.
2. **Integrar** — ¿se conecta con lo existente sin tocar su contrato? (ej.:
   el CRM lee de la misma Supabase; nunca duplica la lógica de envío de
   WhatsApp que ya vive en el bot).
3. **Extender** — ¿alcanza con agregar un caso, campo o tool a un módulo ya
   aprobado? (ej.: un canal nuevo en `src/channels/`, un documento nuevo en
   el playbook).
4. **Construir** — solo si ninguna de las anteriores aplica: módulo nuevo,
   con su propio `ARCHITECTURE.md` aprobado antes de escribir código de
   implementación (ver [dmap/ARCHITECTURE.md](dmap/ARCHITECTURE.md) como
   ejemplo del proceso).

Además:

- Nunca asumas qué está activo en producción solo por lo que dice un
  `ARCHITECTURE.md` — el diseño aprobado y lo desplegado pueden divergir
  (ver "WIP sin pushear" arriba). Confirmá con el README del módulo o con
  `git log`.
- Multi-tenant siempre: no hardcodear datos de Diamond donde debería
  resolverse por `org_id`/tenant.
