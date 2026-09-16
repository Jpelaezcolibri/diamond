# Los avisos a la asesora: qué le llega y qué deja de llegarle

**Fecha:** 2026-09-15
**Decisión de:** Juan
**Estado:** aprobado. §3.2 (dedupe por huella) y el interruptor `RADAR_ALERTA_ATASCADA` implementados el 2026-09-16; §5–§7 el 2026-09-15 (c0de219). Pendiente: §2.2 resto, §2.3, §3.1 y §4.

## 1. El problema

El 15 de septiembre, entre las 7:41 a. m. y las 7:11 p. m., a Daiana le
llegaron más de cien mensajes del bot. La enorme mayoría era la misma frase
repetida:

> ⚠️ El pedido de joan alexis gutierrez sanchez tiene propiedades que Sofi
> marco utiles y lleva 1421 min sin salir ni al colega ni a la asesora.

Juan: *"al parecer es un bug, no tiene por qué mandar tantos mensajes, los
mensajes de recordación no los sigas enviando, al parecer nadie los revisa"*.

Son dos problemas distintos y los dos hay que resolverlos.

### 1.1. El bug

`src/scheduler/radar-watchdog.js#avisar` no repite un aviso solo si coinciden
**la clave y el texto**:

```js
if (avisado.get(p.clave) === p.texto) continue; // ya avisado, sin novedad
```

El texto del pedido atascado lleva los minutos adentro
(`src/data/salud.js:335`): `1222 min`, `1252 min`, `1282 min`. Cambia en cada
pasada, así que **nunca coincide y el aviso vuelve a salir cada 30 minutos**,
por cada señal, hasta que la señal cumple 24 h y sale de la ventana del
chequeo. Los tres "joan alexis" del log son tres señales distintas del mismo
colega, cada una con su propio ciclo.

El mismo mecanismo produce el otro ruido del día:
`Radar: se normalizo lo de "atascada:fdaa59b7-f26b-4f06-b5b0-c01c583a0793"`.
Es el aviso de que el problema se resolvió, con un UUID que no le dice nada a
una persona.

### 1.2. La política

Aunque no repitiera, nadie revisa ese aviso. La decisión de Juan es que la
asesora reciba **solo lo accionable**: el DM que salió, el colega que pide
hablar con una persona, y las citas. Todo lo demás vive en el CRM.

## 2. Lo que decide este documento

### 2.1. Se queda (5 corrientes)

| Corriente | Dónde vive | Cambio |
|---|---|---|
| Copia de cada DM al colega | `alerta-asesor.js#construirAvisoPostDm` | **Pasa a salir siempre** (hoy solo si quedó algo pendiente) |
| Colega que pide una persona | `tools.js#pedirContactoAsesora` | Disparador ampliado (§5) |
| Citas y visitas | `citas-recordatorio.js`, `visitas-venta.js` | Sin tocar |
| "Tu ventana de 24 h cierra en N h" | `salud.js#ventanasAsesoras` | Sigue yendo a la asesora |
| "Sofi aprobó y no pude escribirle al colega" | `alerta-asesor.js#construir` | Sigue, solo el caso aprobado |

### 2.2. Se apaga (4 corrientes)

| Corriente | Dónde vive | Interruptor |
|---|---|---|
| Pedido atascado + sus "se normalizó" | `salud.js#senalesAtascadas` (chequeo 5) | `RADAR_ALERTA_ATASCADA` |
| "🎯 Oportunidad en un grupo" (solo dudosas) | `alerta-asesor.js#construir` | `RADAR_AVISO_REVISAR` |
| "🔔 Un pedido del radar no salió solo" | `aviso-cercano.js#construir` | `RADAR_AVISO_REVISAR` |
| Cierre del día de las 6 p. m. | `scheduler/cierre-dia.js` | `RADAR_CIERRE_ENABLED` (existe; cambia el default) |

Las dos familias de "decidí vos" se apagan con el **mismo** interruptor
a propósito: son la misma decisión de negocio, y separarlas invita a que una
quede prendida por olvido.

### 2.3. Se muda a Juan

Cliente en modo humano sin respuesta, Meta rechazando envíos, mensajes
duplicados, volumen anormal de avisos, inventario viejo y sesión de WAHA
caída. No son recordatorios: significan que algo está roto. Dejan de ir a la
línea comercial.

## 3. Cómo se apaga

**Con interruptor, no borrando código.** Regla de Juan de septiembre de 2026
(`feedback-interruptor-sin-excepciones`): un interruptor apaga el carril
completo. Cada variable tiene default **apagado**, de modo que el
comportamiento nuevo es el que sale sin configurar nada, y devolver una
corriente no necesita un deploy de código.

### 3.1. El ruteo del vigilante

