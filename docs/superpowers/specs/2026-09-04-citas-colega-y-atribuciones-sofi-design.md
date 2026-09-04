# Citas con colegas: ciclo de vida y atribuciones de Sofi

**Decisión de Juan, 2026-09-04.** Diseño aprobado en conversación; este
documento es la fuente de verdad de lo acordado. Implementación en un plan
aparte.

## 1. El caso que lo motivó

Hoy a las 13:11 un colega (Miguel Longas, Habitar/Propiedad Raíz) le pidió a
Sofi una visita **para las 16:00 del mismo día** — su clienta Luisa Fernanda,
ref 9702941, Loma del Esmeraldal. Sofi la agendó sola. Lo que pasó después:

- El aviso que salió no llevaba la propiedad: `ctx.propertyInteres` está
  bloqueado a propósito para colegas (`engine.js`, la condición `!colega`), así
  que decía *"Tenés una visita con Fulano el jueves a las 4"* y nada más.
- **A Catherine no le llegó ningún aviso de esa cita** (verificado contra la
  conversación real).
- La propiedad ya no estaba disponible. Se supo cuando faltaba una hora.
- La visita se canceló, y **el registro sigue diciendo `solicitada`**: el
  calendario del equipo la muestra como si fuera a ocurrir.

Menos de tres horas para avisar, confirmar y descubrir el problema. Juan:
*"sofi no puede agendar para el mismo dia como lo que nos paso hoy"*.

## 2. Lo que hoy existe, verificado en el código

- **`leads.cita.estado` se escribe UNA vez** como `"solicitada"`
  (`src/agent/tools.js:601`) y nada lo vuelve a tocar. No hay concepto de
  cancelación en ningún lado.
- **El calendario del equipo no lo lee**: el tipo `Cita` de
  `crm/lib/calendar-events.ts` ni siquiera tiene el campo `estado`. Una cita
  cancelada se sigue mostrando.
- **Sofi SÍ conversa con colegas** cuando ellos escriben (`promptColega` en
  `src/agent/prompts.js`). Lo que no puede es INICIAR.
- **`enviarWhatsappEquipo` resuelve con `advisors.searchByName`**
  (`sofi-comando-tools.js:781`): solo encuentra gente de la tabla `advisors`.
  Un colega no existe para esa herramienta. Su descripción lo dice: *"NO es
  para clientes finales — solo para gente del equipo."*
- `agendar_cita` ya valida contra la agenda del asesor
  (`appointments.checkAvailability`) y sabe buscar el primer espacio libre
  (`proximo_disponible`).
- `validarMensaje.motivoDeBloqueo` ya ataja mensajes con links inventados
  (caso real 2026-08-18: Sofi mandó `wa.me/message/YOUR_CONTACT_LINK`).
- `mensaje-asesor.js#enviarYRegistrar` ya avisa cuando la ventana de 24 h
  está cerrada.

## 3. Ciclo de vida de la cita

Cuatro estados, y quién puede moverlos:

| Estado | Significa | Quién lo pone |
|---|---|---|
| `propuesta` | El colega pidió; nadie confirmó | Sofi |
| `confirmada` | Un asesor dijo que sí | Natalia o Juan, desde el CRM |
| `cancelada` | No va | El equipo, o Sofi tras confirmación humana |
| `reprogramada` | Se movió; apunta a la nueva | El equipo |

**El calendario del equipo tiene que respetarlos**, y esto es concreto, no una
intención: `CalendarEvent` gana un campo `estado`; una `propuesta` se rotula
como tal en el evento (el texto dice "propuesta — sin confirmar") y se
distingue visualmente de una `confirmada`; una `cancelada` **no entra en la
lista de eventos**. Sin esto la cancelación es cosmética: hoy el tipo `Cita`
de `crm/lib/calendar-events.ts` ni siquiera tiene el campo.

Las citas que ya existen en la base **no tienen estado**. Se leen como
`confirmada` —es lo que el equipo asumió todo este tiempo— salvo la de hoy,
que queda `cancelada`. Migración de una línea, sin backfill inventado.

**Regla que ordena todo lo demás: Sofi nunca pasa una cita a `confirmada`.**
Registra, avisa y espera. Decisión de Juan: *"vamos con la C pero que natalia
y yo desde el crm tambien lo podamos hacer"*.

## 4. Antelación mínima

`CITAS_ANTELACION_MIN_HORAS`, **default 18**, configurable por variable sin
desplegar.

- **Por encima del umbral**: Sofi agenda como `propuesta`, valida contra la
  agenda del asesor y le manda el aviso para que reconfirme con el colega.
- **Por debajo** (el caso de hoy): **no agenda**. Califica al colega, escala
  urgente al asesor, y le responde al colega que se lo está pasando ahora
  para que le confirmen.

**Por qué horas y no "día siguiente"**, que fue el pedido literal de Juan: un
pedido a las 23:00 para mañana a las 08:00 son 9 horas, y uno a las 09:00 para
hoy a las 17:00 son 8. El calendario diría que el primero es válido y el
segundo no, con el mismo margen real. Lo que protege es cuánto tiempo tiene
una persona para confirmar, no la fecha. Juan aprobó el cambio de forma.

**Ningún pedido se descarta por llegar tarde.** Un colega que dice "lo llevo
hoy a las 4" tiene al cliente en el carro: es el pedido más caliente que hay.
Lo que cambia es que la decisión de correr la toma una persona, no Sofi.

## 5. Qué pregunta Sofi antes de escalar

