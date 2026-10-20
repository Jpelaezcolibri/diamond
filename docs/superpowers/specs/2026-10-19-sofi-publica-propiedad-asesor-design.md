# Sofi publica la propiedad de un asesor

Fecha: 2026-10-19 · Estado: diseño aprobado por Juan ("Apruebo el diseño tal
cual"). Se apoya en el publicador de grupos
(`2026-10-19-publicador-grupos-design.md`).

## 1. Por qué

Juan: "que cuando cualquiera de los asesores le diga a Sofi que quiere publicar
una propiedad en arriendo o venta en los grupos, Sofi le solicite la
información necesaria para hacerlo y que lo haga, con el fin de que Sofi sea un
asesor comercial automatizado".

Decisiones de Juan, en orden:

1. **Vale cualquier propiedad**, esté o no en Wasi: Sofi le pide todos los
   datos al asesor (opción B).
2. **Fotos por la landing**: Sofi recibe las fotos por WhatsApp y arma la
   ficha en nuestra landing; el post lleva ese link y la vista previa muestra
   la foto (WAHA CORE no envía imágenes).
3. **Inventario completo**: la propiedad se publica en grupos, Sofi la ofrece
   a clientes y el radar a colegas, con el asesor como captador.
4. **Vigencia de 30 días**: a los 25 Sofi le pregunta al asesor si sigue
   disponible (excepción a `ASESORA_SOLO_VISITAS`); sin respuesta en 5 días,
   sale del inventario.

## 2. Flujo con el asesor

Sofi reconoce al asesor por su teléfono (`ctx.advisor`, `engine.js`). Ante
"quiero publicar un apto en arriendo" (o venta), pide **lo que falte**, de a
poco, en conversación:

| Dato | Obligatorio |
|---|---|
| operación (venta / arriendo) | sí |
| tipo (apartamento, casa, apartaestudio, finca, local, oficina, lote) | sí |
| barrio o sector **y** municipio | sí |
| precio (número) | sí |
| período del canon (mensual / diario) | sí, si es arriendo |
| amoblado (sí / no) | sí, si es arriendo |
| área m² | sí |
| alcobas, baños | sí, salvo local / oficina / lote |
| parqueaderos, estrato, administración | no (si no los dice, la ficha no los muestra) |
| descripción corta | no (Sofi la redacta solo con los datos dados, sin inventar) |
| fotos | al menos 1, máximo 10 |

- Nada a medias: sin un obligatorio no se crea. Sofi dice exactamente qué
  falta.
- **Fotos:** las que el asesor mandó en su chat con Sofi en las últimas 6 h
  (ya quedan en el bucket `media`, `whatsapp.js#persistIncomingMedia`). Sofi
  no ve las fotos; la herramienta le dice cuántas encontró y Sofi se lo dice
  al asesor ("recibí 6 fotos; si alguna no es de esta propiedad, dime").
- **Vista previa y confirmación:** `preparar_publicacion` valida y devuelve el
  texto del post tal como saldrá, lo que falta y un `token` (hash de los datos
  + las fotos). Sofi se lo muestra al asesor. Solo con un "sí" explícito llama
  `confirmar_publicacion` con los mismos datos y el token; si los datos
  cambiaron, el token no coincide y hay que volver a preparar. Sin tabla de
  borradores.
- Al confirmar, Sofi le responde con la ref y el link de la ficha: "Listo, es
  la D1004: <link>. Sale en los grupos en los próximos turnos".

## 3. La ficha

- Fila en `properties`:
  - `ref` = `D` + consecutivo (`D1001`, `D1002`…), el siguiente al mayor
    existente; reintenta si choca con `unique(org_id, ref)`. Sin guion: la
    landing toma la ref del último segmento del slug.
  - `origen = 'asesor'` (columna nueva; las de Wasi quedan `'wasi'`).
  - `captador_id` = el `advisors.id` del asesor.
  - `link` = la ficha de la landing (`<landing_base_url>/propiedades/<slug>`).
    El sync de Wasi no toca filas cuyo link no es de Wasi
    (`isWasiManagedLink`, `wasi-public` filtra `info.wasi.co`), así que
    nunca la da de baja.
  - `images` = las URLs públicas de Supabase de las fotos, en el orden en que
    llegaron.
  - `periodo_precio` (migración del 2026-10-19), `vence_at` = ahora + 30 días
    y `vigencia_preguntada_at` = null (columnas nuevas).
  - `caracteristicas` incluye "Amoblado" si lo es (lo lee
    `amoblado.esAmoblada`).
- **Landing:** la página `web/app/propiedades/[slug]` ya sirve filas sin link
  de Wasi y usa `images[0]` como og:image. Cambio: agregar el host de
  Supabase Storage a `img-src` del CSP y a `images.remotePatterns`
  (`web/next.config.*`). La ficha aparece en ~5 min (`revalidate = 300`).

## 4. Inventario completo

Sin código nuevo de búsqueda: la fila es una propiedad disponible más.

- Sofi la ofrece a clientes (`buscar_propiedades`) y, si un cliente pregunta
  por ella, el captador recibe el aviso que ya existe (`maybeCaptadorAlert`).
- El radar la cruza con los pedidos de colegas. `publicable.js` exige
  `linkWasi` no vacío y que el link no sea ajeno: hay que verificar en el plan
  que una ficha de la landing pase esas compuertas (o ajustarlas para
  `origen = 'asesor'`) sin aflojarlas para las de Wasi.

## 5. Publicación en grupos

- **Categoría nueva `ofertas`** en `whatsapp_groups.publica`: recibe los
  amoblados de siempre **y** cualquier propiedad `origen = 'asesor'` (venta o
  arriendo) con zona y área. Los 3 grupos OFERTAS de Daiana (OFERTAS SUR POB
  ENV SAB, OFERTAS 7:00 A.M.8:00P.M., OFERTAS 2 7am 8pm) pasan de
  `amoblados` a `ofertas`.
- Las de asesor también entran a `amoblados` (si son amoblado en arriendo
  mensual) y a `fincas` (si son finca con período), con las compuertas de
  siempre.
- **Primera en la fila:** en `publicador.elegir`, para cada grupo, una
  propiedad `origen = 'asesor'` creada hace menos de 7 días y nunca publicada
  en ese grupo va antes que el resto. Respeta horario, tope diario, 1 por
  grupo por día y espaciado.
- **No antes de 15 min:** una propiedad recién creada no se publica hasta 15
  min después de `created_at`, para que la caché de la landing ya la sirva y
  la verificación del link (`kit.post` → `linkOk`) no la marque rota todo el
  día.
- **Aviso al asesor (Juan, 2026-10-20):** la primera vez que sale en un grupo,
  el publicador le avisa al captador por la campana del CRM (`notificaciones`,
  tipo `propiedad_publicada`, "Tu D1004 salió en OFERTAS SUR POB ENV SAB";
  push si lo activó), no por WhatsApp. Una vez por propiedad.
- La venta de Wasi sigue sin publicarse: solo sale la venta que pide un
  asesor.

## 6. Vigencia

Todo aviso sobre las propiedades que el asesor le pidió publicar a Sofi va por
la campana del CRM, no por WhatsApp (Juan, 2026-10-20). No hay plantilla de
Meta. Mockup: `docs/superpowers/mockups/2026-10-20-vigencia-crm.html`.

- Scheduler horario (`src/scheduler/vigencia-asesor.js`, 9 a. m. a 6 p. m.
  Bogotá):
  - `vence_at - 5 días <= ahora` y `vigencia_preguntada_at` null → notificación
    `vigencia_propiedad` ("D1004 vence en 5 días", link `/pendientes`); marca
    `vigencia_preguntada_at`. El asesor responde en "Para atender" del CRM,
    sección "Tus propiedades por renovar", con dos botones (Sigue disponible /
    Ya no está) que llaman `POST /api/propiedades/vigencia`.
  - `vence_at <= ahora` → `disponible = false` (sale del inventario y de la
    rotación; la baja corre siempre) y notificación `vigencia_vencida`.
- Herramienta `actualizar_vigencia` (solo asesor): "sigue disponible" →
  `vence_at` = ahora + 30 días y `vigencia_preguntada_at` = null; "se arrendó /
  se vendió / ya no" → `disponible = false` de inmediato. El asesor la puede
  usar en cualquier momento por WhatsApp; es el camino de Claudia, que no
  tiene usuario del CRM. Los botones `vig:` por WhatsApp se conservan por si
  algún mensaje viejo los trae.
- Solo sobre `origen = 'asesor'` y solo propiedades de las que el asesor es
  captador.
- Excepción explícita a `ASESORA_SOLO_VISITAS`, con su propio interruptor
  (`SOFI_VIGENCIA_ASESOR=false` apaga la pregunta; igual vence a los 30 días).

## 7. Sofi (prompt y herramientas)

- Herramientas nuevas en `TOOL_DEFINITIONS`, cada una con
  `if (!ctx.advisor) return ...` como `confirmar_cita`:
  `preparar_publicacion`, `confirmar_publicacion`, `actualizar_vigencia`.
- `promptAsesor`: hoy dice "vos NUNCA publicas nada en ningun grupo". Se
  acota: sigue sin publicar respuestas a pedidos del radar en grupos (norma
  del gremio, 2026-08-22), y se agrega la sección "CUANDO QUIERE PUBLICAR UNA
  PROPIEDAD" con el flujo de la §2: pedir lo que falta, nunca inventar un dato,
  mostrar la vista previa, confirmar solo con un sí explícito.
- Interruptor `SOFI_PUBLICA_ASESOR` (apagado por defecto). Apagado, las
  herramientas responden que la función no está activa y el prompt no ofrece
  publicar.

## 8. Migración

`db/migrations/2026-10-19_propiedades_asesor.sql`, solo agrega:

- `properties.origen text not null default 'wasi'` con check
  (`wasi` | `asesor`), `vence_at timestamptz`,
  `vigencia_preguntada_at timestamptz`.
- `whatsapp_groups.publica`: el check admite `ofertas`; los 3 grupos OFERTAS
  pasan a `ofertas`.

Sin la migración las herramientas responden que falta y no crean nada (falla
cerrado).

## 9. Errores

- Un dato que no cuadra (precio sin números, área de 0 o > 100.000 m², ref
  ajena) → la herramienta lo devuelve como faltante y Sofi lo pregunta.
- Sin fotos en las últimas 6 h → no se crea; Sofi pide las fotos.
- Fallo al crear la fila → Sofi dice que no se pudo y no promete publicar.
- Las herramientas nunca publican directo en un grupo: solo crean la
  propiedad; publicar es siempre el publicador, con su freno.

## 10. Pruebas

- Herramientas: datos completos → vista previa + token; faltantes → lista
  exacta; token que no coincide → no crea; no asesor → rechazo; consecutivo D
  con choque; fotos de las últimas 6 h.
- Publicador: categoría `ofertas`, prioridad de la propiedad de asesor, espera
  de 15 min, aviso único al captador.
- Vigencia: pregunta a los 25 días una sola vez, baja a los 30, renovación,
  "se arrendó", interruptor apagado.
- Los tests existentes del prompt de asesor (citas, aprobaciones, cierre del día) siguen en verde, para
  que no se mueva lo que ya hace.