`salud.js#problemas` hoy devuelve `{clave, texto}`. Pasa a devolver
`{clave, texto, huella, destino}`, donde `destino` es `"asesora"` o
`"tecnico"`. El único `"asesora"` es la ventana de 24 h; todo lo demás es
`"tecnico"`.

`radar-watchdog.js#avisar` reparte según ese campo: `"tecnico"` a
`RADAR_WATCHDOG_TO` (el número de Juan), `"asesora"` al teléfono de la
asesora que el propio chequeo ya resuelve. No es una lista de destinos nueva:
es el mismo vigilante clasificando lo que ya sabe.

### 3.2. El arreglo del dedupe

Se arregla **aunque el chequeo que lo destapó se apague**: cualquier chequeo
futuro que meta un contador en el texto reproduce el diluvio exacto.

Cada problema declara una `huella` estable —sin números que corran— y el
dedupe compara por `huella`, no por `texto`. Para el pedido atascado la huella
es `atascada:<id>` sin los minutos; para la ventana,
`ventana:<phone>:<estado>`, que sí cambia cuando pasa de "por cerrar" a
"cerrada" — que es justo cuando vale la pena volver a avisar.

Los avisos de resolución pasan a hablar en castellano. En vez de
`se normalizo lo de "atascada:<uuid>"`, cada problema trae un texto de cierre
propio; el que no lo traiga, no avisa que se resolvió. El silencio es
preferible a un UUID.

## 4. La copia post-DM

`construirAvisoPostDm` hoy devuelve `null` cuando no hay dudosas ni faltantes
— es decir, **cuando el DM salió perfecto la asesora no se entera de nada**.
Se invierte: sale siempre que haya salido al menos un mensaje al colega.

```
✅ Le mandé por privado a Alberto Posada: Ref 10013037

Grupo: PEDIDOS INMOBILIARIOS
Contacto: https://wa.me/573113345468

Busca: venta · apartamento · Laureles · hasta $550.000.000 · 2 alcobas
Lo escribió así:
"Pedido código 21899 / Apto dos alcobas cómodo..."

Le mandé:
▸ Ref 10013037 — Vendo Apartamento en San Joaquín, Laureles
  Laureles · 78 m² · 2 alcobas · $480.000.000
  https://info.wasi.co/apartamento-venta-laureles-medellin/10013037

Seguile la respuesta por el DM. Si te contesta, contame en qué quedó.
```

Los bloques que ya existen —`🔎 Esto otro quedó sin mandar`, `⚠️ WhatsApp
cortó el envío`, `Por qué no se las mandé`— se siguen agregando abajo cuando
aplican. El único bloque nuevo es `Le mandé:` con las fichas que salieron.

**Respeta el freno de ritmo**, igual que hoy: si a la asesora se le escribió
hace menos de `VENTANA_MIN`, la copia queda en `cola-post-dm.js` y la bandeja
de salida la entrega agrupada. Con esto, la ráfaga de Jaime (8 pedidos en 2
minutos) sigue saliendo como un mensaje, no como ocho.

**El cierre cambia de sentido.** Hoy dice "Contame en qué quedó" en un aviso
que le pedía actuar. Ahora su trabajo es seguir la respuesta del DM, y el
texto lo dice así.

## 5. El escalado ampliado

Juan: *"si el colega da alguna señal de que solo quiere hablar con un asesor,
inmediatamente le envías el mensaje a Daiana"*.

`pedir_contacto_asesora` **no cambia de código**. Cambia el prompt del colega:
además del pedido explícito, se listan las señales indirectas —se queja de que
no le responden, insiste después de un "no puedo", pide algo fuera del alcance
de Sofi (corregir un dato de Wasi, negociar comisión, fotos que no existen)—
y se cierra con *ante la duda, escalá*.

