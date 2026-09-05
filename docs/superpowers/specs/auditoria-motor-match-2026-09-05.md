# Auditoría forense — motor de match del radar (2026-09-05)

**Alcance:** `src/groups/` — classify → match → revalidar (Sofi) → publicable → politica → redactar / alerta-asesor, más cruce-mandatos.
**Pregunta de Juan:** por qué, después de días de cambios, Sofi sigue frenando propiedades por parqueadero, orientación (poniente), unidad cerrada y otros datos que se pueden validar después de la primera interacción.
**Evidencia:** código en `main` (`b42bb25`, desplegado en Railway a las 17:28 UTC de hoy), 132 veredictos reales guardados en `group_signals.revalidacion` desde el 2026-09-02, inventario real (114 propiedades disponibles) y 158 tests del motor (todos pasan).

---

## Resumen ejecutivo

El motor determinista (`match.js`) ya hace lo que Juan pidió: desde el 2026-09-04 ni baños ni garajes descartan, un 0 de Wasi se trata como "sin dato" y sobrar no resta. **El problema no está en el motor, está en el prompt de Sofi (`revalidar.js`) y en cómo se lo protege.** Hoy ese prompt contiene **dos órdenes opuestas** para el mismo caso: un bloque del 2026-09-04 manda a `refs_dudosas` (nadie le escribe al colega) todo pedido que mencione piso, unidad cerrada, jardín u orientación; otro bloque del 2026-09-05 dice que eso **nunca** baja a dudosas. Las dos órdenes están blindadas por tests que exigen la frase literal de cada una, así que la suite pasa con la contradicción adentro.

Resultado medido con el prompt de hoy ya desplegado: de los 4 pedidos evaluados después de las 17:28 UTC que mencionaban parqueadero, piso o unidad cerrada, **los 4 se fueron a dudosas con `sin_confirmar` vacío**. Al colega no le llegó nada en ninguno.

Hay una segunda contradicción que explica los casos de parqueadero: el motor acepta hasta 10 % sobre el presupuesto y 10 % menos de área (margen de captura), pero **al prompt nunca se le dijo**. Sofi lee "presupuesto" como de fondo, ve "$30M sobre presupuesto (7 %)", lo cuenta como un hueco, le suma "no sabemos si tiene parqueadero" y manda la propiedad a dudosas.

Los tres arreglos urgentes son de tamaño S y están en el plan del final.

---

## Las directrices vigentes (reconstruidas del código)

| # | Directriz | Fecha / origen | Dónde vive | Estado |
|---|---|---|---|---|
| D1 | Lo desconocido no descalifica: sin dato no suma ni resta | 2026-07-29 | `match.js:122-124, 525` | Vigente y aplicada |
| D2 | La zona se compara por token exacto, nunca substring; municipio como zona si `zona` está vacía | 2026-07-29 / 2026-09-05 | `match.js:227-259` | Vigente. **Violada en `redactar.desvios`** (H5) |
| D3 | Margen de captura: +10 % precio, −10 % área entran con castigo | 2026-08-20 (Juan) | `match.js:149-150, 414-421, 490` | Vigente. **Sofi no lo sabe** (H2) |
| D4 | Sobrar no es fallar: más alcobas/baños/garajes/metros cumple | 2026-09-04 (Juan) | `match.js:482, 507, 513`; prompt 207-215, 265-267; `redactar.desvios` | Vigente en los tres |
| D5 | Baños y garajes cortos entran con castigo y aclaración (`le_falta`) | 2026-09-04 (Juan: "no podemos dejar de ofrecer un apartamento por un parqueadero") | `match.js:493-515`; prompt 219-236 | Vigente |
| D6 | El 0 de Wasi es "sin dato", no "no tiene" | 2026-09-04 | `revalidar.js:358`, `match.js:525`, `redactar.js:142-146` | Vigente. Consecuencia no declarada: garaje nunca es verificable (H4) |
| D7 | Lo que no registramos va a `refs_utiles` con `sin_confirmar`; nunca a dudosas, sin importar cuántos datos | 2026-09-05 (Juan: "no podemos dejar de avisar por no conocer el poniente ni los años de construcción") | prompt 178-193, 242-264 | **Contradicha por D8** |
| D8 | Piso específico, unidad cerrada, jardín privado y orientación van a `refs_dudosas`, nunca a `refs_utiles` | 2026-09-04 (spec `radar-dm-flexible-design.md` §4.2 y criterio 3, aprobada por Juan) | prompt 276-287; test `group-revalidar.test.js:256-269` | **Contradice a D7. Sigue activa** |
| D9 | Lista cerrada de "de fondo": zona, municipio, tipo, operación, presupuesto, alcobas hacia abajo | 2026-09-04 | prompt 216-236 | Vigente. "Presupuesto" sin la salvedad del margen (H2) |
| D10 | DOS O MÁS incumplimientos conocidos = dudosa; los no registrados no cuentan | 2026-09-01 / 2026-09-05 | prompt 197-227, 249-264 | Escrita tres veces; **Sofi sigue contando los desconocidos** (H3) |
| D11 | Publicar en grupo exige zona exacta/vecina, puntaje ≥ 70, datos limpios; el DM automático usa umbral 0 pero mantiene las barreras de dato | 2026-08-16 / 2026-09-02 | `publicable.js`, `vivo.js:407-427` | Vigente |
| D12 | Callar es gratis / ante la duda no (frenos de canal) | 2026-08-16 | `politica.js` | Vigente, es el freno de canal, no del match |

