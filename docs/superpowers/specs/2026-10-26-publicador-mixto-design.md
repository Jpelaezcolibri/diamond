# Publicador mixto y acorde al grupo — diseño

Fecha: 2026-10-26 · Estado: diseño aprobado por Juan (2026-10-26) · Rama: `publicador-mixto`
Base: spec `2026-10-19-publicador-grupos-design.md` (publicador en producción desde el 19-oct).

## 1. Por qué

Juan (2026-10-26): "revisa que en los grupos que publicamos también estemos escuchando y respondiendo,
aumenta el número de publicaciones diarias y haz las publicaciones mixtas, las mejores propiedades para
venta y las propiedades para renta, necesito que cada una de las propiedades sea acorde al grupo en el
cual se está publicando". Foco del momento: los arriendos.

Estado medido el 2026-10-26:
- 10 grupos con `publica`: 4 amoblados, 3 fincas y 3 ofertas. Los 10 escuchan desde hoy;
  "Renta y Venta Amoblados y Airbnb" y "FINCAS NORTE ANT" publicaban sin escuchar.
- ~10 posts al día (`RADAR_PUBLICAR_MAX_DIA=10`), 1 por grupo por día.
- No hay filtro de zona: "OFERTAS SUR POB ENV SAB" puede recibir una propiedad de Laureles.
- "ARRIENDOS 7AM 8PM" (717 miembros, 30 pedidos en 7 días) solo recibe amoblados.

Decisiones de Juan: **2 posts por grupo al día (~20)**; **perfil automático** por grupo; los grupos de
arriendo general reciben **arriendo con y sin amoblar**.

## 2. Alcance

**Entra:** perfil por grupo y encaje de zona/operación/tipo; categoría `arriendos`; dos franjas por día; mezcla
venta/arriendo en OFERTAS; orden por pedidos del propio grupo; alerta si un grupo que publica no escucha.

**No entra:** responder a quien contesta los posts (`RADAR_RESPUESTAS_POST`, depende de suscribir `message.any`);
entrar a grupos nuevos; publicar en grupos que hoy no tienen `publica`.

## 3. Perfil del grupo (`src/groups/perfil-grupo.js`, puro)

`perfilDe(grupo, pedidosDelGrupo) → { zonas: string[], operacion: "venta"|"arriendo"|null, tipos: string[], pedidos: Pedido[] }`

1. **Override manual:** si `grupo.perfil` (jsonb nuevo) trae `zonas`, `operacion` o `tipos`, eso manda campo por campo.
2. **Del nombre** (normalizado, sin tildes, por palabra completa):

| Palabra en el nombre | Zonas |
|---|---|
| `SUR` | Envigado, Sabaneta, La Estrella, Itagüí, Caldas |
| `POB` / `POBLADO` | El Poblado |
| `ENV` / `ENVIGADO` | Envigado |
| `SAB` / `SABANETA` | Sabaneta |
| `ITAGUI` | Itagüí |
| `ESTRELLA` | La Estrella |
| `LAURELES` | Laureles |
| `BELEN` | Belén |
| `ORIENTE` | Rionegro, El Retiro, La Ceja, Guarne, Marinilla, El Carmen de Viboral, Llanogrande |
| `OCCIDENTE` | San Jerónimo, Santa Fe de Antioquia, Sopetrán |
| `NORTE` (con `ANT`) | Bello, Copacabana, Girardota, Barbosa, San Pedro de los Milagros, Santa Rosa de Osos |

   Varias palabras suman zonas. Sin palabra de zona → `zonas: []` (acepta todas).
   Operación: `ARRIENDO`/`ARRIENDOS`/`RENTA`/`AMOBLADO(S)`/`AIRBNB` → `arriendo`; `VENTA`/`VENTAS` sin las anteriores → `venta`;
   si aparecen las dos ("Renta y Venta Amoblados") → la categoría `publica` decide.
3. **De los pedidos del grupo** (`group_signals` clase demanda del grupo, últimos 30 días): no restringen, **ordenan** (§5).

## 4. Qué puede salir en cada grupo

`aptaParaGrupo(p, grupo, perfil)`:
1. Compuerta de categoría (existente `aptaPara`, más la nueva):
   - `amoblados`: igual que hoy.
   - `fincas`: igual que hoy.
   - **`arriendos` (nueva):** arriendo con `aptaParaKit`, precio creíble, **mensual** (periodo Wasi `mensual`, o sin periodo y sin texto de noche/día), con zona; amoblado o no; fincas no.
   - `ofertas`: igual que hoy (venta de asesor, venta de Wasi o amoblado) **más** los arriendos de la categoría `arriendos`.