Conserva su tope de uno por colega cada 15 minutos: sin él, un colega
insistente genera cinco mensajes. Y sigue siendo **el único aviso del radar
que se salta el freno de ritmo**: sale en el momento. Es deliberado y es la
excepción declarada a la regla del 14 de septiembre ("todo camino nuevo que le
escriba a la asesora pasa por `ritmo.puedeEnviar`"), porque un colega
esperando a una persona no puede quedar en una cola.

## 6. El hueco del pedido directo

### 6.1. Qué pasa hoy

`tools.js#avisarDemandaColegaInmediata` guarda una marca en memoria y
**descarta** el aviso si ese colega ya generó uno en los últimos 15 minutos.
El motivo era bueno: Adriana recibió dos avisos del mismo colega con 32
segundos de diferencia, porque el colega sumó detalle en un segundo mensaje.

Pero cuando el colega manda un pedido **distinto** dentro de esos 15 minutos,
el aviso se descarta igual — y Sofi ya le dijo que lo iban a contactar. La
promesa queda sin respaldo.

### 6.2. La solución

El descarte se reemplaza por una acumulación, y la cola es la base de datos,
no la memoria.

El pedido **ya queda persistido en `group_signals`** antes de que se evalúe el
aviso. Entonces avisar deja de ser una decisión binaria:

- Si el freno de ritmo lo deja pasar y el colega no tiene un aviso reciente
  → sale ahora y se marca `enviado_at`.
- Si no → **no se descarta**: la señal se queda con `enviado_at` en null y la
  bandeja de salida (`avisos-salida.js`, corre cada minuto) la levanta en la
  próxima pasada y la entrega agrupada con lo demás.

Se conserva el anti-ráfaga —la asesora no recibe dos mensajes con 32 segundos
de diferencia— y el segundo pedido ya no desaparece. Y como la cola es la
base y no un `Map`, **un reinicio de Railway ya no borra un contacto**.

El `Map` `avisosDemandaRecientes` deja de ser el mecanismo de descarte y pasa
a ser solo el anti-ráfaga: si ya hay un aviso reciente, no manda **ahora**,
pero deja la señal pendiente.

### 6.3. Lo que hay que tocar en la bandeja

`avisos-salida.js` hoy filtra las señales con
`revalidar.apruebaAviso(s.revalidacion)`. Un pedido directo de un colega no
tiene revalidación, así que con ese filtro nunca se levantaría. Necesita una
rama explícita para el pedido directo. **Sin esto el arreglo no funciona y
falla en silencio**, que es exactamente el modo de falla que este repo
persigue.

## 7. Las contradicciones del prompt

Juan: *"asegurate de que el prompt no tenga órdenes que invaliden esta o que
tenga órdenes que se contradigan"*.

### 7.1. La real, y es la que bloquea §5

`src/agent/prompts.js:115`, en el prompt del colega, dice las dos cosas en la
misma línea:

> NUNCA le ofrezcas "conectarlo con un asesor" por tu cuenta: el es asesor.
> Pero si EL pide hablar con una persona del equipo (...), usa
> `pedir_contacto_asesora`.

Hoy conviven porque el disparador es explícito: el colega lo pide, Sofi
obedece la segunda mitad. **Al ampliarlo a señales indirectas, el NUNCA de
arriba gana**: frente a un colega frustrado que no pidió nada textualmente,
Sofi va a leer "no lo ofrezcas" y no va a escalar. La ampliación del §5 no
funciona sin arreglar esto.

Se reescriben como una sola regla: no se lo ofrecés como se le ofrece a un
cliente ("¿querés que te conecte con un asesor?"), pero escalás apenas dé
señal de que quiere una persona.

### 7.2. Las que crea este cambio

**El bloque del cierre del día.** `prompts.js:51-54` le enseña a Sofi a
responder un mensaje que va a dejar de existir, y `registrar_resultados_cierre`
(`tools.js:260`) devolvería "No encuentro un cierre del día reciente". Sale el
bloque del prompt y la herramienta del set del asesor.

**La calibración se queda sin fuente.** Con el cierre del día apagado y los
avisos de "decidí vos" apagados, la copia post-DM es **lo único** que le pide
un resultado a la asesora. Por eso el "contame en qué quedó" se queda ahí y
`registrar_resultado_radar` no se toca.

### 7.3. La menor

`tools.js:301` cita el aviso como *"Tenés un match del radar que no salió
solo"*; el encabezado real es *"Un pedido del radar no salió solo"*. Se alinea
el texto para que el disparador coincida con lo que de verdad llega.

## 8. Qué no toca este cambio

- El DM al colega en sí: sigue partido en presentación + una ficha por
  propiedad, con sus 4 s entre mensajes y su regla de no reenviar en 7 días.
- El motor de match, la revalidación y el clasificador.
- `RADAR_AMOBLADO_ACTIVO`, que sigue en `false`.
- El CRM: todo lo que se apaga sigue viéndose en `/grupos` y en el feed de
  comando. Se apaga el WhatsApp, no el registro.

## 9. Cómo se verifica

1. **El dedupe**: un test que corra el vigilante dos veces con el mismo
   problema y los minutos distintos, y afirme **un solo** envío. Ese test
   falla hoy.
2. **La copia post-DM**: un test con un DM completo y sin dudosas que afirme
   que el aviso **no** es `null` y que nombra las refs enviadas.
3. **El ruteo**: un test que afirme que la ventana de 24 h va al teléfono de
   la asesora y el sync viejo a `RADAR_WATCHDOG_TO`.
4. **El pedido directo**: un test con dos pedidos del mismo colega dentro de
   la ventana que afirme que el segundo queda pendiente, no descartado.
5. **En producción, a las 24 h**: que a la línea de Daiana no haya entrado
   ningún mensaje que empiece con `⚠️ El pedido de`.
