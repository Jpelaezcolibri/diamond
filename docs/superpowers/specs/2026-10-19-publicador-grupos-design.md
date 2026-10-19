# Publicador automático de amoblados en grupos

Fecha: 2026-10-19 · Estado: aprobado por Juan (opción A, "publicación
automática por WAHA en todos los grupos de amoblados donde esté Daiana,
asumiendo el riesgo de baneo"; sin día en sombra).

## 1. Por qué

Juan quiere ofrecer los amoblados en los grupos gremiales desde la línea de
Daiana, de forma automática, para que el colega le escriba a Sofi y agende la
visita. El kit (`/kit`, spec 2026-10-16) dejó fuera la publicación automática
(F4) por el riesgo de baneo; Juan decidió asumirlo.

El 2026-10-19 se publicaron a mano 7 posts (uno por grupo) con el mismo texto
que usará el publicador; el registro está en
`Claude outputs/publicaciones-grupos-2026-10-19.json` y la migración los
carga para que el candado de 7 días los cuente.

**Riesgo aceptado:** publicar por un cliente no oficial (WAHA) es el patrón
con más baneos. La línea de julio se perdió después de un `503`. El freno de
la §5 corta el día ante el primer error.

## 2. Qué se publica

Compuertas, todas obligatorias (`src/groups/publicador.js`):

- Las del kit (`kit.aptaParaKit`): disponible, link de Wasi, al menos una foto,
  ref no bloqueada. Y el link tiene que abrir (`kit.post` → `linkOk`).
- Inventario fresco (`syncEstado.estadoDelInventario`); si no, no sale nada.
- Arriendo.
- Categoría del grupo:
  - `amoblados`: `amoblado.esAmoblada === true`, zona cargada, que no sea finca
    y precio sin período dudoso (el texto no dice "noche", "por día" ni
    "diario").
  - `fincas`: tipo o título finca y el texto dice UNO solo de "mes/mensual" o
    "noche"; el período sale en el encabezado del post.

Lo que falla una compuerta no sale y entra solo el día que Wasi lo corrija. Al
19-oct pasan 9 amoblados y 0 fincas.

## 3. Dónde

`whatsapp_groups.publica` (`amoblados` | `fincas` | null). La migración
marca:

- amoblados: RENTA AMOBLADOS/FINCAS, Arriendos F y A amoblados, Renta y Venta
  Amoblados y Airbnb, ARRIENDOS 7AM 8PM, OFERTAS SUR POB ENV SAB, OFERTAS
  7:00 A.M.8:00P.M., OFERTAS 2 7am 8pm.
- fincas: Fincas 7AM 8PM, FINCAS 2 7:00AM-8PM, FINCAS NORTE ANT 7AM 8PM.

Membresía de Daiana confirmada con WAHA el 2026-10-19. Nunca grupos de
PEDIDOS (sus reglas prohíben ofertas) ni los internos de Paraíso. La columna
es independiente de `modo`: un grupo puede estar en `ignorar` y publicarse.

## 4. Ritmo

- Lunes a sábado, de 8 a. m. a 6 p. m. (Bogotá).
- Máximo 1 post por grupo por día y `RADAR_PUBLICAR_MAX_DIA` (8) posts por
  día en toda la línea; los fallos cuentan.
- Entre dos posts, 20 a 40 min al azar; tras un reinicio, 20 min desde el
  último registrado.
- La misma ref no vuelve al mismo grupo antes de 7 días.
- Se elige el grupo que hace más tiempo no recibe nada y, para él, la ref que
  hace más tiempo no sale en ningún grupo (las nunca publicadas primero).
- El scheduler mira cada 5 min; cada tick envía como mucho un post.

## 5. Freno

- `RADAR_PUBLICAR_ACTIVO=true` lo enciende; apagado por defecto (envío
  automático desde una línea no oficial, igual que `ventana-asesora`).
- Sin la tabla `grupo_publicaciones` no publica: el candado de 7 días y el
  tope dependen de ella (falla cerrado).
- Exactamente una sesión `activa` y en estado `WORKING`; si no, no envía y
  avisa una vez al día.
- Un envío que falla queda registrado como `fallo`, **pausa el resto del día**
  y manda alerta técnica a `ALERTA_TECNICA_TO` (Juan, nunca una asesora).

## 6. Texto

Apertura que rota (4 variantes para amoblados, 1 para fincas, según día y
grupo) + `redactar.postGrupo` sin cambios: datos de la ficha, "Comparto
comisión con colegas", link de Wasi (la vista previa trae la foto: WAHA CORE
no envía imágenes) y link a Sofi "Hola, vi en un grupo la Ref N".

## 7. Del grupo a la visita

Sin código nuevo: el colega abre el link de Sofi; Sofi atribuye `kit_ref`
(requiere la migración `2026-10-16_kit_publicacion.sql`, aún sin correr) y
agenda con la rotación. Si le escribe a la línea de Daiana, el puente le
responde con el link a Sofi.

## 8. Pruebas

`test/publicador-grupos.test.js`: compuertas, horario, tope, espaciado,
candado de 7 días, rotación, fallo que pausa, falla cerrado sin tabla o sin
sesión.
