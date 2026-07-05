# CLAUDE.md — Diamond (bot inmobiliario + CRM)

Guía para Claude Code al trabajar en este repositorio.

## Qué es este proyecto

**Diamond**: agente conversacional de WhatsApp para inmobiliaria (persona: **Sofi**) + CRM web para el equipo. Multi-tenant. Repo: https://github.com/Jpelaezcolibri/diamond

- **Bot** (raíz): Node.js + Express + Claude SDK. Deploy: Railway.
- **CRM** (`crm/`): Next.js 16 + React 19 + Shadcn/ui + Tailwind 4. Deploy: Vercel (root directory `crm/`).
- **DMAP** (`dmap/`): microservicio de marketing automation ("Diamond Growth Engine") — Node 22 + TypeScript + Fastify + BullMQ/Redis. Deploy: Railway (segundo servicio, root directory `dmap/`). En construcción por work packages, ver [dmap/ARCHITECTURE.md](dmap/ARCHITECTURE.md).
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

## Estado actual de infraestructura (jul 2026)

- **Bot en producción**: https://diamond-production-a713.up.railway.app (Railway, auto-deploy desde main)
- **CRM en producción**: https://diamondinmobiliaria.vercel.app (Vercel, root directory `crm/`, auto-deploy desde main; el proyecto Vercel se llama `project-x0n55` en el team `adminia`)
- **Número producción Meta**: Diamond +57 304 4653609, phone_number_id `1218037454725710`, WABA `1702397800906189`, token permanente del System User `bot-admin`, webhook apuntando a Railway (override a nivel WABA vía API).
- **Número de prueba Meta**: +1 555 637-5987, phone_number_id `1077632778765817`.
- **Inventario**: 39 propiedades reales importadas del Excel Wasi (`scripts/import_excel.py`); precios/títulos se sincronizan con `python scripts/sync_wasi_public.py` (páginas públicas de info.wasi.co).
- **Pendientes**: conexión API oficial de Wasi (`id_company` + `wasi_token`), teléfonos reales de asesores de arriendos/vehículos en tabla `advisors`, corregir en Wasi el precio de la ref 9921388 ($1.550.000 → $1.550.000.000), verificación de empresa en Meta.
