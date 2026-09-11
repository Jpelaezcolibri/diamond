# Confirmación de visitas: la asesora responde "OK CONFIRMADA"

**Decisión de Juan, 2026-09-10.** Diseño aprobado en conversación
("el resto me parece súper bien el plan"). **Estado: pendiente de plan e
implementación** (rama nueva, después de desplegar `colega-solo-llamada`).

## 1. El problema, verificado en producción (2026-09-10)

- `agendar_cita` (`src/agent/tools.js`) guarda la cita con
  `estado: "solicitada"`, pero `src/data/citas.js` solo reconoce
  `propuesta | confirmada | cancelada | reprogramada` y lee cualquier otro
  valor como **`confirmada`**. Resultado: las 4 citas que existen figuran como
  confirmadas en el calendario y nadie confirmó ninguna.
- El aviso de cita a la asesora (`notifications/advisor.js`
  `buildColegaAppointmentAlert` / `buildAppointmentAlert`) no pide
  confirmación, y no existe herramienta para confirmar.
- Sofi le dice al colega que la cita quedó hecha ("repetile el día y la hora
  EXACTOS").
- El calendario del CRM (`crm/app/(dashboard)/calendario/page.tsx`) YA
  muestra "propuesta — sin confirmar": no hace falta tocar la UI.

## 2. El diseño

1. **La cita nace `propuesta`** (en vez de "solicitada").
2. **El aviso de cita a la asesora termina** con: "Respondé *OK CONFIRMADA*
   para confirmarla, o decime otra hora." (colega y cliente).
3. **Herramienta `confirmar_cita`** (solo con `ctx.advisor`, en el chat de la
   asesora con Sofi): busca las citas `propuesta` próximas de esa asesora
   (`cita.advisor_id` = su `auth_user_id`). Una → la pasa a `confirmada` con
   `confirmada_at` y `confirmada_por`; varias → le pregunta cuál; ninguna →
   lo dice. Queda en el calendario como confirmada.
4. **Al confirmar, Sofi le avisa al colega o cliente** por la línea oficial:
   "Tu visita del {día hora} a la ref {ref} quedó confirmada. Te recibe
   {asesora}, {celular}." Si la ventana de 24 h de esa persona está cerrada,
   o es un colega "solo llamada", no le escribe y le pide a la asesora que lo
   contacte ella.
5. **Al agendar**, Sofi le dice al colega: "Quedó solicitada tu visita para
   {día hora}. En breve {asesora} te contacta para confirmarla. Si querés
   confirmarla directo: {celular}." (nombre y celular = quien coordina las
   visitas, `advisors.findAsesorPrincipalRadar`, hoy Daiana Zea). Al cliente
   final, lo mismo sin el teléfono. El resultado de `agendar_cita` y el prompt
   dejan de decir "confirmá".
6. **Recordatorio:** si la asesora no confirma en 2 horas, un solo
   recordatorio.
7. **Datos existentes:** la cita del colega ***3936 (jueves 11-sep 2:00 p. m.,
   ref 9944723), hoy "solicitada", pasa a `propuesta` al desplegar.

## 3. Reglas

Multi-tenant (nombres y teléfonos desde `advisors`); copy neutro en género;
el aviso al colega no sale por la línea del radar (usa la oficial), y respeta
"solo llamada".

## 4. Addendum 2026-09-11 — a quién va la cita

Juan: *"esto solo se confirma por WhatsApp con el asesor, sofi solo hace una
previa pero la cita tiene que ir al asesor para validar disponibilidad,
siempre las citas van al número de Daiana que tiene la ventana abierta"*.

Caso que lo disparó: la visita de Sebastián Velásquez (11-sep, 3:00 p. m.)
cayó en la rotación de transferencias. El aviso le llegó a Catherine, que
tenía la ventana cerrada hacía 142 h, y se perdió sin que nada lo dijera.
Además, Sofi le dijo al cliente "queda confirmada".

1. **Toda cita, de cliente o de colega, va a quien coordina las visitas**
   (`advisors.findAsesorPrincipalRadar`). Nunca va a la rotación.
2. **El aviso sale con `entregarConRespaldo`.** Primero va al principal. Si
   la ventana está cerrada, va a `RADAR_ESCALADO_PHONE`, que es la segunda
   línea de quien coordina. Esto reemplaza las copias del 2026-09-04.
3. **`proximo_disponible` se quita.** Sofi pregunta el día y la hora y nunca
   escoge un espacio de la agenda.
4. **Una franja no se convierte en hora.** Si el cliente dice "en la tarde",
   Sofi le pregunta la hora exacta.
5. **Configuración en producción, aplicada el 2026-09-11** con el sí de Juan:
   - Daiana tiene `recibe_transferencias = true` y Catherine `false`.
   - Hay una fila nueva, "Daiana Zea (línea 2)", con el 573001878024.
   - `RADAR_ESCALADO_PHONE` es 573001878024.
