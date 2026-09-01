# Radar: distinguir match fuerte de "revisar" en los dos carriles

**Fecha:** 2026-09-01
**Estado:** diseño aprobado (Juan, 2026-09-01)
**Pedido por:** Juan

## 1. Qué se quiere y por qué

El 2026-09-01, en menos de 4 minutos, el carril de compra le mandó a Catherine
**10 alertas** para el mismo mandato (cliente de Daiana Zea: apartamento en
Envigado, hasta $500M), casi todas de propiedades en **Sabaneta** (zona
vecina, no la pedida), varias por encima del presupuesto, con habitaciones o
garajes de menos. Cada una salió con el mismo encabezado de confianza
("🎯 Oferta nueva que le sirve"), sin distinguir un match real de uno que
apenas roza el criterio.

Se quiere: lo que calza bien se sigue mandando exactamente como hoy. Lo que
pasa el filtro pero con reservas de fondo (zona vecina, sobreprecio,
habitaciones o baños de menos) se sigue mandando —no se descarta nada nuevo—
pero con un encabezado distinto que le diga al asesor "esto es para revisar
con el colega, no un match confirmado", en vez de presentarlo con la misma
confianza que uno perfecto.

## 2. Contexto: esto AFINA una decisión reciente, no la revoca

`src/groups/cruce-mandatos.js` documenta una decisión explícita de Juan del
2026-08-25: *"filo bajo, salvedades escritas. El sistema no descarta por el
asesor — le manda lo que se acerca y le dice exactamente que falta"*, con la
razón: *"los falsos negativos son invisibles por definición y son los
caros"*.

Este diseño **no toca esa garantía**: nada que hoy pasa el portón de 3 cortes
duros (operación, zona exacta-o-vecina, precio ≤15% sobre el tope) deja de
mandarse. Se agrega una clasificación ENCIMA de lo que ya pasa el portón —
"fuerte" vs "revisar" — para que la confianza que transmite el mensaje sea
honesta, no para volver a descartar nada. Es un afine, no una revocación.

En el carril de venta pasa algo parecido pero ya resuelto a medias:
`src/groups/revalidar.js` (comentario 2026-08-24 en adelante) ya tiene una
taxonomía de 3 casos por candidata — INCOMPATIBLE (no entra a
`refs_utiles`), INCOMPLETO (entra, con `sin_confirmar` por dato que el
inventario no registra) y CASI (entra, con `le_falta` por un dato conocido
que no cumple, accesorio). El hueco real no es que se pierda información: es
que Sofi tiene que decidir SIEMPRE en binario (entra o no entra a
`refs_utiles`) para cada candidata, sin una tercera opción para el caso
genuinamente dudoso — ni tan claro como para mandarlo con la confianza de
siempre, ni tan malo como para descartarlo. Ese caso hoy se fuerza a un lado
o al otro.

## 3. Diseño — Carril de compra (`src/groups/cruce-mandatos.js`)

`evaluarOferta(oferta, mandato)` ya calcula todo lo necesario para clasificar
sin agregar ningún cálculo nuevo — solo hay que leer las mismas señales que
ya construye (`m.ubicacion`, la comparación de `precio` contra `c.precio_max`,
y los `blandos` de habitaciones/baños) y devolver un nivel:

- **`fuerte`**: `m.ubicacion === "exacta"` Y el precio no se pasa del tope
  exacto (`precio <= c.precio_max`, sin usar el margen del 15%) Y, si el
  mandato pidió habitaciones y/o baños, la oferta los cumple o los supera —
  o cae justo en el caso ya previsto de `flexible_habitaciones` (una menos
  con estudio o servicio: el cliente ya dijo que eso le sirve, no es un
  motivo para bajarlo a "revisar"). No cae en la rama `corto`/`sinDato` de
  esos dos `blandos` puntuales por ningún otro motivo — área, garajes,
  estrato y exigencias siguen siendo blandos aun en el nivel fuerte, igual
  que hoy.
- **`revisar`**: pasa el portón de 3 cortes duros que ya existe, pero no
  cumple alguno de los criterios de `fuerte` arriba (zona vecina, o precio
  entre el tope exacto y el 15% de margen, o falta una habitación/baño
  pedido).

