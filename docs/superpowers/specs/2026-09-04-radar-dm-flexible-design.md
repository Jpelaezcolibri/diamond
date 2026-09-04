# Radar: DM al colega más flexible, con observaciones

**Decisión de Juan, 2026-09-04.** Diseño aprobado en conversación; este
documento es la fuente de verdad de lo acordado. Implementación en un plan
aparte.

## 1. Qué se pidió

Textual, de Juan:

> "cualquier match donde se tenga certeza de que cumple con dos o 3
> observaciones la enviamos directa al colega (...) quita la restricción de la
> cantidad de mensajes a un mismo colega (...) necesito que seas más flexible
> dentro de lo que se puede ser flexible (...) todo en lo que no tengamos
> información pero cumple con lo básico zona, zonas vecinas, rango de
> presupuesto y rango de habitaciones (...) envíalo con la observación"

Y sobre lo que no se puede evaluar:

> "no quiero que dejemos propiedades por fuera sin saber si hay match, entonces
> vamos con la A pero las que tengan esas salvedades envíalas a Natalia"

Objetivo de negocio: que el radar deje de perder oportunidades por falta de un
dato accesorio, y que el colega reciba la propiedad con el hueco declarado en
vez de no recibir nada.

## 2. El estado real del camino, corregido

Durante el diseño se corrigió un error de mapa que vale dejar escrito, porque
determina dónde van los cambios.

**El puntaje NO es la compuerta del DM.** En modo asistido —el modo en
producción— `src/groups/vivo.js#asistir` llama a:

```js
publicable.filtrar(utilesSegunSofi, { syncFresco, umbral: 0 })
```

`umbral: 0`. El `GRUPOS_RESPUESTA_UMBRAL` (70) gobierna el camino auto/sombra,
no este. En el camino asistido la secuencia real es:

```
match.js#cruzar        → candidatas (compuertas DURAS: e.ok() → return null)
revalidar.js           → Sofi decide (apruebaAviso). ESTA es la compuerta
publicable.filtrar     → solo calidad de dato (umbral 0)
verificarLink          → que el link abra
politica.decidirDm     → frenos de frecuencia
waha.enviarDm          → sale
```

Consecuencia: para "ser más flexible" no hay que bajar un umbral. Hay que
**dejar de descartar candidatas en `match.js`** y ajustar el criterio de Sofi.

## 3. El hallazgo: el rescate del 24-ago está anulado por las compuertas del 20-ago

`revalidar.js` ya implementa exactamente lo que Juan pidió, y lo pidió él mismo
el 2026-08-24 (caso Edwin Ramírez, grupo SOLO Envigado):

- `sin_confirmar` — "no sabemos el dato" (global al inventario).
- `le_falta` — "sabemos el dato y NO cumple, pero es accesorio" (por propiedad).

`redactar.js#ficha` ya imprime ambos como aclaración dentro de la ficha.

**Pero la propiedad nunca llega a Sofi.** En `match.js` las exigencias son
compuertas duras:

```js
if (!e.ok(e.tiene, e.pide)) return null;
```

y las tres relevantes solo aflojan si `flexible_habitaciones`:

| Exigencia | `ok` hoy | Efecto con `flexible = false` |
|---|---|---|
| habitaciones | `t >= q - (flexible?1:0) && t <= q + 1` | descarta 2+ alcobas de más, y cualquiera de menos |
| baños | `t >= q - (flexible?1:0)` | descarta cualquiera de menos |
| garajes | `t >= q - (flexible?1:0)` | descarta cualquiera de menos |

Como `corto = e.tiene < e.pide` solo puede ser cierto si `e.ok()` pasó,
**`CASTIGO_CORTO.habitaciones`, `.banos` y `.garajes` son inalcanzables cuando
`flexible` es `false`**. Son código muerto en el 92,6% de los casos.

### Medición en producción (2026-09-04, 664 demandas reales)

| Hecho | Cantidad | % |
|---|---|---|
| Demandas totales | 664 | 100% |
| Piden habitaciones | 499 | 75,2% |
| Piden garajes | 112 | 16,9% |
| Piden baños | 67 | 10,1% |
| `flexible_habitaciones = true` | 49 | **7,4%** |

