# SOFI — Experiencias de Usuario (para demo, desarrollo y pruebas con cliente)

**Estado:** BORRADOR — Mapa de experiencias
**Rol:** Product Lead
**Propósito:** el desarrollo, las demostraciones comerciales y las pruebas con
clientes dejan de girar alrededor de funcionalidades sueltas y giran alrededor
de **experiencias completas**. Cada una empieza con un problema cotidiano y
termina mostrando a SOFI eliminándolo, en **menos de 5 minutos**, usando solo
capacidades ya aprobadas. No se agrega nada ni se cambian prioridades: es la
misma lista EXP-001…EXP-013, reagrupada para poder *demostrar transformación*,
no funciones.

Cast fijo para todas las demos (continuidad entre reuniones): **Carlos** y
**María** (asesores), **Juan** (dueño/administrador), **Marcela Ruiz**
(cliente), **Pedro** (colega de "Su Casa Inmobiliaria"), propiedades en
Laureles/Envigado/El Poblado (ref de ejemplo 9205982).

---

## Mapa: 5 experiencias, 13 historias

| Experiencia | Historias que la componen | Prioridad heredada* | A quién se le demuestra |
|---|---|---|---|
| 1. **El Día Resuelto** | EXP-001, EXP-006, EXP-013 | P0–P1–P3 | Asesor |
| 2. **Cero Leads Perdidos** | EXP-002, EXP-003 | P0–P0 | Asesor / Dueño |
| 3. **Siempre un Paso Adelante** | EXP-004, EXP-005 | P1–P1 | Asesor |
| 4. **El Equipo con un Solo Cerebro** | EXP-009, EXP-010, EXP-011, EXP-012 | P2–P2–P2–P3 | Dueño (equipo 3–5) |
| 5. **El Dueño que Ve Antes** | EXP-007, EXP-008 | P1–P2 | Administrador / Dueño |

\* Las prioridades no cambian: son las que ya traían las historias en el backlog.
La experiencia se demuestra completa aunque se construya por partes.

Orden sugerido para una reunión comercial: **1 → 2 → 5** (el arco asesor +
dueño) es la demo de 12–15 min que vende el producto. 3 y 4 se muestran cuando
el prospecto tiene equipo o pregunta "¿y si tengo varios asesores?".

---

## Experiencia 1 · El Día Resuelto
**Historias:** EXP-001 (briefing) + EXP-006 (cierre + siembra) + EXP-013
(siguiente mejor acción) · **Duración de demo:** 3–4 min

**Transformación en una frase:** *el asesor deja de organizar su día; llega y el
día ya está organizado.*

**Problema que resuelve:** cada mañana el asesor pierde 10–15 minutos abriendo
pantallas para decidir por dónde empezar, trabaja por orden de bandeja (no por
valor), y termina el día sin saber si avanzó — los pendientes se pierden en la
noche.

**Flujo completo:**
1. Carlos abre SOFI a las 8:00. Antes de escribir nada, SOFI le da el parte:
   pendientes de seguimiento, la cita de hoy, el lead caliente que lleva 4 días
   frío — ordenado por urgencia, con "¿arrancamos por ese?".
2. Durante el día, al cerrar cada interacción, SOFI sugiere el siguiente paso
   lógico ("¿le agendamos visita?", "¿le comparto la ficha?").
3. A las 6:00 Carlos cierra: SOFI resume lo logrado (seguimientos, cita, venta)
   y **deja armada la cola de mañana**. El parte del día siguiente nace de aquí.

**Historia de demostración (guion):**
> "Miren cómo empieza el día de un asesor con SOFI. Carlos llega, abre la app
> —*(se muestra el briefing)*— y sin preguntar nada ya sabe que tiene una visita
> a las 11 y un cliente caliente sin tocar hace 4 días. No abrió tres pantallas:
> el día ya venía priorizado. Al final de la tarde —*(se muestra el cierre)*—
> SOFI le dice qué logró y le deja listos los pendientes de mañana. Cierra el
> círculo: mañana el briefing arranca justo donde terminó hoy."

**Criterios de aceptación:**
- Al abrir la primera sesión del día, SOFI emite el parte sin que el usuario
  escriba, en orden de urgencia (pendientes/cita/caliente frío).
- El parte se compone solo de datos reales del asesor (respeta su alcance).
- Al cerrar la jornada, SOFI entrega resumen + cola de mañana, y esa cola aparece
  en el briefing del día siguiente.
- Cero navegación por menús para obtener cualquiera de los tres momentos.

**Valor comercial:** es la experiencia de **adopción diaria** — la razón por la
que el asesor abre SOFI todos los días. Sin esto, el producto es opcional; con
esto, es el primer clic de la mañana.

---

## Experiencia 2 · Cero Leads Perdidos
**Historias:** EXP-002 (respuesta anticipada al lead nuevo) + EXP-003 (rescate
del caliente enfriándose) · **Duración de demo:** 3–4 min

**Transformación en una frase:** *ningún lead espera y ningún caliente se
enfría — SOFI ya tiene la respuesta lista antes de que el asesor la escriba.*