Para que el asesor decida en un vistazo y no con una conversación:

- ¿Qué propiedad exactamente (ref)?
- ¿A qué hora, y el cliente ya está con vos?
- ¿Ya vio la ficha y el precio?
- ¿Es primera visita?
- ¿Cómo la compraría — recursos propios, crédito aprobado?

Es la misma calificación que Sofi ya hace con un cliente propio
(`src/agent/qualification.js`), apuntada al cliente del colega. El asesor
recibe **un mensaje con las respuestas**, no un "quieren ver algo hoy".

Si el colega no contesta alguna, se escala igual diciendo cuál falta. Nunca se
retiene un pedido caliente por una pregunta sin responder.

## 6. Cancelar y reprogramar

- **El colega lo pide** → Sofi lo registra, avisa al asesor, y le responde
  *"le aviso al asesor y te confirmo"*. **La cita no se mueve** hasta que una
  persona confirme.
- **El equipo lo decide** → desde el CRM, directo, sin intermediarios.
- **Reprogramando**, Sofi **lee** la agenda del asesor y le dice al colega si
  esa hora está libre, sin mover nada. Leer no es decidir, y evita el ida y
  vuelta de proponer una hora y enterarse medio día después de que no servía.
- Sofi **no propone horarios alternativos** por ahora. Eso sería negociar por
  el asesor, y hasta no medir cómo funciona lo anterior no sabemos si hace
  falta.

## 7. Cómo se le avisa al colega

**Cancelar siempre cambia el registro, aunque el aviso falle.** Una agenda que
miente es el problema que este diseño viene a arreglar; no se puede dejar sin
cancelar porque no pudimos escribir.

Orden de intento:

1. **Línea oficial de Sofi** (Cloud API) — donde el colega ya está hablando.
   Sujeta a la ventana de 24 h de Meta.
2. **Si la ventana está cerrada → línea de Natalia** (WAHA). No tiene ventana,
   y es un número que el colega conoce de los grupos, no uno anónimo. Gasta de
   los ~300 mensajes/mes que WhatsApp le impone a esa línea.
3. **Si las dos fallan → alerta al equipo**: "cancelada, pero no le pudimos
   avisar; escribile vos".

## 8. Atribuciones de Sofi con colegas

| Puede | Guarda |
|---|---|
| Responder a un colega que escribió | Ya existe (`promptColega`) |
| Registrar una propuesta de cita, cancelación o cambio | Nunca la ejecuta sola |
| Leer la agenda y decir si una hora está libre | Solo lectura |
| Avisar que una ref que le mandamos se cayó | El dato lo pone el sistema |
| Escalar urgente con la calificación hecha | — |
| Texto libre a un colega, pedido desde el Centro de Comando | `validarMensaje.motivoDeBloqueo` + queda en la conversación + tope de la línea |

**Lo que no puede, nunca:**

- Confirmar una cita sin que una persona lo diga.
- Iniciar conversación con un colega que no escribió.
- Usar `directorio_lids` como lista para prospectar — es caché de ruteo. El
  límite de la Ley 1581 de 2012 trazado en `2026-08-22_colegas_grupos.sql` no
  se mueve.

## 9. Lo que no cambia

Mensaje blanqueado (al colega le va `linkWasi`, nunca la landing, y el texto no
nombra a Diamond) · nunca se publica dentro del grupo · nunca sale inventario
de aliados al colega · sync de Wasi fresco o no se ofrece nada · solo se le
escribe al colega que publicó un pedido o que escribió primero.

## 10. Cómo se implementa: dos tandas, en este orden

Es demasiado para un solo plan. Se parte en dos, y **la primera sirve sola**:

**Tanda 1 — el registro deja de mentir.** Los cuatro estados, la migración, el
calendario respetándolos, cancelar y reprogramar desde el CRM, y la
notificación al colega con su cascada (oficial → Natalia → alerta). Al terminar
esta tanda la cita de hoy queda cancelada de verdad y el calendario dice la
verdad. No depende de nada de la tanda 2.

**Tanda 2 — Sofi entra al circuito.** La antelación mínima, la calificación del
pedido caliente, el escalado urgente, la lectura de agenda para reprogramar, y
la capacidad de escribirle a un colega desde el Centro de Comando (hoy
imposible: `enviarWhatsappEquipo` solo resuelve contra `advisors`, así que hace
falta una herramienta nueva, no un ajuste de la existente).

Cada tanda lleva su propio plan de implementación.

## 11. Criterios de aceptación

1. Un colega pide una visita para dentro de 3 horas → **no se agenda**; se
   escala urgente al asesor con la calificación, y el colega recibe que se lo
   pasaron para confirmar.
2. Un colega pide una visita para dentro de 3 días → queda `propuesta`, y el
   asesor recibe el aviso para reconfirmar.
3. Una cita `propuesta` se ve distinta de una `confirmada` en el calendario.
4. Una cita `cancelada` **no aparece** en el calendario.
5. Sofi nunca escribe `confirmada`: hay un test que lo verifica.
6. Cancelación con la ventana de 24 h cerrada → el registro queda cancelado,
   el aviso sale por la línea de Natalia, y si esa también falla el equipo
   recibe la alerta.
7. Un colega pide mover a una hora ocupada → Sofi se lo dice **sin** mover la
   cita.
8. Sofi no puede iniciar conversación con un colega que nunca escribió.
9. Ningún mensaje al colega nombra a Diamond ni lleva el link de la landing.
