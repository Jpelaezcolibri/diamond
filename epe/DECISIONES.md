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

**D7 — El host lee la IndexedDB local, no el DOM.** *Resuelto el 2026-08-02 con
medición, no con diseño.*

La pregunta abierta era si WhatsApp Web solo tiene disponible la conversación
abierta —lo único que renderiza en el DOM— o si su base local guarda todo. Se
midió en una sesión real, **sin ningún chat abierto**:

```
model-storage.message      29.597      chat      342
group-metadata                 21      contact  5.766
fts-storage.fts-v3-index    7.865
```

Con cero conversaciones abiertas hay casi 30.000 mensajes de 342 chats
guardados localmente, y WhatsApp mantiene además su propio índice de búsqueda
de texto completo — o sea que los guarda **en claro**.

*Consecuencia:* el host lee todos los grupos de la lista blanca sin abrir
ninguno. No hay que rotar conversación por conversación, que era la alternativa
cara: más lenta, visible para el asesor, y con mucha más superficie de
comportamiento anómalo.

**D8 — `signal-storage` es intocable.** La misma medición mostró que el
navegador guarda el material criptográfico de la cuenta:

```
signal-storage: identity-store 1.264 · prekey-store 808 ·
                session-store 6 · signed-prekey-store 1
```

Son las llaves del cifrado punta a punta. **El host abre exclusivamente
`model-storage`**, y dentro de ella solo los almacenes que necesita. Ninguna
otra base se abre, ni siquiera para contar.

No hace falta nada de ahí: los mensajes ya están descifrados en
`model-storage`. Leer esas llaves no daría ninguna capacidad nueva y convertiría
un lector pasivo en algo que sí puede comprometer la cuenta del asesor — o sea,
exactamente lo que P1 existe para impedir.

*Se protege con un test* cuando se escriba el lector: la lista de bases y
almacenes permitidos vive en una constante, y el test falla si crece.

## Abierto

- **Forma del registro de mensaje.** Qué campos trae cada fila de
  `model-storage.message` — dónde vive el texto, el autor y el jid del grupo.
  Es implementación del lector, no arquitectura: no cambia ninguna decisión de
  arriba.