**Problema que resuelve:** los leads llegan y se responden tarde (o nunca), y los
que ya se calificaron se enfrían por olvido. En captación digital, la lentitud de
respuesta es el factor nº1 de pérdida de conversión.

**Flujo completo:**
1. Entra un lead nuevo con zona, tipo y presupuesto. Antes de que el asesor
   reaccione, SOFI ya dejó preparadas las 2–3 propiedades que calzan **y** un
   borrador de primer mensaje. Carlos solo revisa y dice "envíalo".
2. Días después, un lead calificado lleva 4 días sin respuesta. SOFI lo levanta
   sola: "este está caliente y se está enfriando, ¿le escribimos?" — con el
   borrador de retoma ya hecho.

**Historia de demostración (guion):**
> "Entra un lead por la pauta de Instagram. Miren —*(en vivo)*— SOFI no espera a
> que el asesor busque nada: ya le puso al frente las tres propiedades que le
> sirven a ese cliente y un mensaje listo para enviar. Del minuto uno. Y esto
> —*(rescate)*— es lo que evita que se pierda plata: SOFI se acuerda del cliente
> caliente que el asesor olvidó y lo trae de vuelta antes de que se enfríe. El
> asesor no persigue leads: SOFI se los pone en frente."

**Criterios de aceptación:**
- Cuando un lead alcanza el perfil mínimo (zona/tipo/presupuesto), SOFI prepara
  propuesta + borrador sin que se lo pidan, listos para envío con confirmación.
- El envío al cliente siempre requiere el "OK" humano (nunca autónomo).
- SOFI detecta leads score≥70 sin actividad ≥N días y abre la conversación de
  rescate con borrador incluido.
- Tiempo entre llegada del lead y primer mensaje enviado, medible y a la baja.

**Valor comercial:** es la experiencia que **toca la facturación directamente**.
Un prospecto entiende de inmediato: responder al minuto y no perder calientes =
más cierres con los mismos leads. Es el mejor gancho de venta del producto.

---

## Experiencia 3 · Siempre un Paso Adelante
**Historias:** EXP-004 (cita con todo listo) + EXP-005 (aviso de cambio en
propiedad de interés) · **Duración de demo:** 2–3 min

**Transformación en una frase:** *SOFI se adelanta a los eventos del negocio —
prepara la cita y avisa de la oportunidad antes de que el asesor se entere.*

**Problema que resuelve:** el asesor llega a las visitas sin la ficha ni la ruta
a mano y no se entera cuando una propiedad que le gustó a su cliente baja de
precio o se vende — pierde el timing de reactivar o queda mal ofreciendo algo que
ya no está.

**Flujo completo:**
1. Se acerca una cita. SOFI deja lista la ficha de la propiedad, la ubicación y
   un borrador para confirmar asistencia con el cliente.
2. El sync de inventario detecta que una propiedad que Marcela había mirado bajó
   de precio. SOFI avisa a Carlos: "bajó la que le gustó a Marcela, buen momento
   para retomar" — excusa legítima para volver a contactar.

**Historia de demostración (guion):**
> "Carlos tiene una visita en una hora. No tiene que preparar nada: SOFI ya le
> dejó la ficha, la dirección y un mensaje para confirmar con el cliente. Y miren
> esto —*(aviso de rebaja)*— una propiedad que Marcela había visto bajó de
> precio, y SOFI se lo dice a Carlos sin que él estuviera vigilando el
> inventario. Un motivo perfecto para volver a escribirle. SOFI no espera a que
> le pregunten: se adelanta."

**Criterios de aceptación:**
- Ante una cita próxima, SOFI reúne ficha + ubicación + borrador de confirmación
  sin que se lo pidan.
- Cuando el sync emite un cambio de precio/estado sobre una propiedad vinculada a
  un lead, SOFI avisa al asesor dueño de ese lead (respetando alcance).
- El aviso llega por el mismo canal que ya usan las alertas al asesor.

**Valor comercial:** demuestra que SOFI **trabaja mientras el asesor no mira** —
más citas cumplidas y reactivaciones que de otro modo no ocurrirían. Refuerza la
percepción de "copiloto", no de "buscador".

---

## Experiencia 4 · El Equipo con un Solo Cerebro
**Historias:** EXP-010 (propiedad de colega) + EXP-009 (inventario nuevo) +
EXP-011 (comprador↔propietario) + EXP-012 (objeciones) · **Duración de demo:**
3–4 min

**Transformación en una frase:** *lo que sabe un asesor mejora automáticamente el
trabajo de los demás — sin reuniones, sin reenvíos, sin chat interno.*

**Problema que resuelve:** en una agencia con varios asesores, el conocimiento
vive en cabezas separadas. Un asesor tiene el comprador y otro el vendedor y
nadie los cruza; una propiedad de colega que resolvería al cliente de un
compañero se queda en una libreta. Se pierden ventas que ya estaban dentro de
casa.

