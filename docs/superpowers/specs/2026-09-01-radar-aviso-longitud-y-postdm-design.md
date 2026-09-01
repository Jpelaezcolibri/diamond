# Radar: aviso al asesor sin pasarse del límite de WhatsApp + aviso post-DM

**Fecha:** 2026-09-01
**Estado:** diseño aprobado (Juan, 2026-09-01)
**Pedido por:** Juan

## 1. Qué se quiere y por qué

El 2026-09-01, un pedido real (Mateo Narváez, "La Provenza Real Estate", 6
propiedades en Laureles) generó un aviso a Natalia que **Meta rechazó**:
`"Param text.body must be at most 4096 characters long."` Natalia nunca supo
de ese pedido — no fue un caso de "modo automático" mandando algo al grupo
(eso nunca pasó, Sofi-Comando inventó esa parte al pedirle a Juan que
confirmara el incidente — verificado directo en base: `politica_traza`
dice `"NO:sin_telefono"`, y el mensaje real es un aviso privado a Natalia,
nunca un post en el grupo).

La causa real: el aviso trae **dos invitaciones casi idénticas** a escribirle
a Sofi (una dentro del bloque "mensaje listo para reenviar" que ya agregó
`src/groups/alerta-asesor.js` esta misma sesión, otra aparte al final del
aviso), y **la lista de propiedades aparece dos veces completas** (una corta
en "Le pueden servir", otra en detalle dentro del mensaje para reenviar). Con
6 propiedades, la suma pasa el límite de Meta.

Separado, pero relacionado: hoy, cuando el DM directo al colega SÍ sale
(hay teléfono resuelto), la función corta camino y no le dice nada a la
asesora — correcto si no queda nada pendiente, pero si ese mismo pedido tenía
propiedades `refs_dudosas` (ver el diseño del 2026-09-01 sobre nivel
fuerte/revisar), esas se pierden sin que nadie las vea.

## 2. Diseño — Parte A: nunca pasarse de 4096 caracteres

En `src/groups/alerta-asesor.js#construir`:

1. **Quitar la invitación a Sofi duplicada.** El bloque `linkSofi` (`"Para que
   la conversación quede en nuestro sistema, cerrale invitándolo a
   escribirle a Sofi..."`) solo se agrega si el mensaje para reenviar
   (`mensajeListoParaReenviar`) NO se agregó — ese mensaje ya trae su propia
   invitación (viene de `redactar.js#mensajeGrupo`, que la incluye siempre
   que hay `linkContactoOficial`).

2. **Tope de seguridad genérico.** Después de armar `lineas` completo y
   unirlo (`lineas.join("\n")`), si el resultado supera 4000 caracteres
   (margen de seguridad bajo el límite real de Meta de 4096) Y el mensaje
   para reenviar se agregó (la fuente de la duplicación de datos), se
   reconstruye el bloque "Le pueden servir" reemplazando el listado completo
   por una sola línea de conteo: `"Le pueden servir N propiedades — el
   detalle completo va más abajo, en el mensaje listo para reenviar."` Nunca
   se pierde información — la misma lista ya está completa en el mensaje
   para reenviar, unas líneas más abajo. No se trunca nada más: si con este
   solo cambio ya queda bajo el límite (caso esperado dado que la lista de
   propiedades es la parte más pesada del mensaje), no hace falta seguir
   recortando.

## 3. Diseño — Parte B: aviso cuando el DM sale bien pero quedan dudosas

Nueva función, `construirAvisoPostDm(senal, veredicto, matches, refsEnviadas)`
en `src/groups/alerta-asesor.js` — deliberadamente separada de `construir`
(la forma del mensaje es distinta: no hace falta `Contacto:` porque la
asesora no tiene que contactar a nadie, el DM ya salió):

- Recibe `refsEnviadas` (las refs que SÍ se mandaron por DM — ya se sabe en
  `vivo.js#asistir`, es `utiles.map(m => m.ref)`) y `veredicto.refs_dudosas`.
- Si `refs_dudosas` está vacío, la función devuelve `null` — no hay nada
  pendiente que avisar (comportamiento actual sin cambios).
- Si no está vacío, arma:

```
✅ Ya le mandé por privado a {colega}: Ref X, Ref Y...

🔎 Esto otro quedó sin mandar (no confirmado) — decidí vos si vale la pena:
{listado con linea(), igual formato que "Para revisar" en construir}
```

En `src/groups/vivo.js#asistir`, en la rama donde el DM sale bien
(`envioDm && envioDm.ok`), ANTES del `return { resultado: "dm_enviado", ... }`:
llamar a `alertaAsesor.construirAvisoPostDm(...)`; si devuelve texto (no
`null`), mandarlo al asesor principal por el mismo canal que ya usa el resto
de esta función (`mensajeAsesor.enviarYRegistrar`), best-effort (un fallo acá
no puede tumbar el `resultado: "dm_enviado"` que ya es verdad).

## 4. Qué NO cambia

- El límite de 4096 de Meta es de ellos, no nuestro — este diseño nunca
  intenta subirlo, solo evita que el aviso lo alcance.
- El mensaje para reenviar al colega no cambia en absoluto — la
  deduplicación solo afecta el aviso INTERNO a la asesora.
- Cuando el DM sale bien y NO hay dudosas, sigue sin avisarse nada (el
  comportamiento actual documentado como correcto: "no tiene nada que hacer
  con un pedido que el bot ya resolvió").

## 5. Testing

- `test/alerta-asesor.test.js`: con `mensajeListoParaReenviar` presente, NO
  aparece la invitación a Sofi duplicada (antes de este fix, ambas
  aparecían). Con un pedido de muchas propiedades que haría que el mensaje
  supere 4000 caracteres, el bloque "Le pueden servir" se reduce a la línea
  de conteo — y el texto final queda bajo 4096. Con pocas propiedades
  (mensaje corto), nada cambia respecto a hoy.
- Nueva suite para `construirAvisoPostDm`: sin `refs_dudosas` devuelve
  `null`; con `refs_dudosas` arma el mensaje con las refs enviadas y las
  dudosas correctamente separadas.
- `test/group-vivo.test.js` (o el archivo que cubra la rama `dm_enviado` de
  `asistir`): con dudosas presentes, se manda un segundo mensaje al asesor
  principal (postDM) además del DM al colega; sin dudosas, sigue sin
  mandarse nada extra.

## 6. Fuera de alcance de este documento

Quedan pendientes, ya identificadas por Juan:

- **Identidad del remitente** (cliente / colega / asesor interno).
- **Informe agregado** (mensajes contestados, clientes adquiridos, visitas
  agendadas).
