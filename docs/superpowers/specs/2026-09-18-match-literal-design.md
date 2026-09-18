# Match literal: zona, parqueaderos y piso — diseño

**Fecha:** 2026-09-18 · **Decisión de:** Juan · **Estado:** aprobado, en implementación

## 1. El caso

El 18-sep a las 11:00 a. m. un colega recibió por DM la ref `10012722`
(*VENDO APARTAMENTO CIUDADELA DEL VALLE*, **Itagüí**, $390M) para el pedido
"Busco apartamento **Envigado** precio $400.000.000". Respondió:

> "Hola Sofi. Me dice Itagui y solo quiere Envigado"

El motor había graduado la ubicación como `vecina` (60 puntos) y la ficha
salió con su propia salvedad impresa: *"Aclaración: queda en Itagüi, vecina de
Envigado"*. El sistema sabía que no era lo pedido y lo mandó igual. A las 11:25
el *Pedido C088* ("busca Apartamento en todo Envigado") volvió a enganchar la
misma propiedad con 70 puntos.

No es un caso aislado. Medido sobre las señales que terminaron en DM entre el
18-ago y el 18-sep:

- **717 fichas enviadas** a colegas en total.
- **213 (30%) salieron por zona `vecina`**, en 144 pedidos distintos.
- **145 salieron con menos parqueaderos de los pedidos.**
- La `10012722` le llegó a pedidos de Envigado el 16, el 17 y el 18 de sep.

## 2. La regla de Juan

> "que no envíe nada que no esté dentro de la misma zona, municipio, área,
> presupuesto etc, lo que es números dale un pequeño margen pero lo que es
> zonas, pisos, parqueaderos, etc hazlo literal"

Y sobre el piso, el mismo día: *"quiero que seas muy estricto con los pedidos
que exigen piso"*.

## 3. Qué se construye

### 3.1 Zona y municipio, literales

`publicable.js#esPublicable` deja de aceptar `ubicacion === "vecina"`. Se
descarta con un motivo propio, `zona_vecina`, distinto de `zona_no_publicable`
para que el panel diga cuál de las dos cosas pasó.

Siguen pasando:
- `exacta` — incluye los barrios registrados en `SUBZONA_DE` (Las Palmas →
  Poblado, Los Gonzáles → Poblado, los 27 barrios de Envigado).
- `zona_general` — la propiedad está en la zona madre del barrio pedido
  ("Barrio Mesa" contra una propiedad registrada solo como "Envigado"), y el
  mensaje al colega lo declara.

**La compuerta va en `publicable.js`, no en `match.js`.** La propiedad sigue
siendo candidata y se ve en `/grupos` como "casi"; lo único que cambia es que
no puede salirle a un colega. `VECINDAD` en `src/lib/zonas.js` **no se toca**:
es lo que hace que el prefiltro SQL traiga las subzonas al motor.

### 3.2 Parqueaderos, literales

Hoy (decisión del 2026-09-04) quedarse corto solo cuesta puntos: una propiedad
de 1 garaje sale para un pedido de 2 "con la observación". **Esto se revierte,
por decisión de Juan del 2026-09-18.**

- El pedido exige N y la propiedad tiene menos → **descarta en `match.js`**,
  igual que hoy hace `amoblado === false`: es un incumplimiento *conocido*.
- El pedido exige N y la propiedad **no trae el dato** → no descarta, pero
  marca `garajes_sin_dato`, y `publicable.js` lo frena. Queda en el panel.

Baños, alcobas, área y precio **no cambian**: siguen con su margen y su
castigo de hoy.

### 3.3 Piso, literal y estricto

Dato nuevo, porque hoy no existe: `properties` no tiene columna de piso y el
sync de Wasi no lo trae. Medido el 2026-09-18 contra la web de Wasi: en 8 de 8
apartamentos la ficha no trae el campo Piso, y en el único que lo trae —la
`10012722`— dice **"Piso: 1" cuando el apartamento está en el 19** (lo dicen su
título y su descripción). Traer el campo hoy construiría la compuerta sobre un
dato vacío y, donde está lleno, mentiroso.

Por eso el piso se lee del texto, igual que `amoblado`:

- **`src/groups/piso.js`** (módulo hoja, hermano de `amoblado.js`): lee título
  y descripción y devuelve `{ numero }`, `"alto"`, `"bajo"` o `null`. Cubre 40
  de los 90 apartamentos del inventario (44%).
- **El clasificador** extrae del pedido `piso_max` y `piso_min`. "Solo hasta 3°
  piso" → `piso_max: 3`. "Sin ascensor máximo segundo" → `piso_max: 2`.
  "Piso alto" → `piso_min: 4`.
- **`match.js`**: si el pedido exige piso y el de la propiedad se conoce y no
  cumple → descarta. Si no se conoce → marca `piso_sin_confirmar`.
- **`publicable.js`**: `piso_sin_confirmar` frena la salida, con su motivo
  legible.

El 26% de los pedidos exige piso, así que **43 apartamentos dejan de salir en
uno de cada cuatro pedidos** hasta que carguen el dato en Wasi. Esa lista se le
entregó a Juan el mismo día en `Claude outputs/wasi-fichas-por-corregir.xlsx`.

## 4. Lo que NO entra

Unidad cerrada (12% de los pedidos), ascensor (8%), estudio (8%), cuarto útil
(7%) y años de construido (6%). Ninguno tiene campo en Wasi ni en `properties`:
hoy viven en texto suelto. Segunda fase.

## 5. Cómo se verifica

1. Un test por regla, escrito antes del código (`test/group-publicable.test.js`,
   `test/group-match.test.js`, `test/piso.test.js`, `test/classify-piso.test.js`).
2. `npm test` entero en verde.
3. El golden set de Sofi, con la clave de producción:
   `railway run --service diamond node scripts/golden-revalidar.js`.
4. Replay contra los 300 pedidos reales que terminaron en DM, para medir
   cuánto se deja de enviar **antes** de desplegar.

## 6. Riesgo asumido

- **Se envía ~30% menos.** Es el objetivo, no un efecto secundario: eso es lo
  que hoy sale fuera de la zona pedida.
- **El prompt del clasificador cambia**, y con él el prefijo cacheado que bajó
  el costo de $0,0041 a $0,0015 por mensaje. Hay que volver a medir
  `cache_read` en Railway después de desplegar.