La regla que Juan expresó hoy ("valores que se pueden validar después de la primera interacción") es D7. **D8 es la decisión anterior, del día previo, y nadie la retiró.**

---

## Hallazgos críticos 🔴

### H1 — El prompt de Sofi tiene dos órdenes opuestas para orientación, piso y unidad cerrada, y las dos están blindadas por tests

**Ubicación:** `src/groups/revalidar.js:178-193` (D7) contra `src/groups/revalidar.js:276-287` (D8).
**Categoría:** reglas de negocio contradictorias en el mismo artefacto.

El bloque D7 (commit `b42bb25`, hoy 12:28) dice: "orientacion, poniente, antiguedad, vista, piso, acabados — eso NUNCA baja una propiedad a refs_dudosas". Noventa líneas más abajo, el bloque D8 (commit `dc511e4`, ayer 10:24) dice: "NÚMERO DE PISO específico, UNIDAD CERRADA, JARDÍN PRIVADO u ORIENTACIÓN (poniente...) esas refs van en 'refs_dudosas', NUNCA en 'refs_utiles'". Mismo atributo, destino opuesto, en el mismo prompt cacheado.

`test/group-revalidar.test.js:256-269` exige la frase literal de D8 y `test/revalidar-dato-faltante.test.js` exige la de D7. Los 158 tests pasan porque las dos frases existen. Los tests fijan texto, no comportamiento: no pueden detectar que el texto se contradice.

**Evidencia en producción, con `b42bb25` ya desplegado (17:28 UTC):**

| Hora UTC | Colega | Pedido menciona | Veredicto | `sin_confirmar` |
|---|---|---|---|---|
| 18:34 | Julissa | piso medio-alto | 1 útil → **dudosas** ("la asesora deba confirmar antes de ofrecerla") | vacío |
| 18:44 | Mateo Narváez | garaje, cuarto útil | **dudosas** ("dos huecos a la vez sin poder verificar") | vacío |
| 18:53 | Mateo Narváez | garaje deseable | **dudosas** | vacío |
| 19:47 | Deisy Marín | parqueadero, unidad cerrada | **dudosas** ("unidad cerrada, que el inventario no registra") | vacío |

Antes del despliegue el patrón era el mismo: Patricia Urreta (17:04, "sin poniente") 4 refs a dudosas; Gustavo Arango (02:30, terraza y piso bajo) 3 refs a dudosas. Desde el 2026-09-02, de 84 pedidos que mencionan un atributo blando, 20 quedaron solo en dudosas y 12 de esos con `sin_confirmar` vacío: la propiedad calzaba en todo lo verificable y a nadie se le escribió.

**Por qué importa:** el flujo de `vivo.js#asistir` es correcto y hace exactamente lo que el veredicto dice: sin `refs_utiles` no hay DM; solo aviso a la asesora. La pérdida se decide en el prompt.

