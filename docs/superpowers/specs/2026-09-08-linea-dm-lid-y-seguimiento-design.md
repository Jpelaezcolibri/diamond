# La línea de Natalia: abrir la puerta al @lid y el panel de seguimiento

**Decisión de Juan, 2026-09-08.** Diseño aprobado en conversación; este
documento es la fuente de verdad de lo acordado. Implementación en un plan
aparte.

## 1. El caso que lo motivó

Hoy hay una visita a las 10:00 que se coordinó por la línea de Natalia — la
misma línea por la que el radar manda los DM a los colegas. Juan: *"yo no
tengo ni idea de qué está pasando con la aplicación"*. Y el panel
"Posibles ventas" del CRM lleva en cero desde que existe.

Verificado contra producción el 2026-09-08 (`railway run --service diamond`,
solo lectura):

- `linea_dm` tiene **0 filas en toda su historia**. El "Inbox de la línea"
  del CRM dice *"Todavía no llegó ningún mensaje directo"* porque es verdad:
  nunca se guardó ninguno.
- `visita_venta_alertas` está vacía. El cruce diario de las 8h corre (la
  variable `RADAR_VISITAS_ALERTA_TO` sí está en Railway) y siempre encuentra
  cero.
- Solo existen **3 citas** en `leads.cita` (12-jul, 12-jul, 4-sep). Las tres
  con `property_ref_origen = NULL`, las tres con `estado: "solicitada"` —
  un estado que `src/data/citas.js` no conoce.
- La cita de hoy no está en `leads.cita` ni en `linea_dm`.

## 2. La causa raíz

**Los DM salen a `@lid`, pero el webhook solo deja entrar `@c.us`.**

- `src/groups/politica.js#decidirDm`: `via = lidDigitos.length >= 10 ? "lid"
  : telefono ? "telefono" : null`. El lid gana siempre que exista. En los 82
  DM con destino registrado desde el 4-sep, los 82 tienen lid.
- `src/channels/whatsapp-group.js`: `esDM = chatId.endsWith("@c.us")`.
- INVARIANTE 1 descarta todo lo que no sea `@g.us` ni `@c.us` **antes de
  cualquier log, consulta o escritura**.

Cuando un colega contesta a un DM que salió por lid, su respuesta llega con
chatId `<lid>@lid` y muere en la primera línea, en silencio. Está probado que
enviamos por lid, que el filtro descarta `@lid` y que la tabla está vacía;
que la respuesta llegue etiquetada `@lid` es la inferencia que cierra el
caso, y se confirma en el primer despliegue mirando los eventos crudos.

**Consecuencia:** todo lo que se construyó el 2026-08-21 aguas abajo de esa
puerta —el inbox, el clasificador de avances (`src/groups/dm.js`), la alerta
de cita, el cruce de posibles ventas por `linea_dm`— **está escrito y nunca
ha corrido ni una vez.** No hay backfill posible: lo descartado no quedó ni
en log.

## 3. Lo que hoy existe, verificado en el código

Casi todo. Esta spec **extiende**, no construye:

| Pieza | Dónde | Estado |
|---|---|---|
| Tabla del inbox | `db/migrations/2026-08-21_linea_dm.sql` | Corrida. `texto` nullable, campos de clasificación nullable. |
| Alta con dedup, hilo, clasificación, marca de alerta | `src/data/linea-dm.js` | Completo. Todo resuelve por `remitente_telefono`. |
| Procesamiento + clasificador Haiku + alerta | `src/groups/dm.js#procesarMensaje` | Completo. Siempre clasifica; no hay interruptor. |
| Atribución al pedido | `src/data/group-signals.js#buscarPorTelefono` | Busca `autor_telefono`. No sabe de lids. |
| Auditoría del destino del DM | `group_signals.respuesta_destino_lid / _telefono` | Migración 2026-09-04 corrida. 82 filas con lid. |
| Inbox del CRM | `crm/components/linea-dm-inbox.tsx` + `grupos/page.tsx` | Completo. Agrupa por `remitente_telefono`, pinta etiquetas de avance, resuelve `pedido_original`. Admin-only. |
| Cruce "Posibles ventas" | `src/data/visitas.js#recientes` | Lee `linea_dm.tiene_cita`. Nunca encontró nada. |

**Bug latente, independiente del filtro:** `whatsapp-group.js#procesarDM`
hace `remitenteTelefono: soloDigitos(ev.chatId)`. Con un chatId `@lid` eso
mete los dígitos de un lid en `remitente_telefono` — el error que el
comentario de `respuesta_destino_lid` (2026-09-04) advierte. Arrastra:
`buscarPorTelefono` no encuentra la señal, `senal_id` queda NULL, el panel
no puede ligar el hilo con el pedido ni con la propiedad, y el hilo se
agruparía bajo un "teléfono" que no lo es.

