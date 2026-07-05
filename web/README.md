# REF — Real Estate Experience Framework

Landing premium multi-tenant para inmobiliarias. Una sola base de código; cada
inmobiliaria es un archivo de configuración en [config/tenants/](config/tenants/).
Primer tenant real: **Diamond Inmobiliaria** (inventario vivo de Supabase).

**En producción:** https://ref-web-lake.vercel.app (proyecto Vercel `ref-web`,
team `adminia`). Migración aplicada, imágenes reales pobladas, leads
verificados end-to-end contra el CRM.

- Diseño: ver [DESIGN.md](DESIGN.md) (concepto *Quiet Luxury Editorial*, tokens, reglas).
- Stack: Next.js App Router + TypeScript + Tailwind 4 + Framer Motion + RHF + Zod + nuqs.

## Correr local

```bash
cd web
npm install
cp .env.example .env.local   # llenar credenciales (ver abajo)
npm run dev                  # http://localhost:3200
```

Sin `NEXT_PUBLIC_SUPABASE_URL` (o con `TENANT_ID=demo`) corre en **modo demo**
con inventario de muestra — ideal para vender el framework mostrando la
experiencia completa.

## Variables de entorno

| Variable | Uso |
|---|---|
| `TENANT_ID` | Clave del tenant (`diamond`, `demo`). Un deploy Vercel por tenant. |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Lectura pública del catálogo (RLS `disponible=true`). |
| `SUPABASE_SERVICE_ROLE_KEY` | SOLO servidor — escribe leads en `/api/leads`. |
| `TENANT_ORG_ID` | UUID de `organizations.id` del tenant (Diamond: `1f502f7c-8465-4d7c-be05-ebf353a1c035`). |
| `NEXT_PUBLIC_META_PIXEL_ID` | ID del Pixel de Meta. Vacío = tracking apagado (no-op). |
| `META_CAPI_ACCESS_TOKEN` | Token de Conversions API (Events Manager → Configuración). SOLO servidor. |

## Puesta en producción (ya ejecutado para Diamond)

1. **Migración SQL**: [db/migrations/2026-07-04_landing.sql](../db/migrations/2026-07-04_landing.sql)
   aplicada en Supabase (columna `images` + política RLS de lectura pública).
2. **Imágenes**: `python scripts/sync_wasi_public.py` corrido — 38/39 propiedades
   con fotos reales de Wasi re-encodeadas a 1600px vía `image.wasi.co`.
3. **Vercel**: proyecto `ref-web` (team `adminia`), root directory `web/`, las
   5 variables de arriba configuradas en Production. `seo.baseUrl` en
   `config/tenants/diamond.ts` apunta al dominio real asignado.

Para un dominio propio (ej. `www.diamondinmobiliaria.com`): agregarlo en
Vercel → Project → Domains, apuntar el DNS, y actualizar `seo.baseUrl`.

Nota de caché: `services/properties.ts` usa `unstable_cache` (revalidate 300s,
tag `properties`) — es un cache de Vercel que persiste entre deploys, no por
build. Tras poblar imágenes/datos nuevos en Supabase, un redeploy solo
horneará las páginas estáticas de propiedades con datos frescos si ya
pasaron los 300s desde la última población del caché.

## Crear un tenant nuevo

1. Copiar `config/tenants/demo.ts` → `config/tenants/<nombre>.ts` y ajustar
   marca, colores, tipografía (`fontPreset`), WhatsApp, textos y secciones.
2. Registrarlo en `config/tenants/index.ts`.
3. Deploy en Vercel con `TENANT_ID=<nombre>` (+ su `TENANT_ORG_ID` si usa Supabase).

Cero cambios de código. La config se valida con Zod en build: si algo falta,
el build falla con el error exacto.

## Arquitectura (resumen)

- `config/` — contrato del framework: `tenant-schema.ts` (Zod), tenants, presets de fuentes.
- `lib/theme.ts` — config → CSS variables `--ref-*` inyectadas server-side (cero FOUC);
  `styles/globals.css` las mapea a utilidades Tailwind (`bg-primary`, `font-heading`…).
- `components/sections/registry.tsx` — la home es un loop sobre `home.sections`.
- `services/properties.ts` — una query cacheada (ISR 5 min, tag `properties`);
  filtros en memoria en el RSC; fallback demo tipado.
- `/propiedades/[slug]` — slug derivado `titulo-ref` con redirect 301 canónico;
  JSON-LD `RealEstateListing`; OG image dinámica.
- `/api/leads` — upsert conservador contra la tabla `leads` del CRM
  (jamás pisa `estado`/`score`/`source`), honeypot + time-trap, redirect a WhatsApp.

v2 reservado en config: `features.map`, `features.aiAssistant` (Sofi embebida), `features.comparator`.