**Flujo completo:**
1. Carlos registra —dictándoselo a SOFI— una propiedad que le pasó Pedro, un
   colega. SOFI la cruza contra la cartera de todo el equipo y avisa a María:
   "esto calza con tu cliente de Envigado" — marcada *pendiente de validación*,
   con los datos del colega y la acción "contactar colega".
2. El sync agrega una propiedad nueva; SOFI detecta qué clientes del equipo la
   buscaban y avisa a cada dueño.
3. Entra un lead vendedor; SOFI encuentra que otro asesor ya tenía el comprador
   ideal y sugiere el match.
4. Cuando cualquiera va a escribirle a un cliente, SOFI le adjunta las objeciones
   típicas ya resueltas de esa propiedad.

**Historia de demostración (guion):**
> "Esto es para cuando tienen equipo. Carlos anda en la calle y un colega le pasa
> un apartamento —se lo dicta a SOFI en una frase. Miren lo que pasa del otro
> lado: María, que ni estaba en esa conversación, recibe un aviso de que ese
> apartamento le sirve a *su* cliente de Envigado. El dato de calle de uno se
> volvió venta posible de otro, solo. Sin reenviar nada, sin reunión. Eso es un
> equipo compartiendo cerebro."

**Criterios de aceptación:**
- Al registrar una propiedad de colega, SOFI la cruza con los leads activos del
  equipo y avisa al dueño del lead que calza, siempre *pendiente de validación* y
  sin tratarla como inventario propio.
- Al entrar inventario nuevo, SOFI avisa a los asesores con clientes que calzan.
- SOFI sugiere matches comprador↔vendedor existentes dentro de la cartera.
- Al preparar un mensaje, SOFI ofrece las objeciones resueltas de la propiedad.
- Nada de esto expone datos fuera del alcance de cada asesor salvo el aviso de
  coincidencia dirigido a su dueño.

**Valor comercial:** es la experiencia que **escala con el tamaño del equipo** —
el argumento para la agencia de 3–5 asesores: doble comisión, ventas de red y
cero fugas de conocimiento. Con 1 asesor aporta poco; con equipo, es diferencial.

---

## Experiencia 5 · El Dueño que Ve Antes
**Historias:** EXP-007 (panorama por excepción) + EXP-008 (cuello de botella) ·
**Duración de demo:** 2–3 min

**Transformación en una frase:** *el dueño deja de leer tableros buscando
problemas — SOFI le muestra solo lo que se salió de lo normal, a tiempo para
corregir.*

**Problema que resuelve:** el dueño (que casi siempre también vende) no tiene
tiempo de vigilar tableros. Los problemas del pipeline se ven cuando ya costaron
ventas: transferencias que nadie atendió, un asesor con calientes fríos, un mes
que se está cayendo.

**Flujo completo:**
1. Juan abre SOFI. No recibe un tablero: recibe las dos cosas que exigen su
   atención — "el embudo se frena en transferido, 6 leads con +5 días" y "María
   tiene 4 calientes sin tocar desde el lunes".
2. SOFI señala el atasco y a quién preguntarle; Juan decide (SOFI no reasigna por
   su cuenta) y, si quiere, aterriza directo en la vista ya filtrada.

**Historia de demostración (guion):**
> "El dueño no tiene tiempo de andar mirando gráficas. Miren lo que ve Juan al
> abrir SOFI: no un dashboard, sino dos frases —el embudo está frenado aquí, y
> este asesor tiene clientes calientes sin tocar. SOFI ya miró por él y le señala
> el problema *antes* de que se convierta en una venta perdida. El dueño pasa de
> vigilar a decidir."

**Criterios de aceptación:**
- Al abrir sesión el admin, SOFI muestra solo desviaciones (no totales),
  ordenadas por importancia.
- SOFI detecta estados del embudo con leads estancados +N días y lo señala.
- SOFI propone a quién preguntar y ofrece el enlace a la vista filtrada, pero no
  ejecuta acciones sobre leads por su cuenta.
- El panorama respeta el alcance completo del admin (todo el negocio).

**Valor comercial:** es la experiencia que **cierra la venta con el dueño** —
quien firma. Le demuestra control sin esfuerzo: menos tiempo en tableros, menos
ventas perdidas por descuido. Complementa la Experiencia 2 (el dueño ve el
motor de conversión funcionando y además lo supervisa solo).

---

## Cómo usar este mapa

- **Desarrollo:** construir por experiencia completa, no por historia suelta —
  una experiencia entregada es algo demostrable y testeable; una historia suelta
  no se puede mostrar en una reunión. Dentro de cada experiencia, respetar el
  orden de prioridad que las historias ya traen del backlog.
- **Demo comercial:** cada experiencia es un bloque de <5 min con arco
  problema→transformación. La demo estándar es 1 → 2 → 5 (~12 min); 3 y 4 entran
  según el prospecto.
- **Pruebas con cliente:** validar cada experiencia por sus criterios de
  aceptación y por la métrica única del producto — *acciones útiles que SOFI
  inició sin que se las pidieran* durante la prueba.
