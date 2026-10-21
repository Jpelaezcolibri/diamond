# Módulo de publicaciones y respuestas de los grupos

Fecha: 2026-10-20 · Estado: diseño aprobado por Juan ("Apruebo el módulo con el
recordatorio a Daiana y los dos mensajes al colega tal como los propones").
Mockup aprobado: `docs/superpowers/mockups/2026-10-20-publicaciones-respuestas.html`.

## 1. Por qué

Juan: "necesito crear un módulo donde alojemos lo que vamos enviando a los grupos
y cuántas respuestas nos dan de dichas ofertas que hacemos", y "esto lo
deberíamos de hacer al menos con un mensaje de recordatorio" — al colega y a
Daiana.

Lo medido el 2026-10-20: en 30 días 48 colegas respondieron 146 veces a los DM
del radar en la línea de Daiana, y el sistema no registró ni una visita. El caso
de Andrés Tobón (1-oct): confirmó visita y reclamó que no le mandaron la ficha.
Las respuestas existen; no se miden ni se atienden.

## 2. Qué es una respuesta

Una **respuesta** es un colega que reacciona a una publicación nuestra (fila de
`grupo_publicaciones` con estado `enviado`). Se guarda **una fila por colega y
por ref** (`respuestas_publicacion`), que acumula sus mensajes. Tres vías:

| Vía | Cómo se detecta | Dónde |
|---|---|---|
| 💬 `sofi` | El colega le escribe a Sofi con "vi en un grupo la Ref N" (`kit-origen.refDeKit`) y la ref fue publicada en los últimos 7 días. Hoy `engine.js` solo atribuye esto a clientes (`if (!colega)`): se registra también para colegas. | `src/agent/engine.js` |
| 📱 `linea` | Mensaje entrante a la línea del radar (`linea_dm`) que **nombra una ref** publicada en los últimos 7 días; o, sin ref, de un colega de `colegas_grupos` que está (por **nombre** de grupo, `colegas_grupos.grupos` contra `whatsapp_groups.nombre`) en un grupo donde se publicó algo en las 48 h previas y cuyo mensaje no está ligado a un pedido del radar (`senal_id` null). Si hay varios posts candidatos, el más reciente. | `src/groups/dm.js` |
| ↩️ `grupo` | Mensaje de grupo que **cita** nuestro post: el id citado coincide con `grupo_publicaciones.wamid`. Solo en grupos que el radar escucha (`modo != 'ignorar'`; 8 de los 10 donde publicamos). | `src/channels/whatsapp-group.js` |

Un mensaje que ya cuenta para una fila (mismo colega, misma ref) actualiza
`ultimo_entrante_at` y `mensajes`; no crea otra.

## 3. Cuándo está "atendida"

- **Vía Sofi:** atendida al crearse (Sofi contesta siempre).
- **Línea / grupo:** cuando la línea **le escribe** a ese colega. Hoy el sistema
  no lo ve: WAHA está suscrito solo a `message` y el webhook descarta `fromMe`.
  Cambio: la sesión se suscribe también a `message.any`; los mensajes `fromMe`
  hacia un **DM** (no grupo) se guardan en `linea_dm` con `direccion = 'salida'`
  y marcan atendidas las respuestas abiertas de ese colega
  (`atendida_por = 'linea'`). Los `fromMe` de grupos se siguen descartando.
  Los mensajes que manda el propio sistema por WAHA (DM del radar, puente,
  recordatorios) también llegan como `fromMe`: se reconocen por el `wamid` que
  devolvió el envío y **no** cuentan como atención humana.
- **Manual:** botón "Marcar atendida" en el módulo (`atendida_por = 'manual'`).

## 4. Recordatorios

Un scheduler (`src/scheduler/respuestas-publicacion.js`) cada 15 min, de
**lunes a sábado, 8 a. m. a 7 p. m.** (Bogotá), sobre respuestas abiertas de
vía `linea` o `grupo`:

1. **Daiana, a las 2 h sin atender:** notificación en la campana del CRM (+ push)
   a la dueña de la línea (`visita-linea.asesoraDeLinea`), tipo
   `respuesta_sin_atender`, link al módulo. Una vez (`recordatorio_at`).
2. **Colega, a las 3 h sin atender:** DM desde la línea con el link a Sofi:
   *"Hola {nombre}, gracias por escribir por la Ref {ref} 🙌 Para responderte ya
   y agendar la visita, te atiende Sofi aquí: {link}"*. El link lleva
   "Hola Sofi, vi en un grupo la Ref {ref}" para que Sofi lo atribuya. Una vez
   (`puente_at`). No sale si `puente-sofi` ya le mandó el link a ese colega en
   las últimas 24 h.
3. **Colega, seguimiento a las 24 h** de su último mensaje, si la conversación
   ocurrió (atendida o con puente) y él no volvió a escribir: *"Hola {nombre},
   ¿tu cliente alcanzó a ver la Ref {ref}? Si quiere visitarla, la agendamos con
   Sofi: {link}"*. Una vez (`seguimiento_at`).

Además, el **resumen de las 12 m. y 5 p. m.** (`resumen-pedidos.js`) suma la
sección "Respuestas sin atender" (abiertas > 2 h) aunque no haya pedidos.

**Frenos:** máximo 2 mensajes al colega por fila; nunca si ya fue atendida;
`colegas.esSoloLlamada` (el candado de `waha.enviarDm`); tope diario de 20 DM
de este carril; cuota de la línea < 80 % (`waha.cuotaDeLinea`, igual que
`seguimiento-colega`); `RADAR_RESPUESTAS_POST=true` lo enciende (apagado por
defecto). El recordatorio a Daiana va por la campana del CRM, no por WhatsApp
(regla de Juan del 2026-10-20).

## 5. Datos

Migración `db/migrations/2026-10-20_respuestas_publicacion.sql` (solo agrega):

- `respuestas_publicacion`: `id`, `org_id`, `property_ref`, `publicacion_id`
  (fk `grupo_publicaciones`, set null), `group_id` (fk `whatsapp_groups`, set
  null), `via` (`sofi|linea|grupo`), `colega_lid`, `colega_telefono`,
  `colega_nombre`, `primer_texto`, `primer_at`, `ultimo_entrante_at`,
  `mensajes` int, `atendida_at`, `atendida_por` (`sofi|linea|manual`),
  `recordatorio_at`, `puente_at`, `seguimiento_at`, `lead_id` (fk leads, set
  null), `created_at`. Única por (`org_id`, `property_ref`, colega) con
  colega = `coalesce(colega_lid, colega_telefono)`.
- `linea_dm.direccion text not null default 'entrada'` (`entrada|salida`).
- RLS: "team read" para `authenticated` en `respuestas_publicacion` y
  `grupo_publicaciones` (hoy sin política: el CRM no las podría leer).

## 6. CRM: pestaña "Publicaciones"

`crm/app/(dashboard)/publicaciones/page.tsx`, como el mockup:

- Franja navy: posts, respuestas, colegas distintos, visitas (leads con
  `cita.origen='linea_dm'` o citas de colegas ligadas a una ref publicada) y %
  de posts con respuesta; desglose por vía; alerta de "sin atender > 2 h".
  Selector Hoy / 7 días / 30 días.
- Lista de lo enviado agrupada por ref (grupos, horas, automático o a mano —
  `grupo_publicaciones` no lo distingue hoy: los 7 del 19-oct y los del dúplex
  son a mano; se agrega `grupo_publicaciones.origen` `auto|manual` con default
  `auto` y el script manual escribe `manual`), sus respuestas por vía y cada
  respuesta con estado: atendida / recordatorio a Daiana / link a Sofi enviado /
  seguimiento enviado / visita propuesta / sin atender. Botón "Marcar atendida".
- Lateral: fichas y grupos que más responden; leyenda de las vías.
- Nav: entrada "Publicaciones" junto a Grupos/Amoblados/Kit.
- "Marcar atendida" por API del CRM → bot (`callBot`), como `/api/citas/accion`.

## 7. Errores y límites

- La cita en grupo depende de que WAHA mande el id citado en el payload
  (`replyTo`): se verifica con un evento real antes de dar la vía por buena; si
  no viene, la vía `grupo` queda en 0 y el resto funciona.
- `message.any` aumenta el volumen del webhook (todo lo que escribe la línea):
  se filtra al principio y solo se guarda lo que va a un DM.
- La atribución sin ref por pertenencia a grupo puede equivocarse si el colega
  escribe por otra cosa; por eso solo aplica a mensajes sin pedido ligado y a 48 h.
- Todo falla abierto: si el registro de respuestas revienta, el mensaje del
  colega sigue su camino normal (radar, puente, detector de visitas).

## 8. Pruebas

Unitarias: atribución por las tres vías (ref explícita, pertenencia a grupo,
cita), dedup por colega+ref, atendida por salida humana vs. envío del sistema,
recordatorios (2 h / 3 h / 24 h, horario, topes, solo llamada, interruptor),
sección del resumen. Verificación real: un evento citado en un grupo y un
mensaje de Daiana desde su celular, leídos en el log antes de encender.
