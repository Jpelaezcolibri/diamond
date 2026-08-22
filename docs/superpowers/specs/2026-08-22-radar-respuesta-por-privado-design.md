# Radar: responder por privado al colega, no en el grupo

**Fecha:** 2026-08-22
**Estado:** diseño aprobado, pendiente de plan de implementación
**Pedido por:** Juan

## 1. Qué se quiere y por qué

Hoy el radar publica la respuesta **dentro del grupo gremial**, citando el mensaje
original (`reply_to`). Se cambia a responder **al privado del colega que publicó
el pedido**, y a no publicar nada en el grupo.

El motivo es una regla del gremio, no una preferencia: los grupos piden no
llenarlos de información y responder al interno. Publicar en el grupo es lo que
viola la norma, con riesgo de que expulsen a Diamond. Además, el detalle del
inventario deja de quedar a la vista de 80 competidores.

Esto **revoca** la decisión del 2026-08-20 documentada en `src/lib/waha.js`
(*"la tentación es escribirle al interno, pero eso es justo el patrón que más
reportes de baneo tiene"*). La revocación es deliberada y la razón es nueva: con
la norma del grupo a favor, un DM al colega que acaba de pedir algo no es un
mensaje frío — es la conducta que él espera, y el riesgo de que *reporte* la
línea (disparador más común del baneo) baja mucho. El riesgo de que WhatsApp
sancione al cliente no autorizado **no** desaparece; ver §8.

## 2. Lo que se midió antes de diseñar (2026-08-22, producción)

WhatsApp oculta el número de los participantes de un grupo detrás de un LID.
Lo que el radar venía guardando en `group_signals.autor_telefono` son LIDs
(14-17 dígitos), no teléfonos (12 en Colombia): 12 de 12 en las señales del día.

| Medición | Resultado |
|---|---|
| Lids API de WAHA (`/lids/{lid}`) | **0 de 45**. `/lids/count` no responde. Inservible en esta versión. |
| Lista de participantes (`pn`) | **~80% por grupo** (706/878 en Poblado, 660/819 en Envigado) |
| Colegas de señales reales resueltos por esa vía | **30 de 45 = 67%** |
| Índice LID→teléfono construido | **1.012 colegas distintos** |
| ¿La línea es admin de los grupos? | **Inconcluso** — no aparece en la lista (`yo_en_lista=false`) |

Validación cruzada: `Paraíso Inmobiliario sas` resolvió a `***6489`, y el número
que le reenvía pedidos a Sofi por la línea oficial es `573028536489`. Mismo
número por dos caminos independientes.

**Conclusión:** el 67% se atiende automático; el 33% necesita una persona. No
hace falta guardar contactos a mano, ni ser admin del grupo.

### 2.1 Volumen y cobertura (20 al 22 de agosto)

| | 20-ago | 21-ago | 22-ago (parcial) |
|---|---|---|---|
| Demandas | 74 | 68 | 15 |
| Con match | 33 | 26 | 5 |
| Respondidas en grupo | 21 | 23 | 0 |
| Avisadas al revisor | 2 | 2 | 3 |

De 14 señales con match que no registraron ninguna acción: **11 son del 20-ago,
anteriores a la versión actual del código** — el corte cae a las 16:00 de ese día,
cuando entró la columna `politica_motivo` y el aviso dejó de curarse por motivo.
Las otras 3 son de `origen=reenvio` y **sí se contestaron** en el chat directo
(verificado en `messages`: el pedido de las 12:51 tuvo respuesta a las 12:51:23);
su respuesta no vive en `respondida_at`, que es específico de publicar en grupo.

**El código actual no está perdiendo pedidos con match.** Lo que se ve como hueco
lo arreglaron los commits del 20 y 21 de agosto.

### 2.2 Un daño colateral del incidente del sync

El 2026-08-22 a las 16:00:20 y 16:00:27 UTC, la revisora tocó "Sí, publicar" en
dos avisos y el sistema respondió *"La candidata ya no pasa la compuerta de
calidad"* — por el inventario viejo, 90 segundos antes de que se corriera el sync
a mano.

O sea que un sync caído no solo calla al bot: **también anula a la persona que
intenta rescatar los pedidos a mano**. El camino manual no es un respaldo
independiente del automático — comparte la misma compuerta de calidad. Vale
tenerlo presente al diseñar cualquier cascada que termine en una persona.

## 3. La cascada

```
pedido con match publicable
├── ¿primer pedido de ese colega hoy Y tengo su teléfono Y hay cupo de ritmo?
│      └── SÍ  → DM al colega, un solo mensaje con TODOS los matches
│      └── NO  → aviso al revisor, con el mensaje listo para pegar
└── sin match publicable → aviso al revisor (como hoy)

en el grupo → NADA, nunca
```

**Ningún camino termina sin acción.** Es el principio que ya rige el módulo
(Juan, 2026-08-20: *"lo que no se responda por el bot debe de ir de una al chat
de natalia... no podemos dejar pasar ningún pedido"*). Los límites de §5 **no
descartan pedidos**: los desvían al revisor.

## 4. Componentes

### 4.1 `src/groups/directorio.js` (nuevo)

Resuelve LID → teléfono y es, a la vez, el respaldo de contactos.

- `telefonoDe(orgId, lid)` → string | null.
- Índice en memoria con la BD como respaldo: un reinicio no lo pierde.
- **Resolución perezosa:** si el LID no está, refresca los participantes de *ese*
  grupo (una llamada HTTP, no doce). Si sigue sin aparecer, devuelve null y no se
  vuelve a preguntar por un rato — un LID sin `pn` hoy tampoco lo tendrá en cinco
  minutos.
- Fuente: `waha.participantesDeGrupo` (ya existe). La Lids API queda como
  segundo intento por si una versión futura la arregla.

### 4.2 `waha.enviarDm(sesion, telefono, texto)` (nuevo)

La guarda actual de `enviarTexto` (solo `@g.us`) **no se afloja**. Se agrega una
segunda puerta explícita que valida que el destino sea un teléfono con formato
válido, no un chatId arbitrario. El test `group-canal` pasa de verificar "una
sola vía de salida" a "dos vías, cada una con su validación": el invariante se
mantiene verificable en vez de convertirse en un colador.

### 4.3 `politica.js` (extendido)

Los frenos viven donde ya vive el freno del sistema. Nuevos motivos de decisión,
todos los cuales **desvían al revisor**:

- `colega_ya_contactado_hoy` — segundo pedido del mismo colega en el día.
- `sin_telefono` — no se pudo resolver el LID.
- `ritmo_de_linea` — se alcanzó el tope diario de DMs de la línea.

### 4.4 `aviso-cercano.js` (extendido)

El aviso al revisor para los casos desviados incluye: nombre del colega, grupo,
texto del pedido, y **el mensaje ya redactado para copiar y pegar** (con el link
de §4.6 dentro). Más el recordatorio de que abre el privado tocando el nombre del
colega en el grupo — desde el teléfono no necesita el número, y por eso el 33%
tiene salida real.

**Quién es "el revisor".** Catherine Uribe atiende **las dos** líneas: la que está
a su nombre (`RADAR_REVISOR_PHONE`) y la que está a nombre de Natalia Vélez, que
es la vinculada al radar y la que está dentro de los grupos (`RADA-NATALIA`).
Por eso no hay problema de enrutamiento (Juan, 2026-08-22).

Queda un detalle operativo: el aviso llega a un número y la acción manual se
ejecuta desde el otro. Para no obligar a leer en un dispositivo y actuar en el
otro, **el aviso que pide acción manual en el grupo se manda al número de la
línea que está en los grupos**, vía `RADAR_DM_MANUAL_TO`, con fallback a
`RADAR_REVISOR_PHONE` si no está configurada. Si en la práctica es el mismo
teléfono, la variable se deja vacía y no cambia nada.

### 4.5 Respaldo de contactos (tabla nueva)

`colegas_grupos`: `org_id`, `lid`, `telefono`, `nombre`, `grupos`,
`primer_visto`, `ultimo_visto`.

Se escribe **cuando el colega publica un pedido que cruzamos** — no un barrido
preventivo de los 1.012. Da el respaldo donde dolería perderlo (los contactos con
los que hubo negocio) con una fracción de la exposición. Si banean la línea, los
números siguen ahí.

Migración en `db/migrations/`, a correr a mano en Supabase (este repo no tiene
`db:push`).

### 4.6 El puente a la línea oficial (Juan, 2026-08-22)

**Todo mensaje que salga —el DM automático y el que Catherine manda a mano—
lleva un link a la línea oficial de Sofi.** Es la pieza que sostiene el resto del
diseño, no un adorno:

```
DM por la línea del radar  →  incluye link wa.me a Sofi
      ↓  el colega hace click y escribe
conversación en la línea OFICIAL (Cloud API)
      ├── ventana de 24 h abierta → Sofi conversa sin riesgo de baneo
      ├── su número REAL queda capturado en el webhook
      ├── todo cae en el inbox del CRM → trazabilidad completa
      └── el vínculo sobrevive aunque baneen la línea del radar
```

Tres consecuencias que valen más que la feature original:

1. **La línea sacrificable pasa a ser solo el primer saludo.** La relación vive en
   la línea oficial, que no se puede banear por spam. El riesgo estructural de §8
   se acota a un mensaje por colega, en vez de a toda la conversación.
2. **El 33% se auto-resuelve con el uso.** Un colega cuyo LID no se puede resolver
   queda alcanzable para siempre en cuanto hace click una vez — por la vía segura.
   La cobertura deja de ser un techo del 67% y pasa a ser un piso que sube solo.
3. **El respaldo se llena de números reales**, no de LIDs, sin barrer a nadie.

**Cómo se construye el link, y por qué así.** El 2026-08-18 Sofi le mandó a
Catherine `https://wa.me/message/YOUR_CONTACT_LINK` — un placeholder inventado —
y de ahí salió la compuerta `validarMensaje.motivoDeBloqueo`. Entonces:

- El link lo arma **código**, nunca lo redacta la IA.
- Sale de una env nueva, `SOFI_WA_NUMERO` (el número público de la línea oficial;
  hoy solo existe `WHATSAPP_PHONE_ID`, que es el id de Meta, no el número).
- **Si esa env falta, el mensaje sale sin link.** Nunca con un link a medias: ya
  hay precedente de lo que pasa cuando algo así se cuela.
- El `text` prellenado incluye un marcador corto del pedido
  (ej. `Hola Sofi, soy colega — pedido #A3F2`), que es lo que permite reconocer al
  colega desde su primer mensaje.

### 4.7 Panel de colegas en Sofi (previsto, NO en este alcance)

Juan, 2026-08-22: *"crear un panel de sofi dedicado a colegas, que sepa que es un
colega quien le habla para que las soluciones y las respuestas estén más acordes
— esto último es para un futuro cercano"*.

No se construye acá. Lo único que este diseño aporta es **dejarlo posible**: el
marcador del `text` prellenado (§4.6) hace que la conversación nazca identificada
como colega, así que cuando ese panel se diseñe no tendrá que adivinar quién es
quién retroactivamente. Es una decisión de dos líneas hoy que ahorra una
migración de datos después.

### 4.8 Lo que NO se toca

- `redactar.mensajeGrupo` — el DM usa el mismo texto que hoy va al grupo, con
  todos los matches en un solo mensaje (`MAX_PROPIEDADES = Infinity`, Juan
  2026-08-20). Cambia el transporte, no el contenido.
- La compuerta de calidad (`publicable.js`) y la frescura del inventario: un dato
  no verificable sigue sin salir, al privado tampoco.

## 5. Límites

| Límite | Valor | Configurable |
|---|---|---|
| DMs por colega por día | 1 | `RADAR_DM_POR_COLEGA_DIA` |
| Cortacircuitos de la línea | 150/día | `RADAR_DM_MAX_DIA` |
| Antigüedad máxima del pedido | 30 min | `RADAR_DM_VENTANA_MIN` |

**El tope de 150 es un cortacircuitos, no una cuota.** Medido sobre los últimos
tres días (§2.1): ~30 matches diarios, de menos colegas distintos, y con la regla
de un DM por colega quedan **~17 DMs por día**. 150 no se toca en operación
normal; si se alcanza, no es que el negocio creció — es que algo se rompió y está
por costar la línea. Y como desvía en vez de descartar, alcanzarlo no cuesta un
solo pedido.

La ventana de 30 minutos existe porque un DM por un pedido de ayer se lee como
spam y es lo que se reporta.

**La antigüedad se mide contra la fecha del mensaje en el grupo** (el `timestamp`
que manda WAHA, ya normalizado en `fecha_mensaje`), no contra `created_at` de la
señal: si el bot estuvo caído dos horas y procesa un backlog al arrancar, esos
pedidos son viejos aunque la fila se acabe de escribir. Es la misma lógica del
corte temporal que ya protege al radar (`esAnteriorAlCorte`).

**Si el envío del DM falla**, el pedido se desvía al revisor igual que los demás
casos. Un `ok:false` de WAHA no puede terminar en silencio: sería el único camino
que deja pasar un pedido, justo lo que §3 promete que no pasa. Tampoco se
reintenta el DM — un reintento sobre un envío que quizá sí salió duplica el
mensaje, que es la conducta que hace que a uno lo reporten.

## 6. Fases

**Fase 1 — resolver y respaldar, sin enviar nada.** El directorio y la tabla de
respaldo corren en producción con el radar comportándose como hoy. A los dos días
se sabe si el 67% se sostiene con pedidos reales, sin haber mandado un DM.

**Fase 2 — encender el DM** con los frenos de §5 y el grupo en silencio.

El 67% viene de 45 colegas de un solo día. Encender envíos sobre esa muestra, con
la línea del radar en juego, es apostar más de lo necesario cuando esperar 48
horas no cuesta nada.

## 7. Pruebas

- `directorio`: resuelve por índice; refresca perezosamente una sola vez; null
  cuando el participante no trae `pn`; sobrevive a un reinicio leyendo de la BD.
- `enviarDm`: rechaza un chatId de grupo, rechaza basura, acepta un teléfono
  válido. `group-canal` actualizado a dos puertas.
- `politica`: los tres motivos nuevos desvían y **nunca descartan**.
- Cascada en `vivo.js`: con teléfono → DM; sin teléfono → aviso; segundo pedido
  del mismo colega → aviso; **DM que falla → aviso**; pedido más viejo que la
  ventana → aviso. En ningún caso se publica en el grupo, y en ningún caso se
  termina sin hacer nada.

## 8. Riesgo, dicho sin adornos

El DM desde un cliente no autorizado es el patrón que WhatsApp sanciona más
rápido, y **la línea de julio cayó solo leyendo**: la conducta no es lo único que
pesa, el cliente no autorizado pesa por sí mismo. Los límites de §5 y la norma del
grupo bajan el riesgo real; no lo eliminan.

El diseño asume que `RADA-NATALIA` es una línea **sacrificable**
(`whatsapp_sessions.rol = 'dedicada'`). Si algún día deja de serlo, esto se
revisa completo.

Con ~1.012 teléfonos de colegas al alcance, la tentación de usarlos para algo más
que responder a quien acaba de pedir será real. Cualquier otro uso sale del
propósito para el que se obtuvieron y entra de lleno en la Ley 1581 de 2012 —
más aún si el radar se vuelve producto para otras inmobiliarias.

## 9. Decisiones tomadas

| Decisión | Quién |
|---|---|
| Responder al privado, nada en el grupo | Juan, 2026-08-22 |
| Un solo mensaje con todos los matches | Juan, 2026-08-20 (ya en código) |
| El tope desvía al revisor, no descarta | Juan, 2026-08-22 |
| Segundo pedido del mismo colega → revisor | Juan, 2026-08-22 |
| Respaldo solo sobre interacción real | propuesto y aceptado, 2026-08-22 |
| Dos fases, la primera sin enviar | propuesto, 2026-08-22 |
| Todo mensaje lleva link a la línea oficial de Sofi | Juan, 2026-08-22 |
| Panel de colegas: previsto, fuera de alcance | Juan, 2026-08-22 |
| Tope como cortacircuitos (150), no como cuota | medido, 2026-08-22 |
| Catherine atiende ambas líneas: sin problema de enrutamiento | Juan, 2026-08-22 |

## 10. Lo que este diseño NO resuelve

- **El 59% de las demandas no tiene ningún match** (64 con match de 157 en tres
  días). Eso no es un problema de este flujo sino de inventario: no hay qué
  ofrecer. Avisar de cada una sería ruido — `aviso-cercano.construir` devuelve
  `null` sin candidatas, y así debe quedar.
- **Si el sync se cae, esta cascada también se cae**, incluido el camino manual
  (§2.2). El fix de los reintentos del sync es prerrequisito operativo de que
  este diseño sirva de algo.
- **El panel de colegas** (§4.7) queda solo habilitado, no construido.
