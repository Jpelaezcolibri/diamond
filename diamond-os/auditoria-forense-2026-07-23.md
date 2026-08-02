# Auditoría forense — Diamond (bot + CRM + DMAP + web + BD) — 2026-07-23

Auditoría de arquitectura, seguridad y datos sobre el repo completo, contrastada
contra los `ARCHITECTURE.md` de cada módulo. La deuda ya documentada y aceptada
(colas diferidas, single-tenant en UI del CRM, metrics.worker P2, migración
`2026-07-23_agenda_horarios` pendiente) **no** se reporta como hallazgo nuevo.

## Resumen ejecutivo

El proyecto está en mejor forma de lo habitual para un equipo de 1 dev: cero
secretos versionados en 179 commits (verificado en historial completo),
fronteras entre apps limpias (CRM nunca toca WhatsApp directo; una tabla, un
dueño con la única excepción documentada), DMAP con TypeScript estricto sin un
solo `any`, y patrones de calidad producción (cifrado AES-GCM de tokens,
idempotencia por target, prompt caching, degradación consciente).

Los 3 problemas más urgentes:

1. **El perímetro del bot está abierto**: el webhook de WhatsApp no valida la
   firma de Meta y los endpoints `/test` quedan expuestos sin auth en
   producción — un tercero puede enviar WhatsApp reales desde el número de
   Diamond, leer PII de leads y borrar datos de leads reales.
2. **El "multi-tenant siempre" es aspiracional en 3 capas**: RLS es
   `using (true)` (cualquier usuario autenticado ve todas las orgs), el CRM
   confía el `orgId` que manda el cliente, y workers/prompts/captions tienen a
   Diamond hardcodeado. Nada de esto duele hoy (1 tenant); todo explota al
   onboardear el segundo.
3. **Fallos silenciosos como patrón**: envíos de WhatsApp fallidos que el CRM
   muestra como enviados, páginas del CRM que pintan "sin datos" cuando la BD
   falla, settings de DMAP que se guardan pero no hacen nada, y contenido DCE
   pagado que probablemente nunca se muestra en la landing por una política
   RLS faltante.

Recomendación general: una tanda corta de endurecimiento (críticos + quick
wins, ~2-3 días) antes de cualquier feature nueva; el trabajo multi-tenant
grande puede esperar hasta que haya fecha real de segundo tenant, pero debe
quedar en el backlog como bloqueante de ese onboarding.

## Contexto considerado

- Fuentes de verdad: `ARCHITECTURE.md` (bot), `crm/ARCHITECTURE.md`,
  `dmap/ARCHITECTURE.md` + `dmap/README.md`, `web/README.md`, `db/schema.sql`
  + 22 migraciones, CLAUDE.md del repo.
- Alcance: `src/` completo (bot, 32 archivos), `crm/` (80+ archivos: 27 API
  routes, 18 páginas, 25 componentes), `dmap/src/` (97 archivos TS + 34 de
  test), `web/` (app/components/lib/services/config), `db/`, higiene de git.
- No verificado en vivo: estado real de RLS/filas en la Supabase de
  producción, Redis/Railway, builds de Vercel. Donde un hallazgo depende de
  eso, se marca como condicional.

---

## Hallazgos críticos (🔴)

### C1 — Webhook de WhatsApp sin validación de firma de Meta
**Ubicación:** `src/channels/whatsapp.js:158-239`
**Categoría:** Seguridad
**Problema:** `POST /webhook` procesa cualquier request sin verificar
`X-Hub-Signature-256` (no hay ningún `createHmac` en `src/`). Con un
`phone_number_id` inexistente cae al fallback `organizations.getDefault()` y
con `message.from` arbitrario el bot **envía WhatsApp reales desde el número
de Diamond a cualquier teléfono**, quema tokens de Claude, crea leads basura y
dispara alertas a asesores.
**Refactor:** middleware HMAC-SHA256 del raw body con `META_APP_SECRET`
(`express.json({ verify })` para conservar el raw body); 401 si no coincide.