O sea: el tope superior de alcobas (`t <= q+1`) aplica a 3 de cada 4 pedidos, y
el rescate por `le_falta` de un garaje está cerrado en ~93% de los 112 pedidos
que piden garaje — que es literalmente el caso que lo motivó.

**Este es el cambio de mayor impacto del diseño, y es de tres líneas.**

## 4. Los cambios

### 4.1 `src/groups/match.js` — abrir las compuertas, conservar el castigo

Las exigencias accesorias dejan de descartar y pasan a puntuar menos:

- **habitaciones**: se quita el tope superior. Piden 2 y hay 4 → entra, con el
  puntaje de "no exacto" (6 vs 10) que ya existe. Se conserva la decisión del
  2026-08-20 ("la que calza exacto debe tener el puntaje mayor"): abrir la
  compuerta no cambia el orden, solo deja de tirar la propiedad a la basura.
- **baños** y **garajes**: dejan de exigir `t >= q`. Quedarse corto entra y
  cobra `CASTIGO_CORTO`, que así deja de ser código muerto.
- **Sin dato** (`e.tiene == null`): sigue siendo neutro para el puntaje, pero
  ahora se acumula en una lista de faltantes que viaja hacia Sofi para que
  pueda declararlo en `sin_confirmar`.

**Se abren dos de los tres castigos muertos, no los tres, y es deliberado.**
`CASTIGO_CORTO.banos` y `.garajes` se vuelven alcanzables porque quedarse
corto en un baño o un garaje es lo que Juan pidió rescatar. **Alcobas de
MENOS sigue siendo compuerta dura**: Juan pidió flexibilidad hacia arriba
("si necesita 2 habitaciones y tiene 3 o 4 o 5"), nunca hacia abajo, y el
código ya tiene el argumento — las alcobas definen el producto, un 2 alcobas
no resuelve un pedido de 3. Quien quiera una alcoba menos lo sigue diciendo
con `flexible_habitaciones`, que no se toca. Por eso
`CASTIGO_CORTO.habitaciones` sigue siendo inalcanzable salvo con `flexible`,
y eso es correcto, no un olvido.

**Lo que NO se abre**: `estrato` sigue siendo compuerta dura. Ya está
argumentado en el código y no lo contradice ningún pedido de Juan: no es una
preferencia de espacio negociable, es la clasificación socioeconómica del
sector. Tampoco se tocan operación, tipo, zona ni banda de precio — son los
"básicos" que Juan definió como innegociables.

### 4.2 `src/groups/revalidar.js` — criterio más permisivo, hueco siempre declarado

El prompt de `SISTEMA` se ajusta para que Sofi:

- Apruebe cuando se cumplen los básicos (zona exacta o vecina, presupuesto,
  rango de alcobas, operación y tipo) aunque falten datos accesorios.
- Use `le_falta` en vez de descartar cuando el incumplimiento es accesorio.
- Use `sin_confirmar` para todo dato que el pedido menciona y el inventario no
  tiene.
- **Devuelva a Natalia** (no apruebe DM) cuando el pedido menciona un atributo
  que no podemos evaluar en ninguno de los dos lados: piso específico, unidad
  cerrada, jardín privado, orientación. Decisión de Juan: nada se descarta por
  no poder evaluarlo, se deriva a una persona con la nota de que hay que
  analizarlo.

`apruebaAviso` no cambia de forma.

### 4.3 `src/groups/politica.js` — frenos

| Límite | Hoy | Queda | Motivo |
|---|---|---|---|
| `dmsPorColegaDia` | 2 | **se quita** | Pedido de Juan: son respuestas a mensajes que el colega inició |
| `antiguedadMaximaMin` | 30 min | **igual** | Un DM por un pedido de ayer es la queja textual del colega. Juan no pidió tocarlo |
| `topeDiarioLinea` | 150 | **igual** | Cortacircuitos, no cuota |
| **cuota de WhatsApp** | — | **nuevo** | Ver abajo |

El **dedup por contenido** (`GROUPS_DEDUP_HORAS`) se conserva y no es un tope
de frecuencia: evita que el MISMO pedido, difundido a cinco grupos, dispare
cinco DMs idénticos al mismo colega. Quitarlo sí sería spam.

### 4.4 Cortacircuitos por cuota real de WhatsApp (nuevo)

