# CLAUDE.md — Diamond (bot inmobiliario + CRM)

Guía para Claude Code al trabajar en este repositorio.

## Qué es este proyecto

**Diamond**: agente conversacional de WhatsApp para inmobiliaria (persona: **Sofi**) + CRM web para el equipo. Multi-tenant. Repo: https://github.com/Jpelaezcolibri/diamond

- **Bot** (raíz): Node.js + Express + Claude SDK. Deploy: Railway.
- **CRM** (`crm/`): Next.js 16 + React 19 + Shadcn/ui + Tailwind 4. Deploy: Vercel (root directory `crm/`).
- **DMAP** (`dmap/`): microservicio de marketing automation ("Diamond Growth Engine") — Node 22 + TypeScript + Fastify + BullMQ/Redis. **Desplegado y en producción** en Railway (`https://dmap-production.up.railway.app`, segundo servicio, root directory `dmap/`), con Redis Online y workers activos (sync/cognitive/metrics/token-refresh). Incluye el **Diamond Cognitive Engine (DCE)**: genera un contexto estratégico por propiedad (`property_contexts` — buyer personas, objeciones, tono por canal) que alimenta al copywriter y al generador de creativos. Ver [dmap/ARCHITECTURE.md](dmap/ARCHITECTURE.md) y [dmap/README.md](dmap/README.md).
- **Web** (`web/`): landing pública multi-tenant ("REF") — Next.js + TS + Tailwind. Desplegada en Vercel, dominio real `https://diamondinmobiliaria.com` (alias `dimanondweb.vercel.app`). Catálogo, ficha de propiedad, captación de vendedores, leads al CRM, Meta Pixel + Conversions API ya configurados.
- **Datos**: Supabase compartida (única fuente de verdad). Sin `SUPABASE_URL` el bot corre en modo DEMO (memoria, se pierde al reiniciar).

Leer [ARCHITECTURE.md](ARCHITECTURE.md) (bot), [crm/ARCHITECTURE.md](crm/ARCHITECTURE.md) (CRM) y [dmap/ARCHITECTURE.md](dmap/ARCHITECTURE.md) (DMAP) antes de cambios estructurales.

## Comandos

```bash
npm install          # dependencias del bot
npm run dev          # bot con --watch en puerto PORT (.env, hoy 3003)
npm start            # bot en producción
npm test             # tests unitarios (node --test test/)
```

Probar conversación local sin WhatsApp:
```bash
curl -X POST http://localhost:3003/test -H "Content-Type: application/json" -d '{"phone":"573001112233","message":"Hola, me interesa la propiedad AP001"}'
curl -X DELETE http://localhost:3003/test/573001112233   # reiniciar conversación
```

## Estructura

```
src/
├── server.js            # Express: /webhook (Meta), /telegram, /test
├── config.js            # variables de entorno (dotenv)
├── agent/
│   ├── engine.js        # loop del agente (Claude + tools, reintento si respuesta vacía)
│   ├── prompts.js       # system prompt de Sofi + formato de ficha
│   ├── tools.js         # buscar_propiedades, registrar_dato_lead, transferir_a_asesor
│   └── qualification.js # score y calificación del lead (2 caminos: clásico y cierre directo)
├── channels/            # whatsapp.js (Cloud API), telegram.js (demo)
├── data/                # capa de datos: Supabase si está configurado, si no memory.js
└── notifications/       # advisor.js: alerta al asesor + link wa.me del cliente
db/schema.sql            # schema Supabase completo + seeds (ejecutar en SQL Editor)
test/                    # node:test
crm/                     # CRM Next.js (en construcción)
```

## Reglas del dominio (NO romper)

1. **Sofi**: mujer, paisa suave SIN muletillas forzadas (el usuario pidió explícitamente no forzar "pues"). La calidez va en el trato.
2. **Fichas de propiedad**: formato completo estilo Wasi (precio, área, hab, baños, garaje, estrato, admon, ubicación, link) + cierre "¿Te gustaría hablar con un asesor...? Responde SI".
3. **Venta vs Arriendo**: nunca mezclarlas. Campo `operacion` en properties.
4. **Cierre no invasivo**: en venta preguntar forma de pago (crédito → ofrecer asesoría); si el cliente duda, NO insistir.
5. **Transferencias por especialidad**: venta / arriendo / vehiculos / otro → tabla `advisors`. La alerta y el link wa.me van al asesor de la especialidad.
6. **Nunca inventar** propiedades, precios ni disponibilidad. Solo lo que devuelve `buscar_propiedades`. Nunca prometer descuentos.
7. **Multi-tenant**: la org se resuelve por `phone_number_id` entrante; token y asesores por organización.
8. Estados del lead: `nuevo → en_conversacion → calificado → transferido` (o `descartado`). Score con piso 70 para calificados.