### C2 — Endpoints `/test` y `DELETE /test/:phone` sin auth en producción
**Ubicación:** `src/server.js:26-58`
**Categoría:** Seguridad
**Problema:** se montan siempre, sin API key ni flag de entorno. `POST /test`
devuelve el objeto `lead` completo (PII) de cualquier teléfono; `DELETE
/test/:phone` resetea conversación y borra nombre/presupuesto/score/estado de
**leads reales** (la tabla es única por `org_id+phone`, sin distinguir source).
**Refactor:** gatear con `NODE_ENV !== "production"` o exigir `x-api-key =
BOT_API_KEY` (el guard ya existe en `src/api/crm.js:14` — reutilizarlo).

---

## Hallazgos altos (🟠)

### A1 — Webhook de Telegram sin secret token
**Ubicación:** `src/channels/telegram.js:22-62` (+ `src/server.js:14` monta el
router aunque `TELEGRAM_TOKEN` esté vacío)
**Problema:** no valida `X-Telegram-Bot-Api-Secret-Token`; el atacante controla
`chat.id` y usa el bot como proxy de spam quemando tokens de Claude.
**Refactor:** registrar webhook con `secret_token` y validar el header; no
montar el router sin token configurado.

### A2 — Sin serialización de mensajes concurrentes del mismo usuario
**Ubicación:** `src/channels/whatsapp.js:159` (200 inmediato + proceso async),
`src/data/leads.js:18-26` y `src/data/conversations.js:20-35`
(select-then-insert)
**Problema:** 2-3 mensajes seguidos del mismo cliente (el camino feliz del
producto) disparan `procesarMensaje` concurrentes: el segundo insert de lead
lanza contra el unique y el mensaje se pierde sin respuesta; `conversations`
no tiene unique por `(lead_id, estado)` → conversaciones "activas" duplicadas
e historial partido; dos llamadas a Claude desincronizadas → doble respuesta o
silencio.
**Refactor:** cola en memoria por `org_id+phone` (Map de promesas encadenadas
alcanza a esta escala) + upsert con `onConflict` en leads + unique parcial
`(lead_id) where estado='activa'`.

### A3 — Token de WhatsApp en texto plano legible por cualquier asesor autenticado
**Ubicación:** `db/schema.sql:8` (`organizations.whatsapp_token text`) +
`db/migrations/2026-07-02_crm.sql:17` (policy `for select to authenticated
using (true)` sobre la fila completa)
**Problema:** cualquier asesor logueado al CRM puede leer el token de Graph
API desde la consola del navegador. DMAP ya resolvió esto bien
(`access_token_enc` AES-256-GCM, tablas de tokens sin política de lectura) —
el patrón correcto existe en el propio repo.
**Refactor:** quitar la política de `organizations` (o exponer solo columnas
no sensibles vía vista) y/o cifrar como DMAP.

