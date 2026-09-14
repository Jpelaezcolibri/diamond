# Costo de la API de Claude

Medido el 2026-09-05 contra produccion: volumenes reales de los ultimos 30
dias (Supabase) y tamaños reales de cada prompt (contados sobre el codigo).

## De donde sale la plata

| Ruta | Modelo | Llamadas/mes | Tokens/llamada | Antes | Despues |
|---|---|---:|---:|---:|---:|
| `agent/engine.js` (Sofi ↔ cliente) | Sonnet | 466 | 12.001 | $12,09 | ~$3,20 |
| `agent/sofi-comando.js` (Centro de Comando) | Sonnet | 218 | 11.976 | $5,65 | ~$1,50 |
| `groups/classify.js` (radar en vivo) | Haiku | ~2.100 | 2.420 | $6,66 | $6,66 |
| `groups/revalidar.js` (Sofi juzga) | Sonnet | 111 | 3.453 | $1,65 | ~$0,80 |
| `scheduler/followups.js` | Sonnet | ~60 | 1.924 | $0,45 | $0,45 |
| **Total** | | | | **~$26,50** | **~$12,60** |

DMAP no aparece porque esta en cero: 0 `publication_events` en 30 dias. Cuando
se prenda, la generacion de creativos y el backfill del motor cognitivo son
trabajo no interactivo — ahi aplica la Batch API, con 50% de descuento.

## Que se cambio

1. **TTL del cache de 5 minutos a 1 hora** (`src/lib/anthropic.js`). El bloque
   estable + `TOOL_DEFINITIONS` son ~10.000 tokens identicos entre llamadas y
   entre leads distintos de la misma org. Con 5 minutos se re-escribia casi
   siempre: una conversacion de WhatsApp no va a ese ritmo.
2. **`buscar_propiedades` dejo de mandar `images`** (`src/agent/tools.js`). Era
   el 61% de la fila y el modelo no lo usa. Se reenviaba entero en cada vuelta
   del tool loop.
3. **`revalidar.js` cachea su prompt de sistema** (~2.250 tokens por pedido).
4. **`registrarUso`** deja en el log cuanto se leyo del cache, porque este
   ahorro falla en silencio.

## Que se descarto, y por que

**Batchear la clasificacion en vivo.** El comentario de `classify.js` dice que
sin lotes "el mes cuesta decenas de dolares en vez de centavos", y la escucha
en vivo llama al clasificador con lotes de UNO (`groups/vivo.js`). Parece el
arreglo obvio y no lo es:

- Mediana entre señales del radar: **302 segundos**. Solo el 22% llega a menos
  de 60 s de la anterior.
- Los mensajes del mismo grupo van serializados en cola
  (`channels/whatsapp-group.js`, `enqueue('grupo:<id>')`), asi que un buffer
  nunca junta dos del mismo grupo.

Un lote de 20 recolectaria ~1,3 mensajes: latencia sin ahorro. El batching
sirve para el import de `.txt`, que ya lo hace. **Si algun dia el radar sube a
varios mensajes por minuto, esto se vuelve rentable y hay que rehacerlo.**

**Cachear el prompt de `classify.js`.** Solo `system` es cacheable ahi (no usa
tools) y son ~1.000 tokens, por debajo del minimo cacheable de Haiku. El
`ESQUEMA` (~1.286 tokens) viaja en `output_config`, que no es parte del prefijo
cacheable.

**Bajar Sonnet a Haiku en lo que habla con el cliente o en `revalidar`.**
Ahorraria ~$8/mes a cambio de exactamente la calidad que no se quiere tocar.
`revalidar` ya dio problemas de criterio (el caso del garaje, 2026-09-04).

**Cachear el historial del tool loop con un segundo marcador.** Vale ~$2/mes y
toca el camino mas critico del sistema. Reconsiderar solo si `[uso]` muestra
que las vueltas del tool loop dominan la factura.

## Actualizacion 2026-09-14: el clasificador era la factura

La tabla de arriba subestimaba `groups/classify.js` unas 12 veces. Medido con
los contadores de `/webhook/grupos/estado` (09:08 a 15:03 hora Colombia):
1.232 mensajes de grupos en escucha, **8 descartados por el prefiltro
(0,6 %)**, 384 difundidos, **840 clasificados**, 82 demandas. En grupos
gremiales casi todo mensaje nombra una zona, un precio o un termino del
oficio, asi que el "~85 % de descarte" no se da. Son 820 a 1.300
clasificaciones por dia: ~$100 a $160 al mes, ~85 % del gasto total.

El descarte de "cachear el prompt de `classify.js`" (abajo, en la seccion de
lo descartado) dejo de valer con ese volumen. El prefijo (system + esquema)
media 3.092 tokens, bajo el minimo de Haiku 4.5 (4.096). Se cruzo con 12
ejemplos reales y dos reglas nuevas (precio sin unidad segun operacion;
barrio y municipio van los dos) y se marco con `CACHE_ESTABLE`.

Validado con la clave de produccion sobre 60 mensajes congelados (40 demandas
y 12 ofertas guardadas, 8 de ruido escritas a mano), gasto de la validacion
~$0,59:

| | Prompt viejo | Prompt nuevo |
|---|---:|---:|
| Clase igual a la etiqueta de produccion | 59/60 | 60/60 |
| USD por mensaje (medido en `usage`) | 0,00413 | 0,00147 |
| Llamadas que leyeron cache | — | 59/59 |

Las dos reglas nuevas salieron de la primera pasada: con solo los ejemplos,
el prompt nuevo leia "alrededor de 1.300" en venta como $1.300.000 (2 de 4
vueltas) y dejaba solo el barrio en "Camino Verde de Envigado" — que no esta
en `SUBZONA_DE`, o sea que el pedido no habria cruzado con nada.

Quedan propuestas, sin aplicar: una compuerta de intencion de demanda antes
de clasificar (recall 98,7 % sobre 1.500 demandas reales; el recorte no esta
medido, va primero en sombra) y `buscar_propiedades` en JSON compacto y sin
columnas internas (-14 % o mas por busqueda).

Verificacion del cache del clasificador:

```
railway run --service diamond node scripts/smoke-cache.js classify
```

## Como verificar que funciono

En los logs de Railway:

```
[uso] engine entrada=10450 cache_read=9800 (94%) escrito=0 fresco=650 salida=210
```

`cache_read` alto y `escrito` bajo = el cache pega. `escrito` alto en **cada**
llamada = el prefijo se esta invalidando; hay que revisar que se colo dentro
del bloque estable (lo volatil va SIEMPRE despues del marcador).

Para volver atras sin desplegar: `ANTHROPIC_CACHE_TTL=5m`.