## 4. Decisiones

1. **Orden de las fases: leer → citas → tiempos → tasa.** Juan, 2026-09-08:
   *"por ahora solo leer, luego las citas, luego medir los tiempos de
   respuestas, luego medir si se responde o no"*. La meta es *"un panel que
   ayude con los seguimientos de las propiedades"*.
2. **Se guarda el texto desde la fase 1.** No es decisión nueva: la migración
   del 2026-08-21 la tomó con confirmación explícita (*"que los guarde
   todos"*), porque la línea es 100% dedicada al radar, sin uso personal.
   Si ese uso cambia, se revisa todo esto de nuevo.
3. **Lo nuevo en privacidad es aceptar `@lid`.** Se amplía INVARIANTE 1 de
   forma acotada: entran grupos en lista blanca y chats 1-a-1 por cualquiera
   de los dos direccionamientos. Broadcast, status y canales siguen sin
   existir. Merece la misma documentación que la decisión de agosto: es la
   misma invariante.
4. **Atribución al DM más reciente de ese colega.** Sin ventana de tiempo.
   Juan aceptó el riesgo: dos DM seguidos al mismo colega atribuyen la
   respuesta al segundo.
5. **El clasificador se apaga con un interruptor** y se enciende en la fase
   2. Fase 1 es leer, no interpretar — y no suma costo de API mientras no
   haga falta.
6. **El panel se arma por hilo** (colega + pedido + propiedad), no por
   mensaje. Las fases 2-4 agregan columnas al hilo; no rehacen el panel.
7. **El panel lo ve todo el equipo, no solo admin.** Hoy el inbox es
   admin-only con el argumento de que "es la misma línea sensible". Pero
   *seguimiento de propiedades* es trabajo diario de las asesoras (Natalia
   atiende esa línea). Se abre con el mismo criterio que
   `/api/grupos/venta`: leer y marcar avisos no es una decisión sobre la
   privacidad de nadie. La política RLS `team read` ya lo permite.

## 5. Fase 1 — Leer (lo que se construye ahora)

### 5.1 La puerta — `src/channels/whatsapp-group.js`

- `esDM` acepta `@c.us` **o** `@lid`.
- `procesarDM` deja de fabricar un teléfono desde el chatId. Construye una
  **identidad** con el sufijo intacto:
  - `remitenteId`: el chatId crudo (`<digitos>@lid` o `<digitos>@c.us`).
  - `remitenteTelefono`: solo si el chatId es `@c.us` **y** pasa
    `esCelularColombiano`; si no, `null`.
  - `remitenteLid`: solo si el chatId es `@lid`; si no, `null`.
- La cola por remitente (`enqueue("dm:...")`) usa `remitenteId`, no los
  dígitos, para que un lid y un teléfono con los mismos dígitos no se pisen.
- El comentario de INVARIANTE 1 se reescribe para decir la verdad nueva:
  dos direccionamientos de chat 1-a-1, con fecha y motivo.

### 5.2 La identidad — `db/migrations/2026-09-08_linea_dm_lid.sql`

```sql
alter table linea_dm add column if not exists remitente_lid text;
comment on column linea_dm.remitente_lid is
  'Lid crudo (<digitos>@lid) cuando el chat llego por direccionamiento oculto. Excluyente con remitente_telefono: un mensaje tiene uno u otro, nunca los dos.';
create index if not exists idx_linea_dm_remitente_lid
  on linea_dm (org_id, remitente_lid, created_at);
```

Idempotente, correr a mano en Supabase, verificar por REST antes de
declararla corrida (regla del CLAUDE.md).

`src/data/linea-dm.js`:
- `create` recibe `remitenteLid` y lo guarda. `remitente_telefono` solo
  recibe teléfonos reales.
- `historialDe` y `ultimaCitaAlertada` reciben una **identidad**
  `{ telefono, lid }` y filtran por la que exista. Firma nueva; las llamadas
  actuales (solo `dm.js`) se actualizan. Si faltara la columna (migración
  sin correr), la consulta por lid devuelve vacío y avisa una vez por
  proceso, igual que `avisarFaltaTabla`.

### 5.3 La atribución — `src/data/group-signals.js`

- `buscarPorLid(orgId, lid)`: la señal más reciente con
  `respuesta_destino_lid = lid` (crudo, con sufijo, tal como lo guarda
  `marcarRespondida`). Devuelve las mismas columnas que `buscarPorTelefono`.
- `buscarPorTelefono` pasa a mirar **también** `respuesta_destino_telefono`,
  no solo `autor_telefono`: un colega puede haber publicado con lid y
  contestar desde un `@c.us` si WhatsApp lo expone en el privado.
- `dm.js#procesarMensaje` elige: lid → `buscarPorLid`; teléfono →
  `buscarPorTelefono`. Ambas devuelven "la más reciente" (decisión 4).

### 5.4 El interruptor — `src/groups/dm.js`

- `RADAR_DM_CLASIFICAR` (default `false`). Apagado: `procesarMensaje` guarda
  el mensaje, resuelve la señal, y termina con `{ resultado: "guardado" }`.
  No llama a Anthropic, no escribe clasificación, no alerta.
- Se agrega a `.env.example` junto a `RADAR_VISITAS_ALERTA_TO`, con una línea
  que diga que encenderlo es la fase 2.
- Al arrancar, el log dice el estado (`[linea-dm] clasificador apagado —
  fase 1, solo lectura`), como hacen los otros carriles.

### 5.5 El panel — `crm/components/linea-dm-inbox.tsx` + `grupos/page.tsx`

Se extiende el componente existente:

- **Agrupación por identidad**: la clave del hilo es `remitente_lid ??
  remitente_telefono`. `anclaHilo` recibe la identidad (afecta
  `calendar-events.ts`, que arma el link "ver chat" — se actualiza en el
  mismo cambio).
- **Cabecera del hilo**: nombre del colega · pedido original (ya se
  resuelve) · **ref y título de la propiedad** que se le ofreció, leídos de
  `group_signals.respuesta_refs[0]` → `properties`. Esto es lo que lo hace
  "seguimiento de propiedades". Sin ref: "sin propiedad ligada".
- **Cuándo salió el DM**: `group_signals.respondida_at` del hilo.
- **Columnas de las fases siguientes, ya presentes, en gris con guion:**
  estado de cita (fase 2), tiempo hasta la primera respuesta (fase 3). No se
  calculan todavía; están para que el panel no cambie de forma cuando se
  llenen.
- **Se quita el candado admin-only** de la consulta en `page.tsx` (decisión
  7). "Posibles ventas" se queda como está.
- Vacío: el texto actual ("Todavía no llegó ningún mensaje directo") se
  mantiene, con una segunda línea: *"Los mensajes se guardan desde el
  despliegue del 2026-09-08; antes de esa fecha no quedó registro."*

### 5.6 Lo que NO se toca en fase 1

- `src/data/visitas.js` y el cruce de posibles ventas. Empezarán a encontrar
  filas solos cuando la fase 2 llene `tiene_cita`.
- `leads.cita` y su `estado: "solicitada"` fuera de la máquina de estados.
  Es real y hay que arreglarlo, pero es otra spec: no depende de esta puerta.
- Ninguna vía de **envío**. Esto solo lee.

## 6. Fases siguientes (diseño, no implementación)

- **Fase 2 — Citas.** `RADAR_DM_CLASIFICAR=true`. El clasificador existe
  (`dm.js#clasificarAvance`); la fase consiste en verificarlo contra hilos
  reales, no en escribirlo. Con eso `visitas.js#recientes` empieza a ver
  visitas de colegas y "Posibles ventas" deja de estar en cero por sí solo.
  Riesgo conocido: el prompt asume `[fecha] texto` por mensaje; con hilos
  reales puede necesitar ajuste. Se mide antes de confiar.
- **Fase 3 — Tiempos.** Por hilo: `min(linea_dm.fecha_mensaje)` −
  `group_signals.respondida_at`. Los dos datos ya se guardan; es una columna
  calculada en el panel.
- **Fase 4 — Tasa.** Denominador: señales con `respuesta_destino_lid` o
  `respuesta_destino_telefono` no nulo (**no** `respuesta_modo='auto'`, que
  está inflado con publicaciones en grupo — 182 vs 82 hoy). Numerador: de
  esas, las que tienen al menos una fila en `linea_dm`. Un colega con tres
  mensajes cuenta uno.

## 7. Errores y degradación

- Migración sin correr: `create` guarda sin `remitente_lid` y avisa una vez
  por proceso; el hilo se agrupa por `remitente_telefono` (NULL para lids →
  un hilo por mensaje, feo pero visible). Nada rompe.
- Un mensaje sin texto (media): se guarda con `texto = null`, se muestra como
  "(imagen o adjunto)". Ya es así.
- Un `@lid` que no cruza con ninguna señal: se guarda con `senal_id = NULL`.
  El panel lo muestra como "sin pedido ligado". Es dato, no error: puede ser
  alguien que nunca publicó.
- Nunca se registra el contenido del mensaje en logs de error. Ya es así.

## 8. Tests

Todos en `test/`, con el patrón de mocks del repo (`memory` sin Supabase):

1. **Invariante 1**: `@g.us` en lista blanca entra; `@c.us` entra; `@lid`
   entra; `status@broadcast`, `@newsletter`, `@broadcast` y un chatId sin
   sufijo se descartan sin log ni escritura. Actualiza el test existente.
2. **Identidad**: un chatId `@lid` produce `remitente_lid` con sufijo y
   `remitente_telefono = null`; un `@c.us` colombiano produce lo inverso; un
   `@c.us` que no es celular colombiano produce ambos `null` y se guarda
   igual.
3. **Atribución**: dos señales al mismo lid, la respuesta se liga a la más
   reciente. Un teléfono que solo aparece en `respuesta_destino_telefono` se
   encuentra.
4. **Interruptor**: con `RADAR_DM_CLASIFICAR` apagado no se llama a
   Anthropic (fetch/cliente mockeado y afirmado no invocado), `tiene_cita`
   queda `null`, resultado `"guardado"`. Encendido, el flujo actual sigue
   igual (los tests que ya existen para `dm.js` se corren con el flag en
   `true`).
5. **Hilo por identidad**: `historialDe({ lid })` devuelve solo los mensajes
   de ese lid, en orden, aunque haya un teléfono con los mismos dígitos.
6. **Panel**: `agruparPorRemitente` agrupa por `remitente_lid ??
   remitente_telefono`; dos mensajes del mismo lid caen en un hilo.

## 9. Verificación en producción, el día del despliegue

**Estado a 2026-09-08 (cierre de Task 6): código y documentación listos, en
la rama `linea-dm-lid`, sin mergear a `main` ni desplegar. Nada de esta
sección se ha probado en producción todavía.**

Lo único verificado hoy: la suite completa del bot en verde (`npm test`,
1716/1716, 0 fallos) y el hallazgo de formato en
`group_signals.respuesta_destino_lid` (ver más abajo) contra la Supabase de
producción por REST — de solo lectura, no cambia nada.

Pasos que quedan pendientes, en orden, y quién los hace:

1. **Migración** — Correr `db/migrations/2026-09-08_linea_dm_lid.sql` en el
   SQL editor de Supabase y confirmarla por REST (`select remitente_lid from
   linea_dm limit 1` no debe devolver `42703`). **Pendiente — la corre
   Juan**, no Claude Code: no se ejecuta SQL contra producción desde acá.
2. **Despliegue** — `git push origin main` (o el merge que Juan decida) con
   `RADAR_DM_CLASIFICAR` ausente (= apagado). **Pendiente — lo decide y lo
   corre Juan**, no desde esta rama de trabajo.
3. **Primera respuesta real** — Esperar a que un colega conteste un DM del
   radar. Confirmar: fila en `linea_dm` con `remitente_lid` y `senal_id` no
   nulos; el hilo aparece en `/grupos` con el pedido y la ref. **Pendiente**,
   depende de 1 y 2.
4. **Ventana de 48 h** — Si no entra ninguna fila, mirar los eventos crudos
   de WAHA para ver con qué sufijo llegan las respuestas de un colega al que
   se le mandó DM. Sigue siendo el único supuesto no probado de esta spec:
   que la respuesta del colega llegue etiquetada `@lid`.
5. **Actualizar el estado** — Hecho para esta fase: CLAUDE.md (sección 2) ya
   documenta el trabajo, con la migración marcada pendiente. Falta la
   actualización que corresponde a los pasos 1-4 una vez ocurran de verdad
   (migración corrida, desplegado, primera fila real o resultado de la
   ventana de 48 h).

**Hallazgo adicional de la revisión (no estaba en el plan original):**
`group_signals.respuesta_destino_lid` se escribe hoy con dos formatos según
el camino de escritura — `src/groups/vivo.js:657` (flujo automático) guarda
el lid crudo CON sufijo `@lid`; `vivo.js:1144` y `:1343` (aprobación manual y
DM manual desde el CRM) guardan solo dígitos, SIN sufijo. `buscarPorLid`
compara por igualdad exacta, así que una señal resuelta por un camino manual
nunca se va a poder ligar a la respuesta que llegue. Verificado por REST
contra producción el 2026-09-08: 84 de 84 filas tienen el sufijo, todas del
camino automático — el bug es latente, no activo hoy — pero producción corre
en `GRUPOS_RESPUESTA_MODO=asistido`, que es justo el modo de los caminos
manuales. Decisión pendiente de Juan: normalizar el formato en escritura o
en lectura, y si se hace antes o después de este despliegue.

## 10. Fuera de alcance

- Responder por la línea. Nadie escribe desde el inbox; sigue siendo pasivo.
- Capturar citas que se coordinan por fuera de la línea (teléfono, WhatsApp
  personal). Sigue siendo el hueco documentado en `visitas.js`.
- La máquina de estados de `leads.cita` (`"solicitada"`).
- Cualquier cambio en la política de DM (`politica.js`).
