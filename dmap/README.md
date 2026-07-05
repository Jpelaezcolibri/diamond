# DMAP — Diamond Growth Engine

Microservicio de automatización de marketing inmobiliario. Ver [ARCHITECTURE.md](ARCHITECTURE.md) para el diseño completo (flujos, modelo de datos, seguridad, plan de work packages).

## Comandos

```bash
npm install
npm run dev         # tsx watch, puerto PORT (.env, por defecto 3010)
npm run build       # compila a dist/
npm start           # producción (requiere build previo)
npm test            # vitest (unit + integration; el pipeline de creatives se ejecuta de verdad, sin red)
npm run typecheck
```

## Variables de entorno

Ver [.env.example](.env.example). Todas son requeridas (falla al arrancar si falta alguna): `DMAP_API_KEY`, `DMAP_ENCRYPTION_KEY` (32 bytes base64: `openssl rand -base64 32`), `REDIS_URL`, `SUPABASE_URL`+`SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY`, `META_APP_ID`+`META_APP_SECRET`, `DMAP_PUBLIC_URL`, `CRM_URL`.

## Estado (Fase 1 — completa)

Los 10 work packages de Fase 1 (ver [ARCHITECTURE.md §15](ARCHITECTURE.md#15-plan-de-implementacion-fase-1)) están implementados y probados (typecheck + build + 112 tests unitarios/integración en verde):

| WP | Contenido |
|---|---|
| WP-A | `ARCHITECTURE.md` — arquitectura aprobada antes de escribir código |
| WP0 | Esqueleto: Fastify+TS, Docker, auth por API key, health/metrics |
| WP1 | Migración SQL (14 tablas) + repositorios + state machine de publicaciones |
| WP2 | Sync engine Wasi (scraper público activo por defecto + interfaz para la API oficial) |
| WP3 | AI Content Factory (copywriter en 5 estilos) + AI Image Selector |
| WP4 | Creative Generator Lite (satori + resvg + sharp, 3 tamaños, branding Diamond) |
| WP5 | Pipeline draft end-to-end (evento → generar → renderizar → draft) |
| WP6 | OAuth Meta (reusa la Meta App de WhatsApp/Sofi) + gestión de conexiones/tokens |
| WP7 | Social Publisher: adapters Facebook/Instagram, worker con idempotencia |
| WP8 | Sección Marketing en el CRM + Content Studio (`crm/app/(dashboard)/marketing/`) |
| WP9 | Analytics (metrics.worker cada 6h) + esta documentación |

### Pendientes externos (no bloquean la Fase 1)

- ~~Credenciales de la API oficial de Wasi~~ — **obtenidas y verificadas el 2026-07-05** contra la cuenta real de Diamond ("Paraíso Inmobiliario", `id_company=12212160`, 96 propiedades). `wasi-api.source.ts` ya refleja la forma real de la respuesta (muy distinta de lo asumido antes de tener acceso — ver ARCHITECTURE.md §5). Falta un solo paso para activarla: guardar las credenciales desde `/marketing/configuracion` en el CRM (se cifran server-side, `PUT /api/v1/settings`) y cambiar `syncSource` a `wasi_api`.
- **App Review de Meta**: solo se necesita para onboardear inmobiliarias terceras (Diamond funciona en modo desarrollador de la app, sin necesidad de review).
- **Migración `db/migrations/2026-07-05_dmap.sql` aplicada en Supabase**: correrla en el SQL Editor antes de usar el sistema contra datos reales (nunca se aplica automáticamente, mismo criterio que el resto de `db/migrations/`).
- **Redis provisionado** (addon de Railway): sin él, el API sigue respondiendo pero la cola/scheduler no procesan jobs (degradación elegante, ver `src/index.ts`).

### Guion de demo end-to-end (criterio de cierre de Fase 1)

1. `POST /api/v1/sync/run {orgId}` (o botón "Sincronizar ahora" en el CRM) → una propiedad nueva o cambiada aparece en "Novedades del inventario".
2. Desde el Dashboard, elegir un estilo y "Generar publicación" → la IA selecciona fotos, genera copy y renderiza los creatives; la publicación aparece en `draft`.
3. Abrir el Content Studio (`/marketing/publicaciones/:id`): editar el copy, cambiar el estilo y "Regenerar", revisar el preview.
4. "Aprobar" → elegir cuentas conectadas (Facebook/Instagram) → "Programar" (o "Publicar ahora").
5. La Cola (`/marketing/cola`, en vivo por Realtime) muestra la transición `aprobado → programado → publicando → publicado`.
6. Los posts quedan visibles en Facebook e Instagram (permalink visible en el Content Studio).
7. A las pocas horas, `/marketing/analytics` muestra alcance, likes y comentarios (recolectados automáticamente cada 6h).

Requiere: migración aplicada, Redis, credenciales reales de Anthropic y una conexión Meta completada vía OAuth desde `/marketing/configuracion`.
