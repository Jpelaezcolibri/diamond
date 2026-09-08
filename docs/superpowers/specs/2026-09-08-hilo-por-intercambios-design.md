# El hilo de la línea, por intercambios

**Decisión de Juan, 2026-09-08.** Mockup aprobado
(`https://claude.ai/code/artifact/fe8686dd-abaa-48be-924e-0628a86cdd9b`).
Este documento es la fuente de verdad de lo acordado. Implementación en un
plan aparte.

## 1. El caso que lo motivó

Se desplegó el mismo día la puerta al `@lid`
(ver `2026-09-08-linea-dm-lid-y-seguimiento-design.md`): las respuestas de
los colegas ya entran, se guardan con su texto y se ven en `/grupos`. Juan
preguntó: *"pero en el mensaje que llega podemos ver el mensaje o solo lo
cuenta?"*. Sí se ve — pero sólo el lado del colega. Lo que Sofi le escribió
vive en `group_signals.respuesta_texto` y el panel no lo muestra al lado, así
que el hilo se lee como monólogo.

Sobre el mockup, Juan descartó la línea de tiempo fusionada:
*"un poco más independientes los mensajes, es que se ve como que todo fuera
una misma conversación"*. Tiene razón y el dato lo confirma: cada DM es por
una propiedad distinta y el colega contesta a uno en particular. **No es una
conversación: son intercambios separados con la misma persona.**

## 2. Lo que hoy existe, verificado contra producción (2026-09-08)

- `group_signals.respuesta_texto` está guardado en el **100%** — 0 de 91
  señales sin texto. También `respondida_at` y `respuesta_refs`.
- **Un colega puede tener varios DM.** Distribución sobre 91 DM a 59 colegas:
  41 con uno, 12 con dos, 4 con tres, 1 con cinco, 1 con **nueve**. El caso
  multi-DM no es teórico.
- **Las 91 señales tienen el mismo `advisor_id`: Natalia Vélez.** Catherine y
  Danna tienen usuario pero cero señales.
- `linea_dm.senal_id` ya liga cada mensaje entrante con la señal que originó
  el DM (`buscarPorLid` / `buscarPorTelefono`, la más reciente de ese colega).
- El panel ya resuelve `pedido_original`, `propiedad` y `pedido_respondida_at`
  por `senal_id`, y ya distingue "sin pedido" de "sin permiso".

**No hace falta migración ni tocar el bot. Esto es sólo CRM.**

## 3. Decisiones

1. **Un bloque por intercambio**, no una línea de tiempo fusionada. Cada
   bloque: la propiedad ofrecida y la fecha del DM arriba; lo que el colega
   contestó **a ese DM** abajo. El agrupamiento no se inventa — sale de
   `linea_dm.senal_id`.
2. **Qué se ve y qué se pliega.** Siempre visibles: el intercambio más
   reciente (haya contestado o no — "le acabamos de escribir" es información)
   y todos los que tienen al menos una respuesta. Los demás —DM viejos sin
   respuesta— se pliegan en un `<details>`: *"Ver los N intercambios
   anteriores, sin respuesta"*.
3. **El conteo va en el encabezado del colega:** *"3 DM enviados · 1
   respondido"*. Es el numerador y el denominador de la fase 4 (tasa de
   respuesta), visible por colega sin construir nada extra.
4. **Lo ven sólo Juan y Natalia.** La consulta de los DM pasa por `mias()`
   como todas las de `group_signals`; el aislamiento por asesor **no se
   toca** y el test que lo vigila tampoco. Catherine y Danna siguen viendo lo
   que escribió el colega, con el cartel que ya existe y que culpa al permiso,
   no al dato.
5. **El texto completo del DM va plegado.** Los DM reales son largos (ficha de
   propiedad, link, firma). El bloque muestra ref y título; el texto entero se
   abre a pedido.

## 4. Lo que se construye

### 4.1 Los datos — `crm/app/(dashboard)/grupos/page.tsx`

Una consulta nueva a `group_signals`, envuelta en `mias(...)`, que trae **todos**
los DM mandados a las identidades de los hilos en pantalla — filtrando por
`respuesta_destino_lid` y `respuesta_destino_telefono` contra los
`remitente_lid` / `remitente_telefono` de las filas de `linea_dm` ya traídas.

Trae también los DM que el colega **nunca contestó**: sin ellos no hay
denominador y el conteo mentiría.

De cada señal se usan `id`, `respuesta_texto`, `respondida_at`,
`respuesta_refs`, `texto_original`. El título de la propiedad se lee de
`properties` por el primer ref de `respuesta_refs`, como ya se hace hoy — no
se arrastra desde la señal, porque precio y disponibilidad cambian.

La consulta existente que resuelve el pedido por `senal_id` se mantiene: son
dos preguntas distintas (*"¿de qué pedido salió este mensaje?"* contra
*"¿qué le mandamos a este colega?"*) y la segunda no reemplaza a la primera.

### 4.2 El armado del hilo — `crm/lib/linea-dm-hilo.ts`

La lógica de agrupar vive acá, no en el componente: es una transformación pura
y se puede razonar sola. El archivo ya existe (tiene `claveHilo` y
`anclaHilo`), así que se extiende.

Una función que recibe los mensajes de un hilo y los DM de ese colega, y
devuelve la lista de intercambios ordenados: DM más reciente primero, y las
respuestas de cada uno en orden cronológico ascendente.