`evaluarOferta` devuelve el nivel como un campo nuevo en su resultado
(`nivel: "fuerte" | "revisar"`), junto a lo que ya devuelve
(`sirve, puntaje, ubicacion, cumple, salvedades`) — no se cambia el shape
existente, se agrega un campo. `null` (no pasa el portón) sigue significando
exactamente lo mismo que hoy.

`src/groups/avisar-mandato.js` (quien arma y manda el texto del aviso) usa
ese `nivel` para elegir el encabezado del mensaje:
- `fuerte` → el encabezado de siempre: `"🎯 Oferta nueva que le sirve a {cliente}"`.
- `revisar` → `"🔎 Revisar con el colega — match parcial para {cliente}"`.

El cuerpo del mensaje (zona, precio, `Cumple:`/`Ojo:`) **no cambia** — esa
información ya es honesta y completa hoy; el problema era solo el
encabezado prometiendo más confianza de la que había.

## 4. Diseño — Carril de venta (`src/groups/revalidar.js` + `src/groups/vivo.js#asistir`)

Se agrega un cuarto campo al esquema de veredicto, junto a `refs_utiles`:

- **`refs_dudosas`**: refs que Sofi no aprueba para el envío normal (no
  entran a `refs_utiles`, no se le mandan al colega ni se auto-publican en
  el grupo) pero que tampoco son claramente INCOMPATIBLES — están cerca y
  vale la pena que la asesora las revise con el colega. Mismo shape que
  `refs_utiles` (array de strings), con su propio criterio explícito en el
  prompt de sistema: candidatas donde falla algo que SÍ importa (no es
  accesorio, por eso no califican para `le_falta`) pero no lo suficiente
  como para ser un descarte limpio — el caso borde que hoy el prompt fuerza
  a decidir en un solo sentido.

En `src/groups/vivo.js#asistir()`, después de armar `utiles` (sin cambios),
se arma también `dudosas` de la misma forma
(`veredicto.refs_dudosas.map(ref => matches.find(...))`). Si `dudosas.length > 0`,
se agrega al aviso del asesor (`alertaAsesor.construir`, o un bloque nuevo
inmediatamente después en el mismo mensaje) una sección con encabezado
`"🔎 Para revisar (no confirmadas):"` listando esas propiedades con el mismo
formato de `linea()` que ya existe — nunca se le mandan al colega directo
(eso sigue siendo exclusivo de `refs_utiles`).

## 5. Qué NO cambia

- Ningún portón de entrada de ningún carril (los 3 cortes duros de compra,
  la clasificación INCOMPATIBLE de venta) — lo que hoy se descarta, se
  sigue descartando igual.
- El volumen de mensajes: Juan pidió explícitamente uno por uno, marcado
  como "revisar", no agrupado en un resumen.
- El mecanismo de envío (`mensajeAsesor.enviarYRegistrar`, límites diarios,
  escalado por silencio) — el nivel solo cambia el texto del encabezado, no
  a quién ni cómo se manda.
- El DM directo al colega en el carril de venta — sigue siendo exclusivo de
  `refs_utiles`, `refs_dudosas` nunca sale de la conversación con el asesor.

## 6. Testing

- `test/group-cruce-mandatos.test.js`: casos nuevos para `nivel: "fuerte"`
  (zona exacta + precio dentro del tope + habitaciones/baños cumplidos) y
  `nivel: "revisar"` (zona vecina; precio entre el tope y el margen del 15%;
  falta una habitación pedida) — sobre el mismo `evaluarOferta` puro que ya
  se prueba hoy, sin mocks nuevos.
- `test/group-avisar-mandato.test.js`: el encabezado del mensaje cambia
  según `nivel`, el resto del cuerpo no.
- `test/group-revalidar.test.js`: el esquema acepta `refs_dudosas`, y un
  caso donde una ref aparece en `refs_dudosas` y no en `refs_utiles` (y
  viceversa — nunca en ambas a la vez).
- `test/group-asistido.test.js` (o el archivo que cubra `asistir()`): con
  `refs_dudosas` no vacío, el aviso al asesor incluye la sección "Para
  revisar", y esas propiedades NO llegan al DM del colega.

## 7. Fuera de alcance de este documento

Quedan pendientes, ya identificadas por Juan como piezas separadas:

- **Identidad del remitente** (cliente / colega / asesor interno).
- **Informe agregado** (mensajes contestados, clientes adquiridos, visitas
  agendadas).
