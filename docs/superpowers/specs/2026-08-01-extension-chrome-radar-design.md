# Extensión de Chrome para el Radar de Grupos — diseño

**Fecha:** 2026-08-01 · **Estado:** pendiente de aprobación · **Alcance:** captura
automática desde WhatsApp Web oficial, en reemplazo del export manual.

## Por qué existe

El export nativo funciona y es de riesgo cero, pero es manual y solo desde el
teléfono: WhatsApp no permite exportar desde Web ni desde la app de escritorio.
Para un asesor que quiere atender los pedidos antes de que se enfríen —mañana y
mediodía, todos los días— la fricción se acumula.

La extensión hace lo mismo sin que nadie exporte nada.

## La corrección que condiciona todo el diseño

El intento anterior (WAHA/Baileys) terminó con la cuenta de una asesora baneada
el 2026-07-30. **La causa NO fue la reconexión cada dos segundos.**

Secuencia real de los logs: 11 h de operación normal → `stream:error 503` → 60
reintentos en 5 min → sesión trabada → baneo. El 503 llegó **primero**: la
cuenta ya estaba marcada y WhatsApp rechazaba la conexión. Los reintentos
fueron consecuencia, no causa.

La huella que quedó en los logs fue `["Ubuntu","Chrome","22.04.4"]` desde una IP
de datacenter — la firma de Baileys.

La investigación externa lo confirma como mecanismo general, no como anécdota:

