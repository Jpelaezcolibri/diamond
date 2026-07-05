# REF · Design System

Sistema visual del Real Estate Experience Framework. Concepto: **Quiet Luxury Editorial** —
la web se siente como una revista de arquitectura, no como un portal de clasificados.
La confianza se transmite por contención, no por ornamento.

## Reglas de oro (no negociables)

1. Una idea por sección. Si una sección no aporta conversión o confianza, se elimina.
2. Fotografía protagonista; nunca iconografía 3D genérica ni fotos stock de "gente feliz".
3. Máximo 2 tipografías (heading + body, definidas por el preset del tenant).
4. Máximo 5 filtros visibles en el catálogo; el resto en "Más filtros" (Hick's Law).
5. El acento de marca (`accent`) es para detalles: líneas, badges, eyebrows, hover. Nunca grandes áreas.
6. Solo 2 sombras en todo el framework: `shadow-card` y `shadow-overlay`.
7. Todo CTA lleva a WhatsApp o al formulario. Nada más.
8. Nunca inventar datos: propiedades, precios y disponibilidad salen de la BD.
9. Motion sutil (fade + 20px, ease `[0.22,1,0.36,1]`); `prefers-reduced-motion` desactiva todo.
10. No mezclar Venta y Arriendo en una misma card o listado sin distinción clara.

## Tokens

Los valores viven en la config del tenant (`config/tenants/*.ts`) y se materializan como
CSS variables `--ref-*` ([lib/theme.ts](lib/theme.ts)) mapeadas a utilidades Tailwind 4 en
[styles/globals.css](styles/globals.css). Cambiar de marca = editar config, nunca componentes.

| Token | Utilidad | Uso |
|---|---|---|
| `background` | `bg-background` | Fondo principal (paper) |
| `foreground` | `text-foreground` | Texto principal (ink) |
| `surface` | `bg-surface` | Cards, sheets, inputs |
| `primary` / `primaryForeground` | `bg-primary` | Botones sólidos |
| `accent` / `accentForeground` | `text-accent` | Detalles de marca |
| `muted` | `text-muted` | Texto secundario |
| `border` | `border-line` | Bordes hairline |
| `whatsapp` | `bg-whatsapp` | Fijo #1FAF5E (AA sobre blanco) |
| — | `py-section` | Ritmo vertical editorial `clamp(5rem,10vw,9rem)` |
| — | `rounded-brand` | Radius del tenant (none/sm/md/lg) |
| — | `font-heading` / `font-body` | Preset tipográfico del tenant |

**Presets tipográficos** ([config/fonts.ts](config/fonts.ts)): `elegant` Fraunces+Inter ·
`modern` Sora+Inter · `editorial` Cormorant+Manrope · `geometric` Space Grotesk+Manrope.

**Dark mode**: cada token de color es un par light/dark en la config; `next-themes` cambia la
clase `.dark`. Las bandas invertidas (captación) reutilizan `dark` como scope local.

## Componentes

- `design-system/`: primitivos tematizados (Button: primary/outline/ghost/whatsapp/link · Badge · Input/Textarea/NativeSelect · Skeleton).
- `layout/`: `Container` (default 72rem · wide 90rem · prose 42rem), `SectionShell` (`inverted` para bandas ink).
- `shared/`: `SectionHeading` (eyebrow dorado + serif), theme-provider.
- `animations/`: `FadeIn`, `Stagger` (scroll-reveal con LazyMotion; respetan reduced-motion).
- `property/`, `search/`, `forms/`, `sections/`: componentes de dominio (ver ARCHITECTURE del plan).

Estados obligatorios por componente interactivo: default · hover · focus-visible (outline accent) ·
loading (skeleton) · empty · error · dark · reduced-motion.

## Voz

Español (Colombia), cálido sin cursilería. CTAs en primera persona del deseo:
"Quiero verla", "Hablemos por WhatsApp", "Vende tu propiedad con nosotros".
Prohibido: "Bienvenidos a nuestra página web", "líderes en el sector".
