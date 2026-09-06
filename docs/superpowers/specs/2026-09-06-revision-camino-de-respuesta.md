# Revisión del camino de respuesta del radar — 2026-09-06

**Pregunta de Juan:** *"que el proceso de respuesta esté bien estructurado, que
siempre se responda lo que es y que tengamos claro el proceso"*.

**Alcance:** desde que entra el mensaje del colega en el grupo hasta que sale el
DM al colega o el aviso a la asesora. `src/groups/vivo.js` (1.417 líneas),
`politica.js`, `publicable.js`, `alerta-asesor.js`, `revalidar.js`.

**Evidencia:** código en `main` desplegado, 59 envíos reales al colega desde el
25 de agosto, y una prueba controlada de entrega por `@lid` hecha hoy.

---

## Resumen ejecutivo

El proceso **decide bien**: las compuertas de calidad del dato son estrictas,
fallan cerradas y están bien argumentadas en el código. Lo que de verdad sale al
colega es lo correcto.

Lo que está mal es que **el proceso no cuenta lo que hizo**. Hay cuatro caminos
que pueden mandarle un mensaje al colega y no escriben el mismo registro. Uno de
ellos deja la señal afirmando lo contrario de lo que pasó. Esa es la raíz de los
dos reportes falsos de hoy, y es un problema de estructura, no de redacción.

Los tres puntos urgentes:

1. Aprobar a mano deja la señal mintiendo (🔴, con un caso real en producción).
2. Cuatro caminos replican la misma secuencia de compuertas y ya divergieron.
3. Cero de 59 envíos tienen resultado registrado: el bucle de aprendizaje está vacío.

---

## El proceso, como es hoy

```
mensaje del colega en el grupo
        │
        ▼
  prefiltro          ¿parece un pedido inmobiliario?  no → muere, no se guarda
        │
        ▼
  classify           demanda | oferta | ruido
        │
        ▼
  match              cruce contra el inventario → candidatas con puntaje
        │
        ▼
  revalidar (Sofi)   veredicto: refs_utiles | refs_dudosas | sin_confirmar
        │
        ▼
  COMPUERTA DE CALIDAD DEL DATO
    publicable.filtrar   ref bloqueada, precio corrupto, aliado, sin link, sync viejo
    verificarLink        el link abre de verdad
        │
        ▼
  politica.decidirDm   destino (lid o teléfono), antigüedad, topes, cuota
        │
        ├── SÍ → DM privado al colega        → marcarRespondida + guardarPolitica + feed
        └── NO → aviso privado a la asesora  → enviado_at + aviso_advisor_id
```

**Un solo canal de salida al colega: el privado.** Desde el 2026-09-02 ninguna
vía publica en un grupo. `responde` (el permiso por grupo) quedó vestigial: se
creó para publicar en el grupo y el DM nunca lo consultó. Juan decidió el
2026-09-06 no separarlo, porque no hay ningún grupo que quiera escuchar sin
poder responder por DM. **Queda como deuda aceptada, no como hallazgo.**

### Las cuatro puertas de salida

| Camino | Quién lo dispara | Dónde vive |
|---|---|---|
| `asistir` | el radar, solo | `vivo.js:373` |
| `aprobarManual` | un admin desde el Centro de Comando | `vivo.js:916` |
| `responderPorDmManual` | una persona desde el CRM | `vivo.js:1077` |
| publicación en grupo | nadie (solo en modo `auto`, que no se usa) | `vivo.js:277` |

---

## Hallazgos críticos 🔴

### H1 — Aprobar a mano deja la señal afirmando lo contrario de lo que pasó

**Ubicación:** `src/groups/vivo.js:916` (`aprobarManual`)
**Categoría:** responsabilidades mezcladas / auditoría incompleta

`asistir` y `responderPorDmManual` llaman a `groupSignals.guardarPolitica` para
dejar registrado por qué salió (o no) el mensaje. **`aprobarManual` no lo hace.**
Manda el DM, marca `respondida_at`, y deja intacto el `politica_motivo` que había
escrito el intento automático anterior.

