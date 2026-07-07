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
| WP2 | Sync engine Wasi (fuente activa hoy: **API oficial**, `wasi_api`; scraper público queda como fallback) |
| WP3 | AI Content Factory (copywriter en 5 estilos) + AI Image Selector |
| WP4 | Creative Generator Lite (satori + resvg + sharp, 3 tamaños, branding Diamond) |
| WP5 | Pipeline draft end-to-end (evento → generar → renderizar → draft) |
| WP6 | OAuth Meta (reusa la Meta App de WhatsApp/Sofi) + gestión de conexiones/tokens |
| WP7 | Social Publisher: adapters Facebook/Instagram, worker con idempotencia |
| WP8 | Sección Marketing en el CRM + Content Studio (`crm/app/(dashboard)/marketing/`) |
| WP9 | Analytics (metrics.worker cada 6h) + esta documentación |

### Estado de despliegue (verificado en vivo, 2026-07-07)

**Ya en producción — no repetir estos pasos:**
- ~~Credenciales de la API oficial de Wasi~~ — obtenidas y verificadas el 2026-07-05, **y activas**: `syncSource = wasi_api` ya está configurado, el sync corre solo (última corrida conocida: 99 propiedades vistas).
- ~~Migración `db/migrations/2026-07-05_dmap.sql` (y las 4 siguientes: `_dmap_rls`, `_dmap_ai_engine`, `_dmap_creative_engines`, `_dce_property_contexts`)~~ — aplicadas, `property_contexts` recibe escrituras reales.
- ~~Redis provisionado~~ — Online en Railway (`redis-volume`), workers (sync/cognitive/metrics/token-refresh) confirmados procesando en logs.
- ~~Bucket `dmap-creatives`~~ — creado el 2026-07-06, en uso.
- ~~Servicio DMAP en Railway~~ — desplegado y Online: `https://dmap-production.up.railway.app`.
- ~~OAuth Meta (Page + Instagram)~~ — conectado; hay publicaciones/targets reales bajo seguimiento de métricas.
- **App Review de Meta**: sigue sin necesitarse — solo aplica para onboardear inmobiliarias terceras.

**⚠️ Known Issue (P2, no bloquea el flujo de venta):** `metrics.worker` falla el 100% de sus corridas (cada 6h, 8/8 targets). Dos causas distintas en Graph API: código 100 en Facebook ("the value must be a valid insights metric" — nombre de métrica inválido en `facebook.adapter.js`) y código 10 en Instagram ("application does not have permission" — falta scope de insights en el token). Efecto acotado a que `post_metrics`/`/marketing/analytics` no se llenan. Corrección pendiente (código, fuera del alcance de un simple despliegue).

**⚠️ WIP local sin pushear:** hay cambios en `dmap/src/` (motores de creativos "designer"/"hybrid": resolución de engine con degradación a Gemini si falta `GEMINI_API_KEY`) que existen solo en un commit local, no en `origin/main`. `produceAsset` todavía NO invoca `generateDesignerCreative` — el wiring completo queda pendiente. No asumir que estos motores están activos en el DMAP desplegado hasta confirmar con `git log origin/main`.

### Guion de demo end-to-end (criterio de cierre de Fase 1)

1. `POST /api/v1/sync/run {orgId}` (o botón "Sincronizar ahora" en el CRM) → una propiedad nueva o cambiada aparece en "Novedades del inventario".
2. Desde el Dashboard, elegir un estilo y "Generar publicación" → la IA selecciona fotos, genera copy y renderiza los creatives; la publicación aparece en `draft`.
3. Abrir el Content Studio (`/marketing/publicaciones/:id`): editar el copy, cambiar el estilo y "Regenerar", revisar el preview.
4. "Aprobar" → elegir cuentas conectadas (Facebook/Instagram) → "Programar" (o "Publicar ahora").
5. La Cola (`/marketing/cola`, en vivo por Realtime) muestra la transición `aprobado → programado → publicando → publicado`.
6. Los posts quedan visibles en Facebook e Instagram (permalink visible en el Content Studio).
7. A las pocas horas, `/marketing/analytics` muestra alcance, likes y comentarios (recolectados automáticamente cada 6h).

Requiere: migración aplicada, Redis, credenciales reales de Anthropic y una conexión Meta completada vía OAuth desde `/marketing/configuracion`.