**Refactor:** elegir una. Con la regla que Juan dio hoy, borrar el bloque 276-287 y el test 256-269, y actualizar la spec del 2026-09-04 (§4.2 punto 4 y criterio de aceptación 3), que hoy documenta D8 como decisión aprobada.

### H2 — "Presupuesto" es de fondo para Sofi, pero el motor deja pasar hasta 10 % por encima sin decírselo

**Ubicación:** `match.js:149, 414-421` (margen y castigo) contra prompt `revalidar.js:201, 216-218` ("fuera de presupuesto" = INCOMPATIBLE; "presupuesto" en la lista cerrada de fondo).
**Categoría:** contrato implícito entre motor y juez, roto.

El motor manda candidatas con la razón "$450M — 7 % sobre $420M, dentro del margen". El prompt no menciona el margen en ningún lado. Sofi aplica la regla que sí tiene, y pasarse del presupuesto es de fondo. Mismo problema con el área: `MARGEN_AREA` deja pasar 60 m² para un pedido de 65, y el prompt solo dice "unos pocos m² por debajo" es accesorio, sin número.

**Evidencia:** Deisy Marín (19:47): "$30M sobre presupuesto (7 %) y no sabemos si tiene parqueadero" → dudosas. Mateo Narváez (18:53): "$25M por encima del presupuesto de $300M (8 %)" → dudosas. Mateo (18:44): "5 m² por debajo del mínimo (60 vs 65)" → dudosas. En los tres casos el motor había aceptado la propiedad a propósito y la política del prompt la volvió a frenar.

**Refactor:** una línea en el prompt, con los mismos números que el motor: "el motor ya aceptó hasta 10 % sobre el techo y hasta 10 % menos de área; dentro de ese margen es CASI (va a `le_falta`), no INCOMPATIBLE". Idealmente pasarle los valores desde `match.MARGEN_PRECIO` y `MARGEN_AREA` para que no diverjan.

---

## Hallazgos altos 🟠

### H3 — Sofi sigue contando los datos desconocidos como huecos cuando hay un corto conocido al lado

**Ubicación:** prompt `revalidar.js:203-204, 222-227, 249-253`.

La regla "no se cuentan los datos que no tenemos" está escrita tres veces, pero la tabla de situaciones define CASI como "UNA SOLA cosa" y DUDOSA como "dos o más". Cuando Sofi ve un corto conocido (5 m², 7 % de precio) más un "garajes: sin dato", suma dos y manda a dudosas. Los dos ejemplos del prompt no cubren ese caso: el ejemplo 1 solo tiene desconocidos y el ejemplo 2 solo cortos conocidos. El caso mixto, que es el más frecuente en producción (Mateo 18:44, Esteban 16:26 ref 9921323, Deisy 19:47), no tiene salida ejemplificada.

**Refactor:** un tercer ejemplo real con la salida esperada: un corto accesorio conocido más dos datos no registrados → `refs_utiles` con `le_falta` para el corto y `sin_confirmar` para los otros.

### H4 — El garaje es inverificable por construcción y nadie lo declaró

**Ubicación:** `dmap/src/sync/wasi-api.source.ts:79-83, 165`; consumidores en `match.js:525`, `revalidar.js:358`.

Medido hoy sobre las 114 disponibles: `garaje = 0` en 39, `null` en 0, `> 0` en 75. Wasi manda `"0"` cuando el campo no se cargó y `toNumberOrNull` lo guarda como 0. La decisión del 2026-09-04 (0 = sin dato) es correcta con esos datos, pero tiene una consecuencia que el prompt niega: **el sistema ya no puede afirmar nunca que una propiedad no tiene garaje**, y el prompt le dice a Sofi que "el motor ya comparó garajes" (`revalidar.js:163-165`). Un pedido con parqueadero cruza contra un inventario donde el 34 % sale con "garajes: sin dato" y va a `sin_confirmar` sí o sí.

**Refactor:** en DMAP, comprobar contra la API si Wasi omite `garages` o manda `"0"` cuando no está cargado. Si lo omite, el 0 viene de otro lado y se corrige en el sync. Si manda `"0"`, aceptar que garaje solo se verifica hacia arriba, quitarlo de la frase "el motor ya comparó" y pedirle al equipo cargar el dato en Wasi (75 ya lo tienen).

