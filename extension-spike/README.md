# Spike de IndexedDB — NO ES EL PRODUCTO

**Esto no se publica, no se distribuye y no se instala en la máquina de un
asesor.** Es una herramienta de investigación de un solo uso que responde una
pregunta y después se borra.

## La pregunta

WhatsApp Web solo renderiza en el DOM la conversación **abierta**. Si la
extensión del Radar dependiera del DOM, solo podría leer el grupo que el asesor
tenga en pantalla — no los 80.

La otra vía es la **IndexedDB local** del navegador, que es donde WhatsApp Web
guarda los mensajes. Si es legible, la extensión lee todos los grupos de la lista
blanca sin que nadie abra nada.

**Ese es el resultado que define el alcance del producto.** Sin él, cualquier
estimación es una suposición.

## Riesgo

Cero para la cuenta de WhatsApp: no hay red, no hay protocolo, no hay DOM. Solo
se lee la base local del propio perfil del navegador.

El único riesgo real es de **datos locales**, y está blindado en el código:
`indexedDB.open()` con una versión mayor dispararía `onupgradeneeded` y podría
corromper la base de WhatsApp. Por eso `spike.js` abre siempre sin versión, solo
nombres que ya existen, y solo con transacciones `readonly`. Si un
`onupgradeneeded` se disparara igual, aborta.

## Cómo correrlo

1. Chrome → `chrome://extensions` → activar **Modo de desarrollador**.
2. **Cargar descomprimida** → elegir esta carpeta (`extension-spike/`).
3. **Antes de abrir WhatsApp Web, cerrá todas sus pestañas.** El experimento
   depende de saber cuántos grupos abriste en esta sesión.
4. Abrir `https://web.whatsapp.com` y esperar a que cargue.
5. **Abrir UN SOLO grupo.** Uno. Anotá cuál.
6. Abrir la consola (F12) → pestaña **Console**.
7. Buscar las líneas `[radar-spike]`.

## Cómo leer el resultado

El bloque `VEREDICTO` responde las preguntas que importan:

| Línea | Qué significa |
|---|---|
| `P3 ¿el texto se lee en claro?` | Si es **NO**, el contenido está cifrado en reposo y la vía de IndexedDB está cerrada |
| `P4 grupos distintos encontrados` | **La que decide todo.** Si abriste 1 grupo y esto dice 12, la extensión puede leer sin abrir |
| `P5 ¿trae chat + fecha + texto?` | Si es NO, hay datos pero no alcanzan para armar un mensaje |

Después imprime un JSON completo. **Copialo y pasámelo** — con eso escribo el
informe y decidimos el alcance de la extensión.

## Qué NO vas a ver en la salida

Ningún texto de mensajes de terceros. El informe reemplaza el contenido por un
hash corto y de los identificadores de grupo solo deja los últimos 12
caracteres. Es investigación sobre la *forma* de los datos, no sobre su
contenido.

## Después

Este directorio se borra cuando el resultado esté documentado en
`docs/superpowers/specs/2026-08-02-spike-indexeddb-resultado.md`.