| Hallazgo | Fuente |
|---|---|
| El fingerprinting de protocolo (handshake WebSocket, orden de negociación de claves, timing de sesión) es **el mecanismo primario** de detección | [kraya-ai](https://blog.kraya-ai.com/whatsapp-automation-ban-risk) |
| **Los delays y el backoff NO evitan el baneo**: la detección de capa 1 dispara antes | ídem |
| Si la herramienta se conecta por QR, corre sobre protocolo reversado y se marca **en la capa de red, antes del primer mensaje** | ídem |
| Baileys / WAHA / Evolution API duran **2–8 semanas** antes de la detección; 68% de negocios baneados en 12 meses | [sporesec](https://sporesec.com/en/blog/whatsapp-unofficial-api-ban-risk) |

**Conclusión: poner backoff en WAHA no habría salvado la cuenta.** Cualquier
cliente que hable el protocolo de WhatsApp está condenado. La extensión no lo
habla — ese es el punto entero.

## Por qué la extensión es categóricamente distinta

| | WAHA / Baileys | Extensión sobre WhatsApp Web |
|---|---|---|
| Quién habla el protocolo | Un cliente reversado | **La app oficial de WhatsApp** |
| Firma de cliente | Baileys, detectable | Ninguna: es Chrome con WhatsApp Web |
| IP | Datacenter (Railway) | Residencial, la del asesor |
| Sesión | Un daemon 24/7 en un servidor | Una pestaña que el asesor abre |
| Si se cae | Reintenta solo, en bucle | No pasa nada: no hay nada corriendo |
| Qué ve WhatsApp | Un cliente no autorizado | Un usuario normal con la pestaña abierta |

**No hay vector de baneo por protocolo porque no hay protocolo propio.**

## Lo que sí puede detectar una página web

Un content script vive en un **mundo aislado**: la página no puede ver sus
variables ni sus funciones. Pero comparten el DOM, y por ahí hay señales
posibles. Lo que una página SÍ puede detectar:

| Señal | ¿La generamos? |
|---|---|
| Eventos sintéticos (`isTrusted: false` en clicks y teclas) | **No.** Nunca se simula un click ni una tecla |
| Mutaciones del DOM (vía su propio `MutationObserver`) | **No.** Nunca se escribe en el DOM de WhatsApp |
| Overrides de APIs del navegador | **No.** No se parchea nada |
| Recursos `chrome-extension://` accesibles desde la página | **No.** Sin `web_accessible_resources` |
| **Lecturas del DOM** | **Sí, y son indetectables**: no existe un evento "alguien leyó este nodo" |

Esa última fila es la que hace viable todo: **leer no deja rastro.**

## Las ocho invariantes — no negociables

Cada una lleva su test. Si se rompe una, se rompe el trato con el asesor y
vuelve el riesgo de baneo.

1. **No se envía nada, nunca.** La función de envío no existe en el código.
2. **No se inyecta en el contexto de la página.** Sin `world: "MAIN"`, sin
   `<script>` inyectado, sin acceso a `window.Store`, `WPP` ni `wa-js`. Eso es
   exactamente lo que hacían las 131 extensiones que Google removió.
3. **No se simulan eventos.** Ni un click, ni una tecla, ni un scroll
   programático. Todo evento sintético lleva `isTrusted: false` y es la señal
   más fácil de detectar que existe.
4. **No se muta el DOM de WhatsApp.** La extensión no dibuja nada dentro de la
   página; su interfaz vive en el popup.
5. **Solo grupos en lista blanca.** Un chat que el asesor no prendió no se lee.
   El default de todo grupo nuevo es *ignorar*.
6. **Cero chats 1:1.** Se descarta por `chatId` en la primera línea, antes de
   cualquier lectura, registro o envío al servidor.
7. **El ruido no sale del navegador.** El prefiltro léxico corre **en la
   extensión**: los mensajes sin señal inmobiliaria mueren en el equipo del
   asesor y nunca viajan.
8. **Sin `web_accessible_resources`.** No hay forma de que una página detecte
   que la extensión está instalada.

La invariante 7 es nueva respecto del diseño anterior y es la más importante
para vender esto puertas adentro: **~85% de lo que el asesor ve en sus grupos
nunca sale de su computador.**

## La limitación técnica que define el alcance

**WhatsApp Web solo renderiza en el DOM la conversación abierta.** El análisis
del CVE de Adobe lo confirma: *"messages that were not loaded or rendered are
not leaked"*. Con solo el DOM, la extensión lee el grupo que el asesor tiene
abierto y nada más.

Hay una segunda vía posible: **WhatsApp Web guarda los mensajes en IndexedDB**,
y la literatura forense de WhatsApp Web se basa precisamente en leer esa base
([MDPI](https://www.mdpi.com/1999-5903/12/11/184),
[ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S2666281724001884)).
Un content script puede abrir la IndexedDB de su propio origen sin tocar el DOM
ni la página — sería la lectura más completa **y la más silenciosa de todas**.

**Pero no está verificado que hoy sea legible**, y no lo voy a asumir. De ahí la
Fase 0.

### Fase 0 — la compuerta (1 día, sin escribir extensión de producto)

Una extensión de prueba, cargada localmente en el Chrome de Juan, con su propia
cuenta de WhatsApp, que responde una sola pregunta:

> ¿Se pueden leer los mensajes de un grupo **sin abrirlo**, desde IndexedDB?

| Resultado | Qué se construye |
|---|---|
| **Sí, legible** | Captura completa y automática: todos los grupos de la lista blanca, sin que el asesor abra nada. Es el producto que justifica la extensión. |
| **No** (cifrado o ilegible) | Captura oportunista: se lee el grupo que el asesor abre. Sigue siendo útil —él ya los abre para leerlos— pero es un complemento del export, no un reemplazo. **Ahí conviene evaluar si vale la pena.** |

**Sin este dato, cualquier estimación de alcance es una suposición.** La Fase 0
cuesta un día y se corre sobre una cuenta propia, no la de un asesor.

## Arquitectura

```
WhatsApp Web (pestaña del asesor)
  └─ content script (mundo aislado, SOLO lectura)
       · lista blanca de grupos
       · descarta 1:1 en la primera línea
       · PREFILTRO LÉXICO LOCAL  ← el 85% muere acá y nunca viaja
       └─ service worker (MV3)
            └─ POST cada ~60 s o 50 mensajes
                 → POST /api/grupos/importar-mensajes   (NUEVO, único código de servidor)
                      └─ mismo pipeline: dedup → classify → cruzar → señales → digest
```

**El backend no cambia.** El endpoint nuevo recibe el mismo shape que produce el
parser de exports (`{grupo, autor, texto, instanteIso}`) y llama al mismo
orquestador. Todo lo construido en los milestones 1–3 se reutiliza al 100%:
mismo hash de mensaje, mismo dedup, misma marca de agua, mismo digest.

**Reutilización literal:** `src/groups/prefilter.js` y `src/groups/lexico.js` se
portan a la extensión sin cambios (son puros; hay que extraer `zonaTokens` a
`src/lib/` para cortar la dependencia con Supabase).

### Autenticación

Un token por asesor, emitido desde el CRM y pegado en el popup de la extensión.
Scopeado a `org_id` + `advisor_id`. Revocable desde el CRM — es el nivel 1 de
reversibilidad.

## Distribución — la restricción que sorprende

**Chrome 149 (junio 2026) deshabilita automáticamente** las extensiones
sideloaded, las cargadas en modo desarrollador (unpacked) y las Manifest V2
([referencia](https://www.superchargebrowser.com/library/chrome-extension-disabled-after-update/)).

Consecuencias, sin vuelta:

- **Manifest V3 obligatorio.**
- **Hay que publicar en la Chrome Web Store.** El modo desarrollador sirve para
  la Fase 0 y nada más; no es una vía de distribución.
- La política empresarial es la única alternativa y exige Chrome gestionado —
  inviable para asesores independientes.

**Esto mete semanas de calendario** (revisión de Google) entre la decisión y el
primer asesor usándola.

### Cómo no parecerse a las 131 que Google removió

Las [131 extensiones removidas](https://thehackernews.com/2025/10/131-chrome-extensions-caught-hijacking.html)
lo fueron por tres motivos concretos, y ninguno nos aplica si respetamos las
invariantes:

| Por qué las removieron | Nosotros |
|---|---|
| Inyectaban en la página para automatizar **envío masivo** saltando los límites de WhatsApp | No enviamos. La función no existe |
| Eran **clones rebrandeados** del mismo código (política de spam de la Store) | Una sola extensión, un solo dueño |
| Violaban la política de mensajería de WhatsApp (mensajes no solicitados, sin opt-in) | No mandamos un solo mensaje |

Precedente favorable: **GistGem** está publicada en Chrome Web Store y en Edge
Add-ons haciendo exactamente esto —leer chats de WhatsApp Web y resumirlos con
IA— y procesa localmente. La categoría es aceptable para Google.

Para pasar revisión: permisos mínimos (`host_permissions` solo
`https://web.whatsapp.com/*`), política de privacidad publicada, y la
descripción diciendo explícitamente que es de solo lectura.

## Riesgos residuales — declarados, no minimizados

| Riesgo | Realidad | Mitigación |
|---|---|---|
| **Zona gris de ToS** | Los ToS prohíben uso "automatizado". Leer tu propia pantalla es discutible, pero no está bendecido. **No hay ningún caso documentado de baneo por una extensión de solo lectura** — todos los casos conocidos son de envío | Solo lectura, volúmenes humanos, kill switch remoto por org |
| **Fragilidad del DOM/IndexedDB** | WhatsApp cambia sin avisar y la extensión se rompe en silencio | Selectores versionados + telemetría de "parser roto" + el export sigue vivo como respaldo |
| **Revisión de la Store** | Puede tardar o rechazarse | Invariantes + permisos mínimos + precedente GistGem |
| **La extensión es superficie de ataque** | El [CVE de Adobe](https://thehackernews.com/2026/07/adobe-acrobat-extension-flaw-let.html) expuso chats de WhatsApp Web por una extensión mal hecha | Sin `web_accessible_resources`, sin `externally_connectable`, sin listeners de `postMessage` desde la página |
| **Que el asesor desconfíe** | Es su WhatsApp | El prefiltro local es el argumento: *el 85% no sale de tu computador* |

## Lo que NO se construye

- **Envío por cualquier vía.** Cerrado en el diseño anterior, confirmado por el
  baneo, y ahora además es lo que hace que Google te saque de la Store.
- **Clicks programáticos para recorrer grupos.** Es la vía obvia para leer todo
  sin IndexedDB, y es exactamente lo que hacían las 131 removidas. Si la Fase 0
  falla, se acepta la captura oportunista o no se hace.
- **Cualquier reconexión automática.** No hay sesión que sostener: si el asesor
  cierra la pestaña, no pasa nada.

## Reversibilidad

| Nivel | Acción | Quién | Tiempo |
|---|---|---|---|
| 1 | Bajar un grupo a `ignorar` en el popup | El asesor | segundos |
| 2 | Revocar el token desde el CRM | Juan | segundos |
| 3 | **Desinstalar la extensión** | El asesor, solo | un clic |
| 4 | Cerrar la pestaña de WhatsApp Web | El asesor | un clic |

A diferencia de WAHA, **el nivel 4 es instantáneo y total**: no queda nada
corriendo en ningún lado. No hay servicio que bajar ni sesión que cerrar.

## Fases y compuertas

| Fase | Qué | Riesgo | Compuerta |
|---|---|---|---|
| **0** | Extensión de prueba local, cuenta de Juan: ¿IndexedDB es legible? | Cero — cuenta propia, sin asesores | Resultado binario; define el alcance |
| **1** | Extensión MV3 completa, solo Juan, 2 semanas | Muy bajo | 2 semanas sin una sola anomalía en la cuenta |
| **2** | Un asesor voluntario, con el trato explícito por delante | Bajo | 2 semanas más |
| **3** | Publicación en la Store y resto del equipo | Bajo | — |

**Nunca se salta la Fase 1.** El error de proceso del intento anterior fue ir
directo al activo más valioso —la línea de una asesora con 80 grupos— sin
canario. Esta vez el canario es la cuenta de Juan.

## Lo que se le promete al asesor

> La extensión **no puede escribir** en tu WhatsApp: esa función no está
> apagada, no existe. Solo lee los grupos que vos prendas, nunca tus chats
> personales. Y el filtro corre en tu computador: de cada cien mensajes de un
> grupo, unos ochenta y cinco se descartan ahí mismo y nunca salen. Lo que viaja
> es solo lo que parece un negocio.
>
> El interruptor lo tenés vos: desinstalás la extensión y se acabó, sin pedirle
> permiso a nadie.

## Decisión de secuencia

La extensión **automatiza la captura; no cambia el valor**. Y el valor sigue sin
estar medido: todavía no se ha procesado un solo grupo gremial real.

Como la Store se toma semanas de todos modos, lo sensato es paralelo:

1. **Esta semana, gratis:** un export real de 2–3 grupos por el flujo que ya
   funciona. Da el número que decide todo — cuántos pedidos reales calzan con el
   inventario.
2. **En paralelo:** Fase 0 de la extensión (un día), que define si el alcance es
   "todos los grupos" u "oportunista".

Con esos dos datos —valor real y alcance técnico— la decisión de invertir las
semanas de la Store se toma sabiendo, no apostando.