### A4 — RLS `using (true)`: aislamiento entre tenants inexistente en la capa que importa
**Ubicación:** `db/migrations/2026-07-02_crm.sql:16-27`,
`2026-07-05_dmap_rls.sql:34-62`, `2026-07-06_ally_properties.sql`; páginas del
CRM sin `.eq("org_id")` (`inbox/page.tsx:17`, `leads/page.tsx:17`,
`kanban/page.tsx:16`, etc.)
**Problema:** RLS funciona como muro contra `anon`, no como aislamiento entre
tenants: todo usuario autenticado lee leads/conversaciones/mensajes de TODAS
las orgs (incluso vía Realtime desde el navegador). El "el schema ya soporta
multi-tenant" de `crm/ARCHITECTURE.md:62` subestima el trabajo real: no existe
tabla de membresía usuario↔org.
**Refactor (bloqueante del tenant #2):** tabla `org_members` + políticas
`using (org_id in (select ...))` + `.eq("org_id")` en lecturas y suscripciones.

### A5 — CRM: Marketing dejó de ser solo-admin y las APIs quedaron partidas en dos criterios
**Ubicación:** `crm/app/(dashboard)/marketing/layout.tsx:11-12` (solo chequea
sesión) vs `crm/ARCHITECTURE.md:81`; rutas `approve`, `publish-now`,
`schedule`, `retry`, `archive`, `generate`, `regenerate*`, `PATCH
publications/[id]`, `cognitive/*` solo exigen sesión (`sync`/`settings`/
`meta/*`/`connections/*` sí exigen `isAdmin`)
**Problema:** hoy cualquier `asesor_otros` puede **publicar en el
Facebook/Instagram de la empresa** y disparar generaciones de IA costosas.
**Refactor:** decidir el modelo y alinear: `isAdmin` en las mutaciones
sensibles o actualizar el ARCHITECTURE.md si la apertura fue deliberada.

### A6 — CRM: `orgId` del cliente se confía sin verificar pertenencia (proxy DMAP)
**Ubicación:** patrón en `crm/app/api/marketing/generate/route.ts:17-25`,
`sync`, `settings`, `cognitive/*`, `meta/*`
**Problema:** el body trae `orgId` y se reenvía a DMAP tal cual; con un
segundo tenant, cualquier usuario de la org A opera sobre la org B cambiando
un campo del request. Se agrava con M-DMAP7 (DMAP tampoco valida
propiedad↔org en `generateDraftForProperty`).
**Refactor:** resolver `orgId` server-side por membresía del usuario e ignorar
el del cliente.

### A7 — DMAP: doble publicación real posible por doble-submit de `publish-now`
**Ubicación:** `dmap/src/api/publications.routes.ts:242-265`; tabla
`publication_targets` sin unique `(publication_id, social_connection_id)`
**Problema:** las 3 capas anti-duplicado protegen por target, pero nada impide
crear dos targets para la misma publicación+conexión: doble click / retry del
proxy → **el mismo post sale dos veces en FB/IG** (daño reputacional directo).
**Refactor:** migración con unique + claim atómico de estado en `publish-now`
(409 al segundo request).

### A8 — DMAP: `POST /sync/run` corre el sync fuera de la cola (corridas solapadas)
**Ubicación:** `dmap/src/api/sync.routes.ts:10-23` vs
`dmap/src/queue/workers/sync.worker.ts:21`
**Problema:** el botón "Sincronizar ahora" ejecuta `runSync` in-band, en
paralelo con la corrida repetible del worker: `sync_runs` duplicados, carreras
sobre `property_sync_state`, eventos de cambio duplicados, request HTTP
bloqueado el sync completo.
**Refactor:** el endpoint debe hacer `enqueueSync(orgId)` (ya existe y respeta
el jobId determinista) y responder 202.

### A9 — DMAP: settings placebo — `auto_generate_*` y `publish_window` no hacen nada
**Ubicación:** `dmap/src/api/settings.routes.ts:53-55` (se guardan);
consumidores: ninguno. `enqueueGenerate` (`queues.ts:57-63`) sin llamadores;
no hay worker para la cola `generate`; `schedule` no valida ventana.
**Problema:** un admin que apaga `auto_generate_on_new_property` cree que
controla gasto de IA; uno que configura ventana 08:00-20:00 cree que nada sale
de madrugada. Ambas creencias son falsas y `dmap/ARCHITECTURE.md` §5/§9/§12
las respalda.
**Refactor:** implementar (trigger en `processCandidate` + worker + chequeo de
ventana en schedule) **o** borrar `enqueueGenerate`, ocultar los settings y
corregir el doc. Lo inaceptable es el estado intermedio.

### A10 — DMAP: Graph API y Wasi API sin timeout explícito
**Ubicación:** `dmap/src/providers/meta/graph-client.ts:41-57`,
`dmap/src/sync/wasi-api.source.ts:207`, `dmap/src/creatives/ai-engine.ts:62`
**Problema:** un socket colgado con Meta ocupa las 2 únicas ranuras del
publish.worker hasta ~300s (default de undici). El propio repo ya tiene el
patrón bueno (`fetch-image.ts`: 15s + retry + backoff).
**Refactor:** helper `fetchWithTimeout` compartido (15-30s) en
graphGet/graphPost/graphDelete y el query de Wasi; AbortError →
`RetryableError`. Mismo problema en el bot: cliente Anthropic de
`src/agent/engine.js:12` y `followups.js:27` sin timeout (sofi-comando ya lo
tiene en 60s) y `sendWhatsApp` sin timeout.

### A11 — `facturacion/`, `scratch/`, `DIAMOND/`, `CAMPAÑAS/` sin gitignore, con PII real
**Ubicación:** `facturacion/*.pdf|html` (cédula real C.C. 1.037.579.126, ID de
cuenta publicitaria Meta, fechas de pago), `scratch/props.json` (dump de
producción con ids/org_id reales). Verificado: `git check-ignore` falla para
las 4 carpetas.
**Problema:** un `git add .` + push publica datos financieros personales en
GitHub.
**Refactor (5 minutos):** agregar las 4 carpetas a `.gitignore`.

### A12 — `db/schema.sql` masivamente desincronizado (20+ migraciones atrás)
**Ubicación:** `db/schema.sql` (6 tablas, estado 2026-07-02) vs
`db/migrations/` (22 archivos, 22+ tablas nuevas y decenas de columnas)
**Problema:** CLAUDE.md lo declara "única fuente de verdad para las 4 apps";
cualquier dev (o Claude) que lo lea modela mal el estado real. Además no hay
tracking de qué migraciones corrió producción (solo memoria humana).
**Refactor:** regenerar como snapshot (`pg_dump --schema-only`) al cerrar cada
tanda + tabla `_applied_migrations(nombre, applied_at)` que cada script
inserte.

### A13 — Web: lectura DCE (`property_contexts`) probablemente muerta en producción
**Ubicación:** `web/services/property-context.ts:19-29` (lee con cliente
**anon**) vs `db/migrations/2026-07-06_dce_property_contexts.sql:53-54` (única
política: `to authenticated`). Condicional: pudo aplicarse a mano en Supabase.
**Problema:** los títulos/beneficios SEO del DCE (Fase 1 pagada, 96
propiedades backfilled) no se estarían mostrando nunca — degradación 100%
silenciosa (`console.warn` por render).
**Refactor:** `create policy ... for select to anon using (status='ready')`
(idealmente vía vista con columnas expuestas).

### A14 — Multi-tenant roto en workers del bot y contenido de DMAP (Diamond hardcodeado)
**Ubicación:** bot: `src/scheduler/followups.js:86` y `reminders.js:48`
(`getDefault()` — solo procesan la primera org), `src/config.js:27` +
`properties.js:10-13` (landing de Diamond para todas las propiedades),
`followups.js:48` ("inmobiliaria en Medellin" en el prompt). DMAP:
`creatives/brand.ts:14-21` (fallback identidad Diamond para cualquier org), 4
prompts con "Diamond Inmobiliaria" literal, `LANDING_BASE_URL`/
`CONTACT_WHATSAPP_NUMBER` como env globales del servicio. CRM: `lib/caption.ts:11-12`
(dominio + WhatsApp de Diamond hardcodeados).
**Problema:** viola la regla explícita del CLAUDE.md; el tenant #2 tendría
seguimientos que nunca corren, fichas enlazando al dominio de Diamond y
captions con el WhatsApp de Sofi.
**Refactor:** workers iterando orgs activas; `landing_base_url` y contacto por
org (en `organizations` / `org_marketing_settings`); interpolar `brand.name`
en prompts.

### A15 — Cero tests en CRM y web; lint del CRM no ejecutable
**Ubicación:** `crm/package.json` (sin framework de test; script `lint` sin
eslint instalado ni config), `web/package.json` (sin script de test; 0
archivos de test)
**Problema:** contradice el Definition of Done del propio proyecto (7 gates).
Sin cobertura quedan la lógica de autorización del CRM (`lib/lead-access.ts`),
la paridad de captions CRM↔DMAP, y en web `normalizePhone` (el join key
landing→CRM→bot) y `clean-html` (ya tuvo bug en producción). En el bot, el
orquestador `procesarMensaje` tampoco tiene tests (el archivo `test/agent.test.js`
prometido en ARCHITECTURE.md:84 no existe; el cliente Anthropic no es
inyectable — `engine.js:12`).
**Refactor:** vitest mínimo en crm y web para los módulos puros; en el bot,
inyectar el cliente Anthropic y testear el flujo tool_use→tool_result→texto.

---

## Hallazgos medios (🟡)

### Bot
- **M1. Divergencia doc↔código en pérdida de mensajes:** el 200 sale antes de
  procesar (`whatsapp.js:159`), así que Meta nunca reintenta — el trade-off de
  ARCHITECTURE.md:102 descansa en un reintento que el código anula. Persistir
  el mensaje entrante antes del 200, o corregir el doc.
- **M2. Envíos fallidos tragados:** `sendWhatsApp` devuelve `null` en error y
  se persiste igual (`whatsapp.js:41-45`, `crm.js:55`) — el CRM muestra
  mensajes que el cliente nunca recibió. Guardar estado de envío + 1 retry.
- **M3. `REF_PATTERN` codicioso:** `\d{6,8}` captura presupuestos como
  referencia de propiedad (`engine.js:47,59-62`) y ese campo pesa 25 puntos y
  habilita `cierreDirecto` (`qualification.js:14,32`) — un lead puede quedar
  calificado con su presupuesto como "propiedad de origen". Validar con
  `findByRef` antes de persistir.
- **M4. `reminders` marca después de enviar** (`reminders.js:57-67`, orden
  inverso a followups) y ningún scheduler tiene lock inter-proceso: con 2
  réplicas habría doble toque a clientes. Claim atómico con update condicional.
- **M5. Logs con PII:** teléfono completo + texto del mensaje en cada log
  (`whatsapp.js:205`, `telegram.js:39`, `followups.js:125`). Enmascarar.
- **M6. `crm.js` salta la capa de datos** y su update inline de
  `last_activity_at` (`crm.js:59-62`) rompe el invariante documentado en
  `conversations.js:106` (el reloj de silencio ya no mide solo al cliente).

### CRM
- **M7. Rutas de aliados mutan por `id` sin scoping de org ni rol**
  (`aliados/actualizar/route.ts:31`, `aliados/estado/route.ts:18`).
- **M8. TOCTOU en send/modo/media:** `assertOwnsLead` (SELECT) + claim después
  — el perdedor de la carrera igual envía su mensaje al cliente
  (`lib/lead-access.ts:32`, `api/send/route.ts:19`). Claim primero.
- **M9. Errores de query silenciados en todas las páginas server:** se
  destructura solo `data` — BD caída se ve como "Sin leads todavía"
  (`inbox/page.tsx:16` y 6 páginas más). Banner de error distinguible.
- **M10. Lógica DMAP duplicada a mano:** `lib/caption.ts` y `lib/slug.ts` son
  espejos declarados ("si cambian allá, cambiar acá") sin test de paridad — el
  preview del Content Studio puede mentir. Endpoint de preview en DMAP o test
  de paridad.
- **M11. Boilerplate de auth copiado en 27 rutas** sin helper central; el
  middleware excluye `api` del matcher — la próxima ruta olvidada queda
  pública. `requireUser()/requireAdmin()` compartidos.

### DMAP
- **M12. Known issue de metrics falla en silencio total:** el job queda
  *completed* con `{collected:0, errors:8}`, `/metrics` prometido en §11 es un
  stub, sin canal de alerta — se descubrió leyendo logs a mano. Job *failed*
  si `errors === targets.length` + implementar `/metrics`.
- **M13. `callClaude` clasifica todo error como `RetryableError`**
  (`ai/claude.ts:42-45`) — una API key vencida reintentaría pagando tokens el
  día que la cola cognitive tenga attempts.
- **M14. Tres escritores de `publications.status`** (transition, claim,
  recompute) y el único que valida aristas es el menos usado
  (`publish.service.ts:107-150`); `transition` es read-then-write (TOCTOU).
- **M15. Default de `creative_engine` contradictorio:** org sin fila de
  settings cae al motor pago (`settings.repo.ts:13` dice `"ai"` vs decisión
  documentada "designer $0"). Una línea + correr la migración pendiente
  `2026-07-09_dmap_default_designer.sql`.
- **M16. Sin techo de gasto de IA por org:** el costo se contabiliza en
  `content_generations` pero nunca se limita — N clicks de "Regenerar" son
  gasto no acotado. Presupuesto diario por org (los datos ya existen).
- **M17. `generateDraftForProperty` no verifica propiedad↔org**
  (`generation.service.ts:446` — el guard existe en el cognitive builder y
  falta acá; es una línea).
- **M18. Evento `created` significa "nuevo para DMAP", no "propiedad nueva"**
  (`diff.ts:39`) — un primer sync sobre inventario preexistente dispara N
  builds cognitivos; riesgo latente si A9 se cablea sobre estos eventos.

### Web
- **M19. Rate limit en memoria por instancia serverless**
  (`lib/rate-limit.ts`) — el 6/hora es por instancia; spam ensucia la señal de
  optimización de campañas Meta. Swap a Upstash/KV (la interfaz ya lo prevé).
- **M20. `TENANT_ID` ausente defaultea a "diamond"** (`config/tenant.ts:14`) y
  **`TENANT_ORG_ID` opcional muestra inventario de todas las orgs**
  (`services/properties.ts:38`). Fallar en producción si faltan.
- **M21. Home, sitemap y robots congelados al build** (sin `revalidate`; el
  tag `properties` se declara y nadie lo invalida) — propiedades nuevas de
  Wasi no aparecen hasta el próximo deploy. 2 líneas.
- **M22. Gotcha 402 a medias:** fotos Wasi correctamente `unoptimized` (4/4
  puntos verificados), pero hero y logo sí pasan por el optimizador
  (`hero-section.tsx:21`, `header.tsx:23`) — el incidente vivido volvería a
  tumbar la primera impresión. Además el hero del tenant real es una URL de
  Unsplash hardcodeada.
- **M23. Token CAPI de Meta en query string** (`services/tracking.ts:53`) —
  Meta acepta el token en el body; cambio de 2 líneas.
- **M24. Modelos y `normalizePhone` duplicados con bot/CRM** sin contrato —
  una divergencia fragmenta leads en silencio (el join key es `phone`).
- **M25. Sin stale-fallback ante caída de Supabase:** con pauta activa, cada
  minuto caído es presupuesto de ads aterrizando en la página de error.
  Timeout ~5s + retener último inventario bueno en memoria.

---

## Hallazgos bajos (🟢) — agrupados

- Bot: doble `leads.update` por dato y hasta 4 updates por transferencia sin
  transacción (`tools.js:226`, `engine.js:188`); comparación de API key no
  constante y `e.message` expuesto en 500s (`crm.js:14,67`).
- CRM: kanban sin `.limit()` (cap silencioso de 1000 filas), analytics trae
  todo `post_metrics`, `router.refresh()` por cada UPDATE de cualquier
  conversación, `modo` obsoleto en ChatView, `/api/media` sin validar
  MIME/tamaño server-side, `STATUS_LABELS` duplicado.
- DMAP: `DMAP_ENCRYPTION_KEY` reutilizada como clave HMAC (HKDF resolvería),
  `scheduled_at` escrito antes de validar la transición, `attempts` con
  read-then-write, `200` duplicado en `FATAL_GRAPH_ERROR_CODES` (¿faltan
  201/203/230?), drift documental §3/§9/§11/§12, tests mutando `env` global.
- Web: `/wa/[ref]` sin validar la ref (mensajes precargados arbitrarios bajo
  el dominio oficial), `'unsafe-eval'` en CSP sin justificar,
  `VerticeSignature` rompe convención de nombres, README con dominio viejo,
  tenant `kubeta-preview` con datos reales de Diamond registrado por default.
- Transversal: celulares personales reales en seeds versionados
  (`schema.sql:97,104`, migración de roles); `SUPABASE_SERVICE_KEY` vs
  `SUPABASE_SERVICE_ROLE_KEY` (mismo secreto, dos nombres); CLAUDE.md del
  workspace dice Next 16 y el repo está en 15.3.3; `properties` con 3
  escritores (DMAP + 2 scripts Python) sin coordinación.

---

## Plan de refactor priorizado (impacto/esfuerzo)

1. **Higiene git inmediata** (S, 5 min) — `.gitignore`: `facturacion/`,
   `DIAMOND/`, `CAMPAÑAS/`, `scratch/`. Resuelve A11.
2. **Cerrar el perímetro del bot** (S, ~1 día) — firma HMAC de Meta en el
   webhook, gatear `/test`, secret token de Telegram, timeout 60s en los 3
   clientes Anthropic y en `sendWhatsApp`. Resuelve C1, C2, A1, parte de A10.
3. **RLS de `organizations`** (S) — quitar la política de lectura o vista sin
   columnas sensibles. Resuelve A3.
4. **DMAP anti doble publicación + sync encolado** (S/M) — unique en
   `publication_targets` + claim en `publish-now`; `/sync/run` →
   `enqueueSync`; `fetchWithTimeout` en Graph/Wasi; default `designer` en
   `settings.repo.ts:13` + correr migración pendiente. Resuelve A7, A8, A10,
   M15.
5. **Frontera admin del CRM + orgId server-side** (S) — `requireAdmin` en
   mutaciones de Marketing, helper central de auth, resolver `orgId` por
   sesión. Resuelve A5, A6, M11; mitiga M17.
6. **Quick wins web** (S, una tarde) — política RLS anon de
   `property_contexts`, `revalidate=300` en home/sitemap, `unoptimized` en
   hero/logo + hero a asset propio, token CAPI al body, validar ref en
   `/wa/`. Resuelve A13, M21, M22, M23.
7. **Serialización de mensajes por usuario en el bot** (M) — cola por
   `org_id+phone` + upserts atómicos + unique parcial en conversations.
   Resuelve A2; de paso M4 (claims atómicos en schedulers).
8. **Visibilidad de fallos** (M) — estado de envío de WhatsApp en `messages` y
   en el CRM; error banners en páginas del CRM; metrics.worker failing
   ruidosamente + `/metrics` real. Resuelve M2, M9, M12.
9. **Base de datos como fuente de verdad** (S/M) — regenerar `schema.sql`
   (pg_dump) + tabla `_applied_migrations`. Resuelve A12.
10. **Tests mínimos** (M) — vitest en crm (lead-access, paridad caption,
    phone) y web (normalizePhone, clean-html, filters); cliente Anthropic
    inyectable + tests de `procesarMensaje`. Resuelve A15.
11. **Decisión sobre settings placebo de DMAP** (M) — implementar o borrar y
    corregir el doc. Resuelve A9.
12. **Paquete pre-tenant-2** (L, cuando haya fecha real) — `org_members` +
    RLS por org, workers multi-org, branding/landing/contacto por org en
    DMAP y bot, `TENANT_*` obligatorios en web, techo de gasto IA por org.
    Resuelve A4, A6 (fondo), A14, M16, M20.

## Lo que está bien hecho

- **Cero secretos versionados** en 179 commits (historial completo escaneado);
  service-role keys confinadas a server-side en CRM y web (verificado por
  grep); `.env` reales correctamente ignorados.
- **Fronteras entre apps limpias:** el CRM jamás toca WhatsApp/Meta directo
  (todo vía bot con API key y DMAP con API key); mapa tabla→escritores
  coherente con "una tabla, un dueño" (única excepción documentada:
  `properties`).
- **Bot — seguridad por diseño estructural:** la info de propiedades de
  aliados que ve el modelo excluye precio/ref/zona (imposible filtrarla por
  prompt); scope de Sofi-Comando congelado server-side con tools que nunca
  aceptan `org_id` del modelo; prompt caching bien particionado; el LLM
  propone y el código decide (intent regex, validación de agenda en código).
- **DMAP — calidad producción:** TypeScript estricto sin un solo `any`/
  `@ts-ignore`, cifrado AES-256-GCM versionado, idempotencia por target con
  claims atómicos y resume de containers IG, backoff finito con dead-letter,
  degradación en cadena de motores de creativos, pino con redact, 34 archivos
  de test con inyección de dependencias, y comentarios forenses que documentan
  cada bug real aprendido.
- **Web — el endpoint de leads es de lo mejor del repo:** Zod compartido
  cliente/servidor, honeypot + time-trap con 200 fake, upsert no destructivo
  que no permite corromper datos calificados, logs sin PII; SEO por encima del
  promedio (canonicals con 301, JSON-LD, OG por propiedad, dedup Pixel↔CAPI).
- **Cultura de gotchas:** el patrón "columna nueva no rompe pantalla" se
  respeta en CRM y bot; las migraciones son idempotentes y documentan qué
  corrigen; los trade-offs están escritos donde se tomaron.
