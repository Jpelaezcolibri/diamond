# El colega que pide hablar con una persona le llega a la asesora en el momento

**Decisión de Juan, 2026-09-10.** Diseño aprobado en conversación (opción A).
Implementación: Task 13 de
[docs/superpowers/plans/2026-09-10-colega-solo-llamada.md](../plans/2026-09-10-colega-solo-llamada.md),
misma rama `colega-solo-llamada`, se despliega junto con el resto.

## 1. El caso

Verificado en producción el 2026-09-10:

- **Santiago (colega), 1:04 p. m.:** "¿Es posible hablar con alguien?". Sofi
  contestó "te puedo conectar con un asesor" — contra su propio prompt, que
  dice "NUNCA le ofrezcas conectarlo con un asesor" — y **no le avisó a
  nadie**: ningún mensaje a la asesora desde la 1:00 p. m. Daiana le escribió
  desde el CRM a la 1:08 p. m. ("Hablas con Daiana") porque vio el chat por su
  cuenta.
- **Miguel Longas, 4-sep:** pidió el número de quien iba a hacer la visita y
  Sofi le dijo que no tenía acceso a ese dato.

Pedido de Juan: *"cuando un colega exige hablar con un asesor, que
inmediatamente se envíe a Daiana para que se contacte con el colega, igual
que cuando se generan las citas."*

## 2. Lo que ya funciona y no se toca

- **Citas de colega:** `agendar_cita` → `tools.js#armarAvisoCitaColega` → aviso
  inmediato a la asesora principal del radar (`advisors.findAsesorPrincipalRadar`,
  hoy Daiana Zea por `RADAR_REVISOR_PHONE`) con copia a `RADAR_ESCALADO_PHONE`.
- **Citas de cliente:** siguen yendo al asesor que las atiende (Juan no pidió
  copia a Daiana).
- **Cliente que pide un asesor:** sigue con `transferir_a_asesor`.

## 3. El diseño

1. **Herramienta `pedir_contacto_asesora`** (input opcional `motivo`), en
   `src/agent/tools.js`. Solo con `ctx.colega`; con cualquier otro
   interlocutor devuelve un rechazo que nombra `transferir_a_asesor`.
2. **Aviso inmediato** a la asesora principal del radar, con copia a
   `RADAR_ESCALADO_PHONE` (si no es el mismo número) — el mismo patrón que
   `armarAvisoCitaColega`. Contenido:
   - `🙋 Un colega pide hablar con una asesora — comunicate ya`
   - nombre del colega; contacto (link `wa.me` a su celular; si está marcado
     "solo llamada", el número para marcar con "llamá, no le escribas");
   - para qué (el `motivo`, si lo hay);
   - su último pedido en los grupos (`groupSignals.buscarPorTelefono`) y las
     refs que le respondimos.
3. **Repetidos:** si el mismo colega (misma org + lead) lo pide otra vez en 30
   minutos, no sale un segundo aviso; Sofi recibe "ya le avisé" y le repite el
   contacto. La marca de repetido se guarda solo si el aviso principal salió.
4. **Lo que recibe Sofi:**
   - aviso entregado → "Listo: ya le avisé a {nombre} … pasale su nombre y
     celular" (datos del registro de la asesora, nunca escritos en el código);
   - aviso rechazado (p. ej. ventana de 24 h cerrada) → "NO le llegó el aviso
     … NO le digas que ya le avisaste: pasale directamente el contacto";
   - sin asesora configurada → "NO pude avisarle a nadie … NO le digas que ya
     le avisaste".
5. **Prompt de colega:** la regla pasa a ser "NUNCA le ofrezcas 'conectarlo
   con un asesor' por tu cuenta — pero si él pide hablar con una persona del
   equipo, usá `pedir_contacto_asesora` y pasale el nombre y celular que te
   devuelva; nunca digas que avisaste sin haberla usado".

## 4. Reglas que aplican

- Copy neutro en género: nada de "contactalo"/"llamalo" referido al colega.
- Multi-tenant: el nombre y el teléfono de la asesora salen de `advisors`, por
  org; el escalado, de la variable.
- La consulta de "solo llamada" usa `colegas.esSoloLlamada` (Task 3). En este
  aviso, solo `true` cambia el formato (es información para la asesora, no un
  envío al colega).

## 5. Pruebas

`test/colega-pide-asesora.test.js`: colega → aviso a la asesora + copia al
escalado con el contenido de §3.2; repetido en 30 min → sin segundo aviso;
colega "solo llamada" → número para marcar, sin `wa.me`; aviso rechazado →
texto que prohíbe decir "avisé"; no colega → rechazo sin envíos; sin asesora →
texto honesto. `test/colega-escribe-a-sofi.test.js`: el prompt nombra
`pedir_contacto_asesora` y conserva la prohibición de ofrecerlo por su cuenta.
