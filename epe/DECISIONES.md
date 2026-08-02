# EPE — decisiones congeladas

Las decisiones de arquitectura se toman una vez; las de implementación se
refinan continuamente. Este archivo es la memoria de las primeras.

**Toda decisión permanente está protegida por un test.** Si un principio no puede
romper un test, todavía no es un principio.

## Qué es el EPE

El núcleo de procesamiento local del Radar de Grupos. **No** es un framework
multi-plataforma, **no** es un sistema de adaptadores, **no** es una arquitectura
extensible. Hoy tiene un único host: WhatsApp Web. Si aparece un segundo host
real, la arquitectura se revisa en ese momento — no antes.

## Principios que este módulo hace cumplir

| | Principio | Test que lo protege |
|---|---|---|
| P1 | El dispositivo es la frontera de confianza | `epe-core`: el núcleo funciona sin `grupo`, sin `org_id`, sin identidad |
| P3 | El contenido no sale del dispositivo salvo justificación | `epe-core`: `procesar()` no devuelve lo descartado · `metricas.tasaDescarte` mide cuánto se queda |
| P4 | Lo que pueda ser local, es local | `prefilter-puro` + `epe-bundle`: el núcleo corre en un contexto sin `require` ni `process` |
| P6 | La extensión nunca escribe ni toca el DOM | `prefilter-puro` + `epe-bundle`: prohibido `fetch`, `chrome.*`, `document.*` en toda la cadena |
| P7 | Un solo host, YAGNI estricto | `prefilter-puro`: la cadena de dependencias está congelada en 6 archivos |

## Decisiones

**D1 — El código no se mueve de carpeta.** `epe/core/index.js` es la entrada
pública; los módulos puros siguen en `src/`. La garantía que importa —que el
núcleo no arrastre `node:*`, Supabase ni `process.env`— la da un test, no la
ubicación. Mover archivos compraría claridad simbólica al precio de churn.

**D2 — Hash sobre WebCrypto, no `node:crypto`.** El núcleo corre en dos
runtimes y `globalThis.crypto.subtle` existe en ambos. Una sola API, sin ramas.
*Sacrificio:* es asíncrono, así que todo lo que hashea es `async`.
*Congelado para siempre:* el formato de la semilla de `idDeMensaje`
(`grupo|instante|autor|plano(texto)`), el prefijo `export:` y el truncado a 40
hex. Están persistidos en `group_signals.wa_message_id`; cambiarlos huerfaniza
las filas existentes y cada mensaje ya visto se reprocesa como nuevo, sin que
nada falle ruidosamente. Lo congela `epe-hash` con vectores fijos generados por
la implementación vieja.

**D3 — El bundle se genera, no se copia.** El léxico se va a tunear. Una copia
manual diverge en silencio: el sensor descartaría cosas que el servidor habría
aceptado — falsos negativos invisibles, el fallo más caro del sistema. El bundle
sale del mismo archivo que usa el servidor, así que divergir es
estructuralmente imposible.

**D4 — `procesar()` no devuelve lo descartado.** Auditar falsos negativos se
hace con `metricas.porMotivo`, que da la misma señal sin arrastrar el texto.
Devolver los mensajes enteros creaba un array con contenido de terceros sin
consumidor: solo una oportunidad de que alguien lo loguee o lo mande a algún
lado.

**D5 — Orden de las etapas: corte → dedup → prefiltro.** No es arbitrario.
Invertir dedup y prefiltro costaría prefiltrar repetidos; invertir corte y dedup
costaría hashear mensajes que el corte iba a tirar igual.

**D6 — El tope se evalúa después del corte.** Un export de tres años con marca
de agua de ayer trae dos mensajes, no cien mil. Evaluarlo antes rechazaría
cargas legítimas.

## Abierto

- **Alcance de la captura.** WhatsApp Web solo renderiza en el DOM la
  conversación abierta. Si la IndexedDB local resulta legible, el host lee todos
  los grupos de la lista blanca sin abrir ninguno. Lo responde
  `extension-spike/`, que está construido y sin correr. **No afecta al EPE**: el
  núcleo procesa mensajes ya capturados, venga de donde venga.