**Caso real en producción:**

| Campo | Valor |
|---|---|
| Señal | `565d3778`, colega Mateo Narváez, 2026-09-01 |
| `politica_motivo` | `sin_telefono` |
| `politica_traza` | `["NO:sin_telefono"]` |
| `respondida_at` | 2026-09-01T22:28 |
| `respuesta_texto` | "Hola Mateo, vi tu solicitud. Tengo 6 opciones..." |

La fila dice *"no se le escribió porque no había teléfono"* y al mismo tiempo
guarda el texto de lo que se le escribió. Las dos cosas no pueden ser ciertas.

**Por qué importa acá:** esta fila es la fuente de la que Sofi lee para
responder "¿por qué no salió esto?". Hoy mismo eso produjo dos reportes falsos a
Juan, y el arreglo que se hizo por la mañana (traducir motivos, prohibir
inventar) no toca esta causa: el dato de origen sigue mintiendo.

**Refactor sugerido:** `aprobarManual` llama `guardarPolitica` con un motivo
propio, igual que `responderPorDmManual` ya hace con `dm_manual`:

```js
await groupSignals.guardarPolitica(org.id, signal.id, {
  motivo: "aprobacion_manual",
  traza: ["aprobacion_manual", `refs:${refs.join(",")}`],
}).catch(() => {});
```

---

## Hallazgos altos 🟠

### H2 — Cuatro caminos replican la misma secuencia de compuertas, y ya divergieron

**Ubicación:** `vivo.js:373`, `916`, `1077`
**Categoría:** duplicación arquitectónicamente significativa

Qué aplica cada camino, medido leyendo los tres:

| Compuerta | `asistir` | `aprobarManual` | `responderPorDmManual` |
|---|---|---|---|
| `publicable.filtrar` | sí | sí | sí |
| `verificarLink` | sí | sí | sí |
| `syncEstado` | sí | sí | sí |
| tope por colega | sí | **no** | sí |
| cuota de WhatsApp | vía `decidirDm` | vía `cuotaAgotada` | vía `cuotaAgotada` |
| registra la decisión | sí | **no** (H1) | sí |
| avisa al feed del admin | sí | **no** | **no** |

La misma regla se expresa de dos formas distintas (la cuota) y dos controles
faltan en uno de los caminos. **No es una hipótesis: ya pasó.** El respaldo por
`@lid` hubo que agregarlo a los tres por separado el 2026-09-04, y hasta ese día
`aprobarManual` era *más restrictivo* que el camino automático — un pedido que
el radar habría contestado solo quedaba sin salida si una persona lo aprobaba.
El propio código lo documenta en `vivo.js:1013`.

**Refactor sugerido:** una función `prepararEnvioAlColega(org, signal, opciones)`
que devuelva `{ publicables, descartados, destino, motivo }`, y que los tres
caminos usen. Las diferencias legítimas (una aprobación humana reemplaza el
umbral de puntaje) pasan a ser parámetros explícitos, no omisiones.

### H3 — El cortacircuitos de la cuota de WhatsApp está ciego al canal principal

**Ubicación:** `vivo.js:896` (`cuotaAgotada`), `politica.js:302`
**Categoría:** resiliencia / falsa sensación de seguridad

Probado hoy con entrega real: se le mandaron **dos** mensajes a un `@lid` nuevo
(`184564139970806`, nunca contactado, sin fila en `directorio_lids`), Juan
confirmó que **llegaron**, y `cuotaWhatsapp.usados` se quedó en 17 antes,
durante y cinco minutos después.

WhatsApp no imputa los envíos por `@lid` a `messageCapping`. Y el `@lid` es el
canal del **98,4%** de los colegas. O sea: el freno que existe para no quemar la
línea —la misma que ya fue baneada en julio— no ve casi nada de lo que sale.

**Refactor sugerido:** no borrar la cuota, pero dejar de tratarla como el freno
principal. El eje que sí mide el volumen real es `dmsHoyLinea` contra
`topeDiarioLinea`. Donde el endpoint de salud muestre `cuotaWhatsapp`, decir que
solo cuenta envíos por teléfono.