WhatsApp le impone a la línea un tope propio, visible en la sesión de WAHA:

```json
"messageCapping": { "totalQuota": 300, "usedQuota": 12,
                    "cycleStart": 2026-09-01, "cycleEnd": 2026-10-01 }
```

300 mensajes por mes calendario. Con el volumen medido (~17 pedidos/día), abrir
la manguera sin freno agota la cuota alrededor del día 18 y deja el radar mudo
el resto del mes.

Se lee `usedQuota/totalQuota` de la sesión —el número de WhatsApp, no uno
nuestro— y al **80%** los DMs se detienen y todo se deriva a Natalia, con
aviso al watchdog. **Frena, no descarta.**

Es la única adición al pedido literal de Juan, y él la aprobó explícitamente.

Salvedad honesta: no está confirmado si esos 300 cuentan mensajes o personas
nuevas contactadas. `usedQuota` es un contador en vivo, así que la primera
semana de operación lo resuelve por observación.

### 4.5 Registro y medición

`group_signals` ya guarda `respuesta_texto`, `respondida_at`, `respuesta_modo`,
`respuesta_refs`, `autor_nombre` y `autor_telefono`. Falta:

- Dejar asentado el **lid** con el que se enrutó (hoy solo queda el teléfono).
- Un contador diario de DMs de la línea, contrastable contra `usedQuota`.

`directorio_lids` (2.261 pares al 2026-09-04) ya cubre la necesidad de Juan de
"no descargar los contactos en cada cruce" y de tener respaldo si se pierde la
línea. **No se construye una agenda de contactos**: sigue siendo caché de
ruteo, y a quién se le escribe lo decide `politica.js#decidirDm`.

## 5. Lo que NO cambia

Invariantes que este diseño no toca, y que ningún cambio de arriba puede
relajar:

1. **Nunca se publica en el grupo.** Modo asistido; el DM es la única salida.
2. **Mensaje blanqueado**: al colega le va `linkWasi`, nunca la landing propia,
   y el texto no nombra a Diamond (decisión de Juan, 2026-08-18).
3. **Nunca inventario de aliados** al colega.
4. **Sync de Wasi fresco** o no se ofrece nada.
5. **Solo se le escribe a quien publicó un pedido.** Ley 1581 de 2012, límite
   trazado en `2026-08-22_colegas_grupos.sql`. `directorio_lids` es ruteo, no
   una lista de prospección.
6. **Ningún "no" descarta el pedido**: todos derivan a Natalia.
7. **`enviarDm` nunca reintenta** sobre un envío de estado desconocido.

## 6. Riesgo

Aflojar el filtro sube el volumen sobre una línea no oficial que ya fue baneada
el 2026-07-30, y `politica.js` dice en su encabezado "callar es gratis". Juan
decidió lo contrario con el riesgo sobre la mesa: es una decisión de negocio,
tomada el 2026-09-04, y queda escrita acá con su nombre y fecha como el resto
de las decisiones de riesgo del proyecto.

Lo que la acota es el plan del propio Juan: **abrir el fin de semana, medir,
cerrar según resultados.** El cortacircuitos de cuota (4.4) es lo que evita que
"abrir" se convierta en "quedarse mudo a mitad de mes".

## 7. Criterios de aceptación

1. Un pedido de 2 alcobas cruza contra una propiedad de 4 en zona y precio →
   **entra como candidata** (hoy se descarta).
2. Un pedido de 2 garajes cruza contra una propiedad de 1 → **entra**, y el
   mensaje al colega dice qué le falta (hoy se descarta).
3. Un pedido que menciona "piso 15", "unidad cerrada" o "jardín privado" →
   **no sale por DM**, va a Natalia con la nota de análisis.
4. Un colega que publica tres pedidos distintos en un día → **recibe tres
   respuestas** (hoy dos).
5. El MISMO pedido visto en tres grupos → **un solo DM**.
6. Con `usedQuota >= 240` → **ningún DM**, todo a Natalia, y el watchdog avisa.
7. Ningún mensaje al colega nombra a Diamond ni lleva link de la landing.
8. Un pedido que no cumple los básicos (otra zona, fuera de presupuesto) →
   **no sale por DM** por más flexible que sea todo lo demás.