Casos que tiene que resolver:

- **Mensajes con `senal_id` que no está entre los DM visibles** (por permiso,
  o porque la señal quedó fuera del lote): van a un bloque propio marcado
  como restringido. No se pierden.
- **Mensajes sin `senal_id`.** Dos significados distintos y hay que
  distinguirlos: si el colega **no tiene ningún DM**, escribió por su cuenta
  (bloque sin encabezado, y el conteo lo dice); si **sí tiene** DM pero el
  mensaje no quedó ligado, es un hueco de atribución y se marca como tal. No
  se puede decir "escribió por su cuenta" de algo que quizá sí era respuesta.
- **Un DM sin ninguna respuesta:** bloque con encabezado y "No contestó".

### 4.3 El panel — `crm/components/linea-dm-inbox.tsx`

Renderiza lo que arma la función anterior, con la estructura del mockup
aprobado. El encabezado del colega lleva el conteo. Se conservan el bloque de
"Pidió en el grupo" y las columnas en gris de las fases siguientes (cita,
tiempo de respuesta).

## 5. Errores y degradación

- Si la consulta nueva falla, el panel **no puede quedar mudo**: hoy
  `page.tsx:393` descarta el error de la consulta de señales, y por eso un
  fallo se lee como "no tenés permiso". Esta consulta usa `fetchSafe` y pinta
  `ErrorBanner`, y el estado "sin permiso" sólo se muestra cuando la consulta
  **funcionó** y la señal no vino. Es un hallazgo abierto de la revisión
  anterior; se cierra acá porque este cambio lo empeoraría si no.
- Una señal con `respuesta_refs` vacío o sin propiedad en `properties`: el
  bloque muestra la fecha del DM y el texto, sin ref. No se inventa un título.
- Un `respuesta_texto` nulo (no debería: hoy es 100%): el bloque existe igual,
  con la fecha, y dice que el texto no quedó registrado.

## 6. Tests

`crm/` no tiene suite. Se valida con:

- `npx tsc --noEmit` y `npm run build` desde `crm/`.
- `npm test` desde la raíz — incluye `test/crm-grupos-aislamiento.test.js`,
  que exige que **toda** consulta a `group_signals` en `page.tsx` esté envuelta
  en `mias(`. La consulta nueva tiene que cumplirlo.

La función de armado de `crm/lib/linea-dm-hilo.ts` es pura y merece pruebas de
verdad, no sólo typecheck. Se agrega un test en la suite de la raíz
(`node --test`) que la ejercite sobre datos armados a mano: varios DM con y sin
respuesta, un mensaje sin `senal_id` con y sin DM previo del colega, y un
`senal_id` restringido.

**Cómo se importa, verificado el 2026-09-08 y no supuesto:** Node 24 (v24.20.0
en esta máquina) hace type-stripping nativo, así que
`require("../crm/lib/linea-dm-hilo.ts")` funciona directo desde un test de la
raíz, sin transpilar ni agregar `tsx`/`ts-node`. Probado contra el archivo real:
devuelve `anclaHilo` y `claveHilo` y las dos corren.

La condición que eso impone al archivo: **sólo tipos borrables** — anotaciones,
`type`, `interface`, `import type`. Nada que emita runtime (`enum`,
`namespace`, decoradores, parámetros con `private` en el constructor). Hoy el
archivo ya cumple; el test lo fija, porque si alguien agrega un `enum` el
`require` se rompe y la suite lo dice.

Es el primer módulo de `crm/lib` que se prueba así. El test de aislamiento que
ya existe lee el **fuente** de `page.tsx` como texto (esa página es un
componente de servidor de Next y no se puede instanciar); este es distinto y
más fuerte: ejercita la función de verdad.

## 7. Alcance futuro (NO se construye ahora)

Juan, 2026-09-08: *"luego implementamos que solo entren los mensajes que
contestan a un dm y que esta informacion genera un dato de cuantos se
contestan y cuantos se agendan visita para tener trazabilidad de todo"*.

- ~~**Filtro de entrada: sólo mensajes que contestan un DM.**~~ **DESCARTADO
  el mismo día.** Juan lo propuso y después lo revirtió: *"tienes razón con lo
  de solo los que responden al dm, pongamos todo"*. Entra todo. El motivo:
  filtrar dejaría fuera al colega que escribe por su cuenta (el caso
  "Catalina" del mockup), y hoy no sabemos cuántos son ni si son ruido o
  leads, porque hasta el 2026-09-08 no entró ninguno. Un colega que escribe
  sin que le hayamos escrito es, si acaso, **más** interesante que uno que
  contesta. Se guarda todo y el panel lo marca; si algún día son ruido
  medible, se decide con el número a la vista.
- **Métrica de contestados.** El conteo por colega de esta spec ya es el
  insumo; falta el agregado.
- **Métrica de visitas agendadas.** Depende del clasificador
  (`RADAR_DM_CLASIFICAR`, hoy apagado) — es la fase 2 del roadmap acordado:
  leer → citas → tiempos → tasa.

## 8. Fuera de alcance

- Responder por la línea. El inbox sigue siendo pasivo.
- Tocar `mias()`, el aislamiento por asesor, o el test que lo vigila.
- Cualquier cambio en el bot o en la base. Esto es sólo CRM.
