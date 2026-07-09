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

## 2. Estado actual (2026-07-07)

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
- **WIP sin pushear:** motores de creativos "designer"/"hybrid" en
  `dmap/src/` — commit local, no en `origin/main`; confirmar con `git log`
  antes de asumir que están activos en producción.
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
