# Amoblados — el radar aprende a leer "amoblado", y responde por dos carriles

**Fecha:** 2026-09-07
**Estado:** aprobado por Juan (alcance, umbral y carriles decididos el mismo día)
**Alcance:** `src/groups/` (clasificación, cruce, compuerta, aviso) — **cero grupos nuevos**

---

## El problema, con los números reales

El radar lleva **155 demandas de arriendo** capturadas y **respondió cero**.
De venta respondió 116. No es que no las oiga: las oye, las clasifica y las
archiva, y después no hace nada con ellas.

Hay dos causas encadenadas, y ninguna es la que parecía.

### 1. "Amoblado" no existe para el motor

`classify.js` no extrae el dato. `properties` no tiene la columna. Y Wasi
**no lo marca como característica** — verificado el 2026-09-07 contra las dos
propiedades de arriendo que sí tenemos: sus `caracteristicas` traen 24 y 43
ítems respectivamente ("Admite mascotas", "Ascensor", "Sauna"…) y **ninguno
dice amoblado**. La palabra vive sólo en el título:

> `Apartamento Amoblado en Arriendo en Don Quijote, Medellín`

El resultado es que el motor no puede fallar de una sola manera, sino de dos
opuestas:

- ofrecerle un apartamento vacío a quien pidió amoblado;
- ofrecerle un amoblado a quien lo rechazó explícitamente. **Ese caso ya está
  en la base**, palabras textuales del colega:

  > *🏠⭐️Busco CASA para arriendo en el Poblado hasta la Frontera*
  > *3 alcobas más servicio* · *$9.000.000 presupuesto mensual* · ***SIN muebles***

  Hoy ese pedido cruza contra nuestro amoblado de Los Gonzáles sin que nada lo
  frene.

### 2. No hay inventario que ofrecer

En producción hay **2 propiedades de arriendo**, contra 110 de venta. Las dos
son amobladas (refs `10319552` y `10319436`).

El 2026-09-07 se verificó que **no es un bug del sync**: se disparó una corrida
manual (`seen: 112, created: 0, updated: 0`) y se contrastó contra la web
pública de la cuenta Wasi que alimenta el sistema
(`paraisoinmobiliario.inmo.co`): expone 112 propiedades, de las cuales **2 en
alquiler** — exactamente lo que tenemos. Los amoblados que Juan actualizó no
están en esa cuenta, o están sin publicar. **Queda como pendiente de negocio,
fuera del alcance de esta spec.**

### Por qué igual se construye ahora

Porque la demanda ya está entrando y se está tirando a la basura. Medido sobre
las 155 demandas de arriendo: **8 mencionan muebles**, y llegan por los grupos
de PEDIDOS que ya escuchamos — no por los grupos de amoblados. El único grupo
de amoblados que escuchamos (`RENTA Y VENTA AMOBLADOS MEDELLIN`) produjo **3
señales en toda su historia**; `RENTA AMOBLADOS/FINCAS`, cero.

De ahí la decisión de alcance: **no se abre ningún grupo**. Abrir catorce
grupos para dos propiedades es gasto de API sin contrapartida (Juan,
2026-09-07: *"es un gasto innecesario de api"*). Cuando llegue el inventario se
abren, con la lógica ya construida y medida.

---

## Qué se construye

### 1. El pedido: dos campos nuevos

`src/groups/classify.js` — esquema y prompt de SISTEMA — más dos columnas en
`group_signals` (migración `2026-09-07_amoblado.sql`).

**`amoblado`: `"si" | "no" | ""`**

Tri-estado, **no booleano**. Un booleano no distingue "no lo pidió" de "lo
rechazó", y son conductas opuestas: ante `""` la propiedad amoblada es
elegible, ante `"no"` queda descartada. El caso "SIN muebles" de arriba es la
razón por la que existe el tercer valor.