2. **Zona:** si `perfil.zonas` no está vacío, la propiedad entra con un **grado**:
   `exacta` si `ubicacion.zonaCoincide(p, { zonas: perfil.zonas })` (exacta o sub-zona), `vecina` si
   `ubicacion.zonaVecina(p, { zonas: perfil.zonas })` (zona contigua de `VECINDAD`), y si no, no entra.
   **Excepción de Juan (2026-10-26):** "si no tenemos propiedad con zona exacta para ofrecer en los grupos tenemos que
   hacer excepciones para ofrecer zonas cercanas… primero se ofrezcan los que cumplen y luego las zonas cercanas".
   Solo aplica a las publicaciones en grupos; el DM al colega sigue literal (sin vecinas). Sin zonas en el perfil, todo es `exacta`.
3. **Operación:** si `perfil.operacion` existe, la propiedad debe ser de esa operación.
4. **Tipos:** si `perfil.tipos` existe, el tipo debe estar entre ellos (comparación normalizada; dúplex/penthouse/loft cuentan como apartamento, como en `match.js`).

## 5. Orden: "las mejores primero"

Dentro de lo que encaja, se ordena por (en este orden):
0. **Grado de zona: `exacta` antes que `vecina`.** Una vecina solo sale si en ese grupo no hay ninguna exacta disponible.
1. Asesor recién publicado (existente).
2. **Franja/mezcla (solo OFERTAS):** franja de mañana → venta primero; franja de tarde → arriendo primero.
3. Ref que ya salió hoy en otro grupo va al final (existente).
4. **Pedidos del grupo que calzan:** cuántos pedidos del grupo (30 días) tienen la misma operación, zona que coincide
   (`zonaCoincide(p, pedido)`) y precio de la propiedad ≤ `precio_max` del pedido × 1,1 (si el pedido trae precio).
   Si el grupo no tiene pedidos, se usa la demanda de la org por zona (lo de hoy, `demandaDe`).
5. **Ficha completa:** +1 por cada uno de: área, administración, al menos una foto.
6. La que lleva más tiempo sin salir (existente).

## 6. Dos posts por grupo al día

- `RADAR_PUBLICAR_POR_GRUPO` (default **1**, Juan lo pone en **2**); `RADAR_PUBLICAR_MAX_DIA` sube a **20** en Railway.
- Franjas (Bogotá, lunes a sábado): **mañana 8:00–11:59**, **tarde 14:00–17:59**. Con `POR_GRUPO=1` se publica en todo el horario 8–18 como hoy.
- Con `POR_GRUPO=2`: el post *k* de un grupo (0 = mañana, 1 = tarde) solo sale en su franja; un grupo no recibe dos en la misma franja.
- Espaciado entre posts: **15–30 min** (antes 20–40).
- Siguen: 7 días sin repetir una ref en el mismo grupo, pausa del día si falla un envío, una sola sesión WORKING, inventario fresco.

## 7. Grupos y categoría

Migración `2026-10-26_publicador_mixto.sql` (la corre Juan):
- `whatsapp_groups.perfil jsonb` (override, null por defecto).
- Restricción `publica in ('amoblados','fincas','ofertas','arriendos')`.
- `update whatsapp_groups set publica = 'arriendos' where jid = '573003371490-1496864741@g.us'` (ARRIENDOS 7AM 8PM).

Perfiles esperados con los nombres de hoy: OFERTAS SUR POB ENV SAB → Poblado + sur; FINCAS NORTE ANT → norte (hoy no
tenemos fincas allá: no recibirá posts, y es lo correcto); los demás sin zona.

## 8. Escuchar los grupos donde publicamos

En cada corrida, si un grupo con `publica` está en `modo = 'ignorar'`, se loguea `[publicador] publica pero no escucha: {nombre}`
y se manda **una** alerta técnica por día (`d.alertar`). No se cambia el modo solo.

## 9. Errores y seguridad

- Sin la columna `perfil` (migración sin correr): el perfil sale solo del nombre; no falla.
- Sin `arriendos` en la restricción: el update de la migración no corre y el grupo sigue como `amoblados`.
- Interruptor de siempre: `RADAR_PUBLICAR_ACTIVO`. Volver a 1 por grupo: `RADAR_PUBLICAR_POR_GRUPO=1` sin desplegar.

## 10. Pruebas

Perfil por nombre (cada palabra, combinaciones, override); encaje de zona (exacta, sub-zona, vecina rechazada);
categoría `arriendos` (con y sin amoblar, por noche rechazado, finca rechazada); franjas (2 por grupo, no dos en la
misma franja, `POR_GRUPO=1` igual que hoy); mezcla de OFERTAS por franja; orden por pedidos del grupo; alerta de
grupo que no escucha; los tests existentes del publicador siguen en verde (ajustando nombres de grupo de prueba si
un nombre activa un filtro de zona).
