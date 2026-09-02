# Avisos agrupados al asesor — Plan de implementación

**Fecha:** 2026-09-02
**Pedido por:** Juan, mirando su propio chat: *"no quiero que seas tan insistente"*, *"si un solo cliente envía 10 solicitudes que se agrupen y se envíen agrupadas al asesor"*, *"ya si la respuesta es automática al colega se debe dejar responder uno por uno"*.

## 1. El problema, medido

El 2 de septiembre, entre las 05:59 y las 08:33 (menos de 3 horas):

| | Natalia | Catherine |
|---|---|---|
| Mensajes de Sofi | 23 | 14 |
| De esos, ofertas de un solo mandato | 18 | 11 |
| Respuestas | 0 | 0 |
| Rechazados por WhatsApp | 4 | 0 |

Los 4 rechazos son `(#131056) pair rate limit hit`: el límite de frecuencia
entre nuestro número de negocio y el suyo. Tres de esas ofertas salieron en el
mismo minuto (08:29) y dos más a las 08:33. **El volumen ya nos está costando
entregas.**

El 1 de septiembre, Catherine recibió 45 mensajes: 27 matches de mandato y 15
recordatorios. Su ventana de 24 h lleva cerrada desde el 25 de agosto, así que
lo más probable es que no haya recibido ninguno.

## 2. La regla nueva

> **Al asesor se le habla como a una persona: un mensaje a la vez.
> Al colega se le sigue respondiendo uno por uno, porque cada pedido es suyo.**

Concretamente:

- **Hacia el ASESOR** (avisos de oportunidad, ofertas de mandato, escalados):
  se agrupan. Como máximo un mensaje cada `AVISOS_VENTANA_MIN` minutos por
  asesora; todo lo que se acumule en esa ventana sale junto, agrupado por
  colega y por mandato.
- **Hacia el COLEGA** (el DM automático de `vivo.js#asistir`): **no cambia
  nada**. Uno por uno, inmediato, con las mismas reglas de validación
  (`politica.js#decidirDm`, compuerta de calidad, veredicto de Sofi).

## 3. Por qué no hace falta una tabla nueva

El estado "pendiente de avisar" **ya existe** en la base:

- Pedidos de colegas: `group_signals` con `revalidacion` aprobada y
  `enviado_at is null`.
- Ofertas de mandato: `mandato_match_alerts` con `entregado = false`.

Hoy los dos caminos envían en línea y marcan entregado en el mismo paso. El
cambio es separar esos dos pasos: **registrar ahora, enviar después**. Nada que
migrar, y si el bot se reinicia la cola sobrevive porque vive en la base.

## 4. Comportamiento

El scheduler corre cada minuto. Para cada asesora con algo pendiente:

1. **¿Cuándo se le mandó el último mensaje?** Si fue hace menos de la ventana
   (10 min por defecto), espera. Si no, sale.
2. **Un solo pendiente** → el mensaje completo de siempre, sin cambios. Con
   tráfico bajo, el aviso sale en menos de un minuto y se ve igual que hoy.
3. **Dos o más** → un digest:
   - agrupado por colega cuando son pedidos del mismo,
   - agrupado por mandato cuando son ofertas para el mismo cliente,
   - separando lo que cumple todo de lo que apenas se acerca,
   - con una línea por item y la instrucción de responder con el número para
     recibir la ficha completa y el contacto.

La urgencia se conserva donde importa: si no hay ráfaga, no hay demora.

## 5. Archivos

| Archivo | Acción |
|---|---|
| `src/groups/digest-avisos.js` | crear — arma el texto agrupado |
| `src/scheduler/avisos-salida.js` | crear — vacía la cola respetando la ventana |
| `src/data/group-signals.js` | agregar `pendientesDeAvisoAprobadas` |
| `src/data/mandatos.js` | agregar `alertasPendientes` |
| `src/data/conversations.js` o `messages` | agregar `ultimoEnvioA(telefono)` |
| `src/groups/vivo.js` | `asistir` deja de enviar el aviso; solo registra |
| `src/groups/avisar-mandato.js` | deja de enviar; solo registra la alerta |
| `src/scheduler/radar-recordatorio.js` | máximo uno por asesora por día |
| `src/server.js` | arranca el scheduler nuevo |

## 6. Riesgo y mitigación

El riesgo real: si el scheduler no corre, **nada se entrega**. Hoy el envío es
en línea, así que un fallo se ve enseguida.

Mitigaciones:
- El watchdog ya vigila el radar: se le suma una alarma si hay pendientes con
  más de 30 minutos.
- El scheduler registra en el log cada corrida con cuántos mandó.
- Si el envío falla, el pendiente **no se marca**: se reintenta en la corrida
  siguiente, con la misma lógica de plantilla y escalado que ya existe.

## 7. Fuera de alcance

- Leer los acuses de entrega de WhatsApp (queda pendiente, es lo que convertiría
  "aceptado" en "entregado").
- Reenviar la cola acumulada a Catherine: se hace aparte, cuando ella reabra su
  ventana.
