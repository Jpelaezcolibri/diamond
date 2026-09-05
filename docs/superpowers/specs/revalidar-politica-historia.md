# El veredicto de Sofi (`src/groups/revalidar.js`): política e historia

El prompt `SISTEMA` de `revalidar.js` es **política**: dice qué hacer, sin
fechas ni casos. Este documento guarda **de dónde salió cada regla**, con el
caso real que la motivó y la decisión de Juan, para que nadie afloje una regla
sin saber qué costó. Si cambiás el prompt, actualizá acá el porqué.

Cómo se prueba el prompt: **no** con frases (`SISTEMA.includes(...)`), sino
corriendo el golden set sobre pedidos reales:

```bash
railway run --service diamond node scripts/golden-revalidar.js
```

(`test/golden/revalidar-2026-09-05.json`; ver la auditoría
`auditoria-motor-match-2026-09-05.md`, H7.)

## Las reglas y su origen

| Regla del prompt | Decisión / caso | Fecha |
|---|---|---|
| Sonnet y no Haiku: es juicio, no extracción; volumen bajo | diseño del modo asistido | 2026-08-18 |
| `sin_confirmar` (INCOMPLETO): lo que el pedido menciona y el inventario no registra se declara, no descarta | De 13 pedidos descartados medidos, 10 eran incompatibles de verdad y 3 se perdieron solo por terraza/antigüedad que el inventario no guarda. Colega pidió apto en Envigado con terraza y máx. 6 años; había 3 con match del 100 % en zona/alcobas/precio y Sofi las descartó | 2026-08-24 |
| `le_falta` (CASI): un solo incumplimiento accesorio conocido se manda con la aclaración por propiedad | Edwin Ramírez, grupo SOLO Envigado: pidió hasta $980M, 3 alcobas, 98 m², 2 baños, 2 garajes y cuarto útil; la ref 10077095 cumplía todo salvo el segundo garaje. Juan: "al menos el apartamento de El Portal sí se podía enviar con la aclaración de que solo le falta un parqueadero" | 2026-08-24 |
| `refs_dudosas` (DUDOSA): tercera salida para lo que no es descarte limpio ni calza con confianza; va a la asesora, nunca al colega | Antes Sofi tenía que forzar un SÍ o un NO y lo intermedio se perdía sin que nadie lo viera | 2026-09-01 |
| Baños, garajes y estrato se muestran en la ficha, y "sin dato" se dice, no se omite | Un garaje vacío en Wasi hacía desaparecer la línea y Sofi leía la ausencia como "no tiene": mandó a dudosas tres refs del pedido de Melissa y la única de David Holguín. Juan: "lo que no tengamos validado en Wasi se le envía como observación" | 2026-09-02 |
| Las candidatas de un aliado van marcadas y nunca a `refs_utiles` | Caso Camilo: dos aliadas sin ref ni datos puntuaron 77, por encima del inventario propio, solo porque el puntaje premia lo verificable | 2026-09-02 |
| La ubicación (exacta/vecina/ciudad/fuera) se dice con todas las letras | Viajaba escondida entre las razones del motor y el modelo la pasaba por alto | 2026-09-02 |
| El 0 de Wasi es "sin dato", no "no tiene" | Medido: garaje = 0 en 39 de 114 disponibles, null en 0. Juan Carlos Montes, 15:00: el motor dio 95 y 85 y Sofi descartó las dos por "0 garajes registrados". Juan: "no podemos dejar de ofrecer un apartamento por un parqueadero" | 2026-09-04 |
| La lista de "de fondo" es cerrada; parqueadero, baños, estrato, cuarto útil y acabados son siempre accesorios; ante la duda, accesorio | Sofi ascendió el parqueadero a "de fondo" y descartó. La regla anterior decía "ante la duda, tratalo como de FONDO": era el permiso para descartar | 2026-09-04 |
| Sobrar no es fallar; lo que sobra se escribe como ventaja, no como comparación | Patricia Urreta recibió "Aclaración: 4 alcobas y pediste 2" | 2026-09-04 / 05 |
| Lo que no registramos nunca baja a dudosas ni vuelve incompatible, aunque el colega lo marque "SÍ o SÍ"; va a `refs_utiles` con `sin_confirmar` | Patricia Urreta, 17:04 UTC: "SIN poniente" y "máximo 2 años"; cuatro propiedades cumplían zona, precio, área y alcobas y se fueron a dudosas con `sin_confirmar` vacío. Juan: "no podemos dejar de avisar por no conocer el poniente ni los años de construcción"; "valores que se pueden validar después de la primera interacción". Gustavo Arango, "terraza SÍ o SÍ": con la salida "innegociable" abierta, el pedido quedó sin útiles ni dudosas | 2026-09-05 |
| **Revocada:** piso específico, unidad cerrada, jardín privado y orientación a `refs_dudosas` | Decisión del 04-sep (spec `2026-09-04-radar-dm-flexible-design.md` §4.2), revocada el 05-sep por la regla de arriba. Entre el 04 y el 05 las dos órdenes convivieron en el prompt, cada una con un test que exigía su frase literal (auditoría, H1) | 2026-09-04 → 05 |
| El margen del motor (+10 % precio, −10 % área) se le dice a Sofi con números; dentro del margen es CASI, no incompatible | Deisy Marín ($30M sobre $420M, 7 %) y Mateo Narváez ($25M sobre $300M; 60 de 65 m²) fueron a dudosas después de que el motor las aceptara a propósito. Los porcentajes se interpolan desde `src/groups/margenes.js` | 2026-09-05 |
| La cuenta de incumplimientos conocidos la hace el motor y Sofi la usa tal cual | Con la regla "los no registrados no cuentan" escrita tres veces, Sofi igual sumó "garajes: sin dato" como segundo incumplimiento (Mateo Narváez, 18:44). `formatearCandidatas` deriva N de las razones con "(pediste N)" o "dentro del margen" | 2026-09-05 |
| Un dato del pedido que aparece como "no dice" no es una exigencia | — | 2026-09-02 |

## Los tres ejemplos del prompt

1. **INCOMPLETO** — el caso de terraza/antigüedad del 2026-08-24.
2. **CASI + INCOMPATIBLE** — Edwin Ramírez (ref 10077095 con un garaje de menos; ref 8989725 con una alcoba de menos, de fondo).
3. **MIXTO** — Deisy Marín (ref 10077063: +7 % de precio dentro del margen, garaje sin dato, unidad cerrada).
