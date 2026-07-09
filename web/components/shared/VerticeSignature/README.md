# VerticeSignature

Firma de marca reutilizable de Vértice Studio. Es el mismo anillo animado
del Hero de vertice-studio (`assets/logo.mp4`), extraído como badge
independiente — sin el layout, sin el Hero, sin nada más.

## Instalación en un proyecto nuevo (copiar y pegar)

1. Copia esta carpeta completa a `components/VerticeSignature/` (o
   `src/components/VerticeSignature/` si el proyecto usa carpeta `src`).
2. Copia `assets/logo.mp4` (de vertice-studio) a `public/vertice-signature.mp4`
   del proyecto destino.
3. Úsalo en cualquier layout o página:

```tsx
import { VerticeSignature } from "@/components/VerticeSignature";

<VerticeSignature position="bottom-right" />
```

No requiere dependencias nuevas: solo React + CSS Modules (soportado por
Next.js de fábrica). No usa Tailwind, así que funciona igual en proyectos
que no lo tengan.

## Props

| Prop        | Tipo                                                          | Default                                    | Descripción                                     |
| ----------- | -------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------ |
| `href`      | `string`                                                        | `https://vertice-studio-mu.vercel.app/`     | Destino al hacer click (`target="_blank"`).       |
| `size`      | `number`                                                        | `52`                                        | Diámetro en px, clamp interno a 48–56.            |
| `tooltip`   | `string`                                                        | `"Built by Vértice Studio"`                 | Texto del tooltip y del `aria-label`/`title`.     |
| `position`  | `"bottom-right" \| "bottom-left" \| "footer" \| "custom"`      | `"bottom-right"`                            | Ver abajo.                                        |
| `videoSrc`  | `string`                                                        | `/vertice-signature.mp4`                    | Ruta al video, ajustable por proyecto.            |
| `className` | `string`                                                        | —                                            | Clases extra para el contenedor.                  |
| `onClick`   | `() => void`                                                    | —                                            | Callback de analítica (PostHog/GA/etc). No bloquea la navegación. |

## Posiciones

- **`bottom-right` / `bottom-left`**: `position: fixed`, listo para usar,
  con `z-index: 45` (queda por debajo de modales típicos en `z-50+`).
  **Antes de usarlas, revisa si ese rincón ya está ocupado** por un botón
  de WhatsApp, chat, o cookie banner del proyecto destino.
- **`footer`**: sin posición fija — se integra en el flujo normal del
  documento. Pensado para insertarse junto al copyright del footer.
- **`custom`**: sin ningún estilo de posición. El contenedor padre decide
  todo el layout (útil para sidebars, headers, etc).

## Por qué es reutilizable sin modificar el componente

- **Cero dependencias nuevas** — solo `react` y CSS Modules, que ya vienen
  con cualquier proyecto Next.js. Ningún proyecto necesita instalar nada.
- **Cero acoplamiento al layout de origen** — el componente no importa
  nada del Hero de vertice-studio, no depende de sus fuentes, ni de sus
  variables CSS globales. Todos los colores (`--vs-gold`, `--vs-black`)
  están scoped dentro del propio CSS Module.
- **Video parametrizable (`videoSrc`)** — cada proyecto sirve su propia
  copia del asset desde su propio dominio, así que no depende de la
  disponibilidad de vertice-studio.vercel.app.
- **Posicionamiento por prop, no hardcodeado** — cada sitio decide dónde
  vive el badge según qué rincones ya tiene ocupados.
- **Accesible por defecto** — funciona con teclado (Enter nativo del
  `<a>`, Space vía `onKeyDown`), tiene `aria-label`/`title`/`role="tooltip"`,
  y respeta `prefers-reduced-motion` pausando el video y quitando las
  transiciones.
- **SSR-safe** — el `useEffect` que reproduce el video solo corre en
  cliente; no hay acceso a `window`/`document` en el render inicial.

Para agregarlo a un proyecto nuevo: repetir los 3 pasos de instalación de
arriba. No hay que tocar el componente.