## Convenciones

- **Idioma app**: español (Colombia). **Código**: inglés para variables/funciones; los nombres de dominio existentes en español (leads, propiedades) se mantienen como están.
- **Commits**: español con prefijos convencionales (`feat:`, `fix:`, `docs:`, `config:`).
- **Sin TypeScript en el bot** (JS plano con CommonJS). El CRM sí es TypeScript.
- Después de cambiar prompts/tools: correr `npm test` y probar al menos un flujo completo por `/test` antes de commitear.

## Variables de entorno

Ver [.env.example](.env.example). Claves: `ANTHROPIC_API_KEY` (requerida), `SUPABASE_URL`+`SUPABASE_SERVICE_KEY` (producción), `WHATSAPP_TOKEN`+`WHATSAPP_PHONE_ID`+`VERIFY_TOKEN` (Meta Cloud API), `BOT_API_KEY` (CRM→bot). El `.env` real NUNCA se commitea.

## Estado actual de infraestructura (verificado en vivo, 2026-07-07)

- **Bot en producción**: https://diamond-production-a713.up.railway.app (Railway, auto-deploy desde main)
- **CRM en producción**: https://crm.diamondinmobiliaria.com (Vercel, root directory `crm/`, auto-deploy desde main; proyecto `project-x0n55`, team `adminia`)
- **DMAP en producción**: https://dmap-production.up.railway.app (Railway, proyecto `serene-tenderness`, servicio `dmap`) — `/health` responde 200, Redis Online, workers procesando. El módulo Marketing del CRM (`/marketing`) ya opera contra este DMAP real (confirmado con datos en vivo, no solo con envs configuradas).
- **Landing en producción**: https://diamondinmobiliaria.com (dominio propio) / https://dimanondweb.vercel.app (alias Vercel) — mismo deploy.
- **Número producción Meta**: Diamond +57 304 4653609, phone_number_id `1218037454725710`, WABA `1702397800906189`, token permanente del System User `bot-admin`, webhook apuntando a Railway (override a nivel WABA vía API).
- **Número de prueba Meta**: +1 555 637-5987, phone_number_id `1077632778765817`.
- **Meta OAuth (Page + Instagram) para DMAP**: ya conectado — hay publicaciones/targets reales bajo seguimiento de métricas.
- **Inventario**: fuente activa = **API oficial de Wasi** (`wasi_api`, `id_company=12212160`, credenciales verificadas y ya cargadas desde `/marketing/configuracion`) — YA NO es el scraper público. Sync corriendo automático vía DMAP (última corrida conocida: 99 propiedades vistas, altas nuevas detectadas).
- **DCE (Diamond Cognitive Engine)**: generando contextos automáticamente para cada propiedad nueva/cambiada. Endpoint manual: `POST /api/v1/cognitive/context/{ref}/regenerate` en DMAP, o proxy `POST /api/marketing/cognitive/{ref}/regenerate` en el CRM.
- **⚠️ Known Issue (P2, no bloquea ventas):** `metrics.worker` falla el 100% de sus corridas (cada 6h) — Graph API rechaza una métrica en Facebook (code 100) y falta un permiso de insights en Instagram (code 10). Efecto: `post_metrics`/`/marketing/analytics` no se llenan; el resto del pipeline (generar/aprobar/publicar) no se afecta. Pendiente de corregir en `dmap/src/providers/meta/{facebook,instagram}.adapter.js` — requiere código, no configuración.
- **⚠️ WIP local sin pushear**: hay un commit local en `dmap/src/` (motores de creativos "designer"/"hybrid" — resolución de engine con degradación a Gemini) que NO está en `origin/main` todavía. `produceAsset` aún no invoca `generateDesignerCreative`. Revisar `git log` antes de asumir qué motores están realmente activos en producción.
- **Pendientes**: teléfonos reales de asesores de arriendos/vehículos en tabla `advisors` · corregir en Wasi el precio de la ref 9921388 ($1.550.000 → $1.550.000.000) · verificación de empresa en Meta · **confirmar cuáles son las 3 propiedades exclusivas del negocio** (no se pueden inferir del sistema; la cola de "Pendientes" en `/marketing` son solo altas nuevas rutinarias del sync, no una selección de negocio).