### H4 — Cero de 59 envíos tienen un resultado registrado

**Ubicación:** `signal_events`, alimentado por `registrar_resultado_radar`
**Categoría:** el bucle de aprendizaje no cierra

Desde el 25 de agosto salieron 59 mensajes a colegas. **Ninguno** tiene un
evento en `signal_events`. El radar no sabe qué funcionó nunca.

La causa está identificada y ya tiene arreglo construido hoy: el recordatorio
citaba el pedido del colega en vez de nuestras propiedades, y sólo cobraba los
avisos a la asesora, no los DM. El **cierre del día**
(`src/scheduler/cierre-dia.js`) lo reemplaza y sale por primera vez a las 18:00.

**No hay refactor pendiente acá: hay que mirar si funciona.** Si mañana sigue en
cero, el problema no era el formato del mensaje.

---

## Hallazgos medios 🟡

### H5 — `vivo.js` tiene 1.417 líneas y cuatro razones para cambiar

Contiene el flujo de entrada, los tres caminos de salida, el cruce de ofertas y
la preparación de avisos. Es el archivo donde vive casi toda la lógica que esta
revisión tuvo que reconstruir leyendo. Partirlo en `vivo/entrada.js`,
`vivo/salida.js` y `vivo/ofertas.js` haría que H2 sea evidente en vez de
descubrible.

### H6 — 31 strings de resultado sin contrato

`grep -o 'resultado: "..."'` devuelve 31 valores distintos, cada uno traducido a
mano en cada consumidor (`sofi-comando-tools.js`, `crm.js`, el prompt). Cuando
se agrega uno nuevo, nadie avisa a los traductores: así apareció esta mañana un
`sin_telefono` sin caso propio, que Sofi explicó inventando. Una constante
exportada con su traducción —como se hizo hoy con `MOTIVOS_LEGIBLES`— cierra la
categoría entera.

---

## Lo que está bien hecho

No es un panfleto. Esto conviene no tocarlo:

- **Las compuertas fallan cerradas, siempre.** Sin teléfono ni lid no se manda;
  sin poder contar los DMs del día no se manda; ante duda de cuota, no se manda.
  En un sistema que escribe a terceros desde la línea de una persona real, esa
  es la decisión correcta y está sostenida en todos lados.
- **Los comentarios explican el *por qué*, con fecha y con el caso que lo
  motivó.** Esta revisión fue posible en una tarde gracias a eso. Es el activo
  más valioso del módulo.
- **La dirección de dependencia se respeta:** Radar lee al Learning Domain,
  nunca al revés. `signal_events` se puede borrar entera y el radar sigue
  funcionando.
- **La separación entre "qué aprueba Sofi" y "qué puede salir"** (veredicto vs
  `publicable.filtrar`) es correcta y hoy demostró su valor: frenó la 9921388,
  que tiene el precio mal en Wasi, aunque el modelo la había aprobado.

---

## Plan de refactor sugerido

| Paso | Acción | Esfuerzo | Resuelve |
|---|---|---|---|
| 1 | `aprobarManual` registra su decisión con `guardarPolitica` | S | H1 |
| 2 | Los tres caminos avisan al feed del admin, no solo `asistir` | S | H2 (parte) |
| 3 | Donde se muestre `cuotaWhatsapp`, decir que no cuenta los envíos por lid | S | H3 |
| 4 | Mirar el primer cierre del día y confirmar que entran resultados | S | H4 |
| 5 | `prepararEnvioAlColega` compartida por los tres caminos | M | H2 |
| 6 | Constante de resultados con su traducción, como `MOTIVOS_LEGIBLES` | M | H6 |
| 7 | Partir `vivo.js` en entrada / salida / ofertas | L | H5 |

Los pasos 1 a 3 son de una tarde y cierran lo que produjo los reportes falsos de
hoy. El 4 es mirar, no construir.