### H5 — El mensaje al colega contradice al motor sobre la zona

**Ubicación:** `src/groups/redactar.js:184-196` (`desvios`) contra `src/groups/match.js:227-259, 340-366`.

`desvios` compara zonas por substring en los dos sentidos (`z.includes(p) || p.includes(z)`), el patrón que el motor abandonó en julio por los 656 falsos positivos, y no conoce ni subzonas ni vecindad. Verificado ejecutando las dos funciones:

| Propiedad | Pedido | Motor (`ubicacionCoincide`) | Mensaje (`desvios`) |
|---|---|---|---|
| San Joaquín | Laureles | **exacta** | "queda en San Joaquín, no en Laureles" |
| Loma de los Balsos | El Poblado | vecina | "queda en Loma de los Balsos, no en El Poblado" |
| Castropol | Poblado | vecina | "queda en Castropol, no en Poblado" |

El colega recibe una aclaración que dice que la propiedad no está donde pidió, en una propiedad que el motor calificó como exacta. Es la misma regla implementada dos veces con dos criterios.

**Refactor:** `desvios` debe leer `match.ubicacion` (el grado ya viene en cada candidata) y aclarar solo si es `vecina` u `otra_zona`, diciendo "vecina de lo pedido". Borrar la comparación por substring.

### H6 — La misma semántica implementada cinco veces, sin helper, y la lista de exigencias en cinco archivos

**Ubicación:** "0/null = sin dato": `match.js:525`, `revalidar.js:358`, `redactar.js:142-146`, `alerta-asesor.js:209-215`, `cruce-mandatos.js:26`. Lista de exigencias (habitaciones, área, baños, garajes, estrato): `classify.js:75-81`, `match.js:445-521`, `revalidar.js:416-422`, `cruce-mandatos.js:168-200`, `alerta-asesor.js:202-218`.

Cada vez que se agrega un atributo o se cambia qué significa "sin dato", hay que tocar cinco lugares y acordarse de los cinco. Es la razón estructural por la que una regla nueva "no pega": se corrige en uno y los otros cuatro siguen con la versión vieja. Hoy no hay divergencia activa en el "sin dato" (el 2026-09-04 se alinearon), pero no hay nada que impida la próxima.

**Refactor:** `formato.datoCargado(v)` (o similar) usado en los cinco sitios, y una lista única de exigencias `[{campo, etiqueta, plural}]` en un módulo que los demás importen.

---

## Hallazgos medios 🟡

### H7 — El prompt es un changelog, no una política, y los tests lo fijan por frases literales

`SISTEMA` tiene ~2.250 tokens. El caso Patricia Urreta está narrado dos veces (líneas 187-191 y 254-260), la regla de "garajes: sin dato" dos veces (202 y 242-248), "DOS O MÁS" tres veces. Cada regla lleva fecha, cita literal y caso. Un modelo que recibe la misma regla tres veces con matices distintos no la obedece mejor; la interpreta.

Siete tests aseguran substrings del prompt (`s.includes("nunca en refs_dudosas por")`, `/LISTA DE "DE FONDO" ES CERRADA/`). Eso impide reescribirlo sin romper tests que no prueban ningún comportamiento, y no detecta contradicciones (H1).

**Refactor:** reescribir `SISTEMA` como política (una tabla, una lista de fondo, tres ejemplos, sin fechas ni citas) y mover la historia a un documento. Cambiar los tests de frases por un golden set: 8-10 señales reales guardadas (Patricia, Deisy, Mateo, Edwin, Juan Carlos Montes, Esteban) que se corren con `scripts/diagnostico-revalidar.js` (hoy sin commitear) y cuya salida esperada se compara campo por campo. Ese script ya existe por esta razón.

### H8 — Comentarios y afirmaciones del prompt que ya no son ciertos

- `revalidar.js:163-165`: "el motor ya comparó zona, precio, area, alcobas, baños, garajes y estrato". Baños y garajes ya no son compuerta (`ok: () => true`) y el garaje casi nunca se verifica (H4).
- `revalidar.js:169`: "el puntaje va de 55 a 100". Desde `CASTIGO_CORTO` se resta después del tope y el piso es 0.
- `cruce-mandatos.js:90-99`: dice que `evaluarCandidata` corta duro por baños y garajes "exactos". Falso desde el 2026-09-04.
- `alerta-asesor.js:174, 176`: `PORQUE` traduce `limite_colega_alcanzado` y `limite_colega_no_verificable`, motivos que `decidirDm` ya no emite.