- `"si"`: el mensaje pide amoblado ("busco amoblado en Sabaneta", "apartamento
  amoblado en el poblado").
- `"no"`: lo rechaza explícitamente ("SIN muebles", "sin amoblar", "vacío",
  "no amoblado").
- `""`: no lo menciona.

**`periodo`: `"mes" | "corta" | ""`**

`"corta"` cubre por noche, por día, por semana y estadías de pocos días.

El peligro que justifica el campo **no** es el que parece. Un pedido de
"$300.000 por noche" ya lo bloquea la banda de precio sola: `precio_max` queda
en 300.000 y nuestro amoblado de $4.500.000 se pasa del techo. El caso que sí
pasa hoy es el inverso:

> *"$4.500.000 por 15 días"* → `precio_max = 4.500.000` → calza **perfecto**
> contra nuestro amoblado mensual, y le ofrecemos un mes por el precio de
> quince días.

### 2. El inventario: derivar, no migrar

Módulo hoja nuevo `src/groups/amoblado.js`, puro y sin I/O:

```
esAmoblada(propiedad) → true   si "amoblad" aparece en título o características
                        false  si dice "sin amoblar" / "no amoblado"
                        null   en cualquier otro caso (no sabemos)
```

**Por qué derivado y no una columna nueva.** Wasi no expone el dato, así que
una columna sería igual de inferida — pero además obligaría a tocar DMAP,
correr una migración y hacer backfill: tres pasos para el mismo grado de
certeza. El día que Wasi lo exponga de verdad, `esAmoblada` pasa a leer el
campo y nadie más se entera. Es la regla 1-2-3 del CLAUDE.md: extender antes
que construir.

`null` es un valor de primera clase, no un `false` disfrazado. La diferencia
decide el carril de salida (punto 4).

### 3. La compuerta, en `evaluarCandidata`

Va ahí porque es la única función que tiene **el pedido y la propiedad a la
vez**. `publicable.esPublicable(match)` recibe sólo el match: no puede saber si
el colega pidió amoblado, así que `evaluarCandidata` le estampa el dato.

| El colega pide | La propiedad | Resultado |
|---|---|---|
| amoblado (`"si"`) | `true` | pasa · `+8` · razón `"amoblada"` |
| amoblado (`"si"`) | `null` | pasa, marcada `amoblado_sin_confirmar` |
| amoblado (`"si"`) | `false` | **descarta** |
| sin muebles (`"no"`) | `true` | **descarta** |
| no lo menciona (`""`) | cualquiera | neutro |

El match sale con dos campos nuevos: `amoblado` (`true|false|null`) y
`amoblado_sin_confirmar` (`boolean`).

`publicable.js` gana dos motivos, **con su traducción en `MOTIVOS_LEGIBLES`**
— la lección del 2026-09-06: un motivo que no se traduce es un motivo que quien
lo lea va a reemplazar por una explicación inventada.

- `amoblado_sin_confirmar` → *"no tenemos confirmado que esté amoblada: Wasi
  sólo lo dice en el título y esta ficha no lo trae"*
- `periodo_no_soportado` → *"el pedido es por días o semanas y nuestro
  inventario está cotizado por mes"*

El gate de `periodo` va en `publicable.js` **y no en `politica.decidirDm`**:
`publicable.filtrar` es el único punto por el que pasan los cuatro caminos
(`asistir`, `aprobarManual`, `responderPorDmManual` y el DM manual). Una
compuerta que cubre una puerta de cuatro no es una compuerta.

### 4. Los dos carriles de salida

Lo que Juan pidió textualmente: *"nada a grupos, solo respuestas al dm si
aplica muy cerca de lo que pide; lo que aplica un poco menor scoring se envía a
Natalia con un mensaje diferenciado que sepa que es de amoblados"*.

**Qué es "el carril", exactamente:** toda demanda con `operacion === "arriendo"`,
no sólo las que dicen la palabra amoblado. La razón es que nuestro inventario de
arriendo es 100 % amoblado (las dos propiedades que hay), así que un pedido de
arriendo que no menciona muebles igual va a cruzar contra un amoblado y merece
el mismo tratamiento. Las demandas de **venta no se tocan** y siguen exactamente
como hoy.

| Calza | Salida |
|---|---|
| puntaje ≥ **85** y `amoblado === true` | **DM al colega**, idéntico al de venta |
| publicable pero < 85, **o** `amoblado_sin_confirmar` | **Aviso a Natalia**, diferenciado |
| nada publicable | como hoy |

El umbral vive en `RADAR_AMOBLADO_UMBRAL_DM` (default 85) para moverlo sin
redesplegar, mismo patrón que `GRUPOS_RESPUESTA_UMBRAL`.

**Ojo con dónde se aplica.** En modo `asistido` el DM automático corre con
`umbral: 0` a propósito: el veredicto de Sofi reemplaza al puntaje
(`vivo.js:440`). El umbral de amoblados es una compuerta **adicional** que se
evalúa después del veredicto, sobre las refs que Sofi aprobó — no reemplaza a
`umbral: 0` ni lo contradice.

El aviso diferenciado (`alerta-asesor.js`) lleva encabezado propio y la razón
real por la que no salió solo:

```
🛋️ AMOBLADOS — pedido que no salió solo

Un colega busca apartamento amoblado en El Poblado, 2 alcobas,
hasta $8.000.000.

Tenemos: 10319436 · Apto Amoblado Los Gonzáles · 3 alcobas · 90 m² · $7.900.000
No salió solo porque: el puntaje quedó en 79 y para salir solo pide 85.
```

El motivo se toma de `MOTIVOS_LEGIBLES` o del puntaje, nunca se redacta libre:
es el mismo criterio del 2026-09-06 — si el motivo no se traduce, quien lo lea
lo reemplaza por una explicación inventada.

### 5. Nada al grupo, por código

El carril **nunca** publica en un grupo, aunque alguien prenda `responde` por
error. No es una configuración que se pueda mover: es una guarda en el código.

Concretamente: en `vivo.js#procesarMensaje`, el camino que publica en el grupo
(el que corre cuando el modo de la org no es `asistido`) sale temprano con
`{ resultado: "carril_sin_publicacion_en_grupo" }` si la demanda es de
arriendo. Hoy ese camino está inactivo porque la org está en `asistido` y
ningún grupo tiene `responde = true` — la guarda existe justamente para que
siga siendo cierto el día que alguna de esas dos cosas cambie.

### 6. El interruptor

`RADAR_AMOBLADO_ACTIVO` (default `true`). Apagado: no sale **ningún** mensaje
del carril — ni DM al colega, ni aviso a la asesora. La clasificación y la
captura de ofertas siguen.

Aplica la regla que Juan fijó el 2026-09-05 tras los 1.906 avisos:

- la guardia va **dentro del módulo del carril**, no en quien lo llama;
- cubre **todas** las puertas — son cuatro: `asistir`, `aprobarManual`,
  `responderPorDmManual` y el DM manual;
- **sin excepciones razonadas adentro**. Una excepción bien argumentada dentro
  de un kill switch es un kill switch roto;
- el test ejercita cada puerta con datos que **sí calzan**, no con listas
  vacías que salen por un `return` temprano.

### 7. El léxico

A `lexico.js`: `"amoblados"`, `"amueblado"`, `"por noche"`, `"por dia"`,
`"renta corta"`, `"coliving"`, `"airbnb"`, `"temporal"`. El archivo lo pide
explícitamente: *"ante la duda, agregalo"*.

---

## Lo que se toca, y lo que no

**Se toca:** `classify.js` (esquema + prompt), `match.js` (`evaluarCandidata`),
`publicable.js` (dos motivos + traducciones), `alerta-asesor.js` (aviso
diferenciado), `redactar.js` y `revalidar.js` (declarar "amoblada" en la
ficha), `lexico.js`, y un módulo nuevo `amoblado.js` + otro para el carril.
Migración `2026-09-07_amoblado.sql`.

**No se toca:** el flujo de DM, `politica.decidirDm`, los rangos de precio, ni
la configuración de ningún grupo.

---

## El riesgo que hay que mirar

**El prompt de `revalidar.js` ya tiene una regla que dice lo contrario.** La
decisión vigente de Juan (D7, 2026-09-05) es que *lo que no registramos se
ofrece igual con `sin_confirmar`*. La talla de amoblado dice que un
`sin_confirmar` de amoblado **no sale solo**.

No es una contradicción si se implementa donde corresponde: la talla vive en
**código** (`publicable.js`), y el prompt lleva una línea que la **reconoce**,
no una que la niegue. Meter en el prompt una regla opuesta a la que ya está es
exactamente el bug que encontró la auditoría del 2026-09-05 — dos órdenes
opuestas conviviendo, las dos fijadas por tests de frases literales, con la
suite en verde.

Por eso, y sin excepción: **el cambio de prompt no se valida con
`includes("frase")`**. Se corre `scripts/golden-revalidar.js` sobre los 6
pedidos reales antes de desplegar.

---

## Pruebas

Casos nuevos en `test/group-match.test.js`:

1. Las cinco filas de la tabla del punto 3, una por caso.
2. El caso "SIN muebles" con el **texto real** de la señal en producción.
3. `"$4.500.000 por 15 días"` → `periodo: "corta"` → `periodo_no_soportado`.
4. `esAmoblada` sobre las fichas reales de `10319552` y `10319436` (título sí,
   características no) → `true`.
5. Una propiedad de venta cualquiera → `null`, no `false`.

En `test/group-politica.test.js` / el test del carril:

6. Puntaje 90 + amoblada → DM. Puntaje 80 + amoblada → aviso diferenciado.
7. Puntaje 95 + `amoblado_sin_confirmar` → aviso, **no** DM.
8. `RADAR_AMOBLADO_ACTIVO=false` → las cuatro puertas mudas, cada una con
   datos que sí calzan.

---

## Fuera de alcance

- Los amoblados que faltan en Wasi (pendiente de negocio, punto 2 del
  problema).
- Abrir grupos de amoblados o de renta corta.
- Una columna `amoblado` en `properties` — se reevalúa si Wasi expone el campo.
- El bug latente de `normalizeOperacionYPrecio` (prioriza `for_sale` sobre
  `for_rent`, así que una propiedad marcada venta *y* arriendo se guardaría
  sólo como Venta). Verificado el 2026-09-07 que hoy no está mordiendo:
  ninguna de las 120 con link de venta tiene también link de alquiler. Queda
  anotado.
