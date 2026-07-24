# Toggle de idioma (ES/EN) — landing REF (`web/`)

## Contexto

La landing pública (`web/`, Next.js App Router, multi-tenant) hoy solo existe en
español (`lang="es-CO"` fijo, texto hardcodeado en ~15 componentes). Diamond
recibe visitantes que prefieren o necesitan inglés (colombianos en el exterior,
expats — personas P3/P4 del playbook de buyer personas). Se pide un toggle en
el header que cambie el idioma de la interfaz entre español e inglés.

## Alcance (decidido con el usuario)

- **Se traduce:** interfaz estática — nav, botones, formularios, footer, textos
  del hero/landing, páginas de error.
- **NO se traduce:** título/descripción de las propiedades (vienen de Wasi y del
  DCE, siempre en español — traducirlas exigiría IA en tiempo real o mantener
  una copia en inglés por propiedad, fuera de alcance).
- **URLs:** una sola URL por página en ambos idiomas (sin `/en/...` separado).
  Consecuencia aceptada: Google solo indexa la versión en español (la que se
  sirve en el HTML inicial del servidor); el inglés es para el visitante
  humano, no una estrategia de SEO bilingüe.
- **Metadata SEO** (`<title>`, `og:description`, JSON-LD): se genera en el
  servidor antes de que exista el idioma del cliente — queda fija en español
  siempre, sin importar el idioma activo del visitante.

## Arquitectura

Provider de idioma del lado del cliente, calcado del patrón que ya usa este
mismo repo para el tema claro/oscuro (`components/shared/theme-provider.tsx`
con `next-themes`): un Context de React con `language: "es" | "en"`,
persistido en `localStorage`, expuesto vía un hook `useLanguage()`. Sin
librerías nuevas — un diccionario TypeScript plano (~60-80 strings) no
justifica sumar `next-intl` u otra dependencia para este alcance (YAGNI).

## Componentes

1. **`web/config/i18n.ts`** — diccionario `{ es: {...}, en: {...} }`,
   organizado por sección (`nav`, `footer`, `hero`, `forms`, `property`,
   `notFound`, `search`). Tipado con TypeScript (`Record` sobre las mismas
   claves en ambos idiomas) para que un string faltante en inglés sea error
   de compilación, no un bug silencioso en producción.
2. **`web/components/shared/language-provider.tsx`** — `"use client"`, mismo
   patrón que `theme-provider.tsx`: Context + `localStorage`, expone
   `useLanguage()` → `{ language, setLanguage, t }`. Actualiza
   `document.documentElement.lang` al cambiar (correcto para accesibilidad).
   Se monta en `app/layout.tsx` envolviendo el árbol, junto a `ThemeProvider`.
3. **`web/components/navigation/language-toggle.tsx`** — pill "ES · EN",
   client component, usa `useLanguage()`. Se monta en `Header` (desktop) y en
   `MobileNav` (menú móvil).
4. Los componentes con texto hardcodeado identificados (11 con volumen real de
   copy visible al usuario) migran sus strings literales a `t("clave")`:
   `navigation/header.tsx`, `navigation/mobile-nav.tsx`,
   `navigation/whatsapp-fab.tsx`, `forms/lead-form.tsx`,
   `search/hero-search.tsx`, `search/filter-bar.tsx`, `search/pagination.tsx`,
   `property/property-gallery.tsx`, `app/not-found.tsx`,
   `app/propiedades/page.tsx`, `app/propiedades/[slug]/page.tsx` (solo el copy
   de UI de esta última, no metadata SEO ni el contenido de la propiedad).

## Data flow

- **Primera carga (servidor):** siempre español — el servidor no conoce la
  preferencia del visitante, y ya se decidió que el SEO queda fijo en español.
- **Al hidratar en el navegador:** si `localStorage` tiene `"en"` de una visita
  anterior, el texto cambia a inglés casi de inmediato. Puede haber un
  parpadeo de una fracción de segundo en esa transición — trade-off aceptado
  de un toggle client-only sin script bloqueante en `<head>` (no se justifica
  la complejidad extra para un sitio de marketing).
- **Al tocar el toggle:** cambia el estado del Context → todo el texto que usa
  `t()` re-renderiza → se persiste en `localStorage`.

## Manejo de errores

- Si `localStorage` no está disponible (modo incógnito estricto, SSR):
  `language` cae a `"es"` por defecto, sin romper el render.
- Si falta una clave en el diccionario para el idioma activo: TypeScript lo
  marca en compilación (tipos espejados entre `es`/`en`), no hay caso de
  "clave faltante en runtime" que contemplar.

## Testing / verificación

`web/` no tiene test framework (deuda conocida, fuera de este alcance).
Verificación: `npx tsc --noEmit` + `npm run build`, y smoke visual en el
navegador — togglear, recargar la página (debe recordar el idioma elegido),
revisar que no queden mezclas español/inglés, y que el `lang` del `<html>`
cambie correctamente en cada modo.

## Fuera de alcance (explícito)

- Traducción de contenido dinámico de propiedades (Wasi/DCE).
- Rutas separadas por idioma / hreflang / SEO bilingüe.
- Traducción de mensajes de Sofi (bot) o del CRM — esto es exclusivamente la
  landing pública.