### H9 — Los atributos en disputa no se extraen de forma estructurada

`classify.js` no extrae unidad cerrada, orientación, piso, antigüedad ni terraza; a veces caen en `notas`. Cualquier política sobre ellos (D7 o D8) depende de que Sofi los lea del texto crudo. Si la decisión es D7 (se ofrece igual con salvedad), no hace falta extraerlos. Si algún día vuelve a ser D8 (a la asesora), hay que extraerlos como flags y rutear en `vivo.js`, no en el prompt: las decisiones de ruteo pertenecen al código, que es determinista y se prueba; al modelo solo se le pide juicio.

---

## Hallazgos bajos 🟢

- `redactar.js:80`: `MAX_PROPIEDADES = Infinity` y el parámetro `maxPropiedades` son vestigiales.
- `redactar.js:194`: el texto del desvío arma la lista de zonas con `pedido.zonas ? join(" ni ") : pedido.zona` dentro del template; es la tercera forma de "zonas pedidas" además de `match.zonasPedidas` y `alerta-asesor.queBusca`.
- `vivo.js:212` pasa `edificio` a `politica.decidir` (camino de grupo) pero `decidirDm` no lo recibe. En el camino asistido el freno de edificio depende de que Sofi lo lea en el texto. No hay caso medido; se anota.

---

## Lo que está bien hecho

- El motor es código puro, con traza de razones por candidata y decisiones auditables (`traza` en política, `razones` en match). Eso es lo que permitió hacer esta auditoría en una tarde.
- La separación `sin_confirmar` (no sabemos) / `le_falta` (sabemos y no cumple) / `refs_dudosas` (que decida una persona) es el modelo conceptual correcto. El problema es solo cómo se le explica al modelo.
- Falla cerrada en todos los bordes: sin veredicto no se escribe a nadie; sin destino no sale DM; el DM automático pasa por `publicable` con umbral 0 pero barreras de dato intactas.
- Las decisiones están medidas contra producción (39/114 garajes en 0, 17/122 sin zona, 748/760 por lid) antes de cambiar código. Esa disciplina hay que conservarla al reescribir el prompt.

---

## Plan de refactor sugerido

| Paso | Acción | Tamaño | Resuelve |
|---|---|---|---|
| 1 | Borrar el bloque "ATRIBUTOS QUE NO PODEMOS EVALUAR" (`revalidar.js:276-287`) y su test (`group-revalidar.test.js:256-269`); actualizar la spec del 2026-09-04 (§4.2 y criterio 3) para que documente D7 | S | H1 |
| 2 | Decirle a Sofi los márgenes del motor (10 % precio, 10 % área) como CASI, con los valores importados de `match.js`; agregar el ejemplo del caso mixto (un corto conocido + datos no registrados) | S | H2, H3 |
| 3 | Commitear `scripts/diagnostico-revalidar.js` y correr los 6 pedidos reales de hoy contra el prompt nuevo antes de desplegar; guardar esa salida como golden set | S | Verifica 1 y 2 |
| 4 | `desvios` lee `match.ubicacion` en vez de comparar strings; aclara solo vecina/otra_zona | S | H5 |
| 5 | Reescribir `SISTEMA` como política corta; historia y casos a un documento; reemplazar los tests de frases por el golden set del paso 3 | M | H7, H8 |
| 6 | `formato.datoCargado` y lista única de exigencias usada por los cinco módulos | M | H6 |
| 7 | Verificar en DMAP qué manda Wasi cuando `garages` no está cargado y decidir si el 0 se puede volver `null` en el origen | M | H4 |
| 8 | Limpiar `PORQUE`, comentarios stale de `cruce-mandatos` y `revalidar`, parámetros vestigiales | S | H8, bajos |

Los pasos 1 a 3 cierran hoy el problema que motivó la auditoría. El paso 5 es el que evita que vuelva a pasar.
