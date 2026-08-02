# SOFI EXPERIENCE V1

**Estado:** BORRADOR — Diseño de experiencia
**Autor:** Chief Product Officer (rol asumido para este documento)
**Fuentes exclusivas:** [SOFI — Centro de Comando Conversacional](sofi-centro-comando.md) (arquitectura aprobada), [Modelo de Gobernanza de Decisiones](modelo-gobernanza-decisiones.md), [DIAMOND-OS-BLUEPRINT-V1](DIAMOND-OS-BLUEPRINT-V1.md).

Este documento **no diseña capacidades, tablas, APIs ni motores nuevos**. La
arquitectura está congelada en [sofi-centro-comando.md](sofi-centro-comando.md):
las mismas 11 herramientas, las mismas 7 funciones de consulta, la misma memoria
de sesión, los mismos permisos. Lo único que cambia aquí es **la postura**:
cuándo habla SOFI, qué ofrece sin que se lo pidan y en qué orden. Describe cómo
se siente trabajar ocho horas al día con SOFI como interfaz principal.

---

## 0. La premisa

Hay un riesgo real, y el dueño del producto lo nombró bien: SOFI puede
convertirse en un buscador excelente. Preguntas algo, responde bien, cierras el
chat. Un buscador excelente **sigue siendo una herramienta que el usuario tiene
que recordar usar.** Y una herramienta que hay que recordar usar se abandona la
primera semana ocupada.

El objetivo no es que SOFI responda. Es que SOFI **acompañe**. La diferencia
entre una y otra no es más tecnología: es **iniciativa**. Un buen compañero de
trabajo no espera a que le preguntes cuántos leads llegaron; te lo dice al
llegar, porque sabe que lo vas a necesitar. No te hace navegar tres pantallas
para saber a quién llamar hoy; te lo pone al frente.

> **Tesis: la proactividad no es una función. Es una manera de secuenciar
> funciones que ya existen alrededor del ritmo de un día de trabajo.**

Cada movimiento de este documento se arma **reensamblando piezas ya aprobadas**.
No se construye maquinaria nueva; se cambia el momento en que la maquinaria
existente se dispara y el orden en que presenta lo que ya sabe calcular.

---

## 1. El principio de la proactividad honesta

Una SOFI proactiva mal calibrada es peor que una reactiva: interrumpe, inventa
urgencias, se vuelve ruido, y el asesor la silencia. Tres reglas la mantienen
del lado del compañero y no del lado del jefe insoportable:

1. **Solo ofrece lo que ya puede calcular.** Cada aviso proactivo sale de una
   de las 7 funciones de consulta existentes (§4 de la arquitectura). Si un
   dato no es computable con lo que hay, SOFI no lo inventa ni promete tenerlo.
2. **Respeta el alcance sin excepción.** La proactividad usa el mismo Resolutor
   de Alcance: un asesor solo recibe iniciativas sobre sus leads; el admin,
   sobre el negocio. Nada de esto abre un solo dato nuevo.
3. **Tiene presupuesto de interrupción.** SOFI habla sin que le pregunten en
   tres momentos: al abrir la jornada, cuando ocurre un evento que el usuario
   perdería si no se lo dicen, y al cerrar el día. Fuera de eso, responde. No
   persigue. La atención del asesor es el recurso escaso, no los tokens.

Nota de honestidad arquitectónica: "hablar sin que le pregunten" se dispara
**cuando el usuario abre su primera sesión del día** (el ciclo de
`command_sessions` ya existe: abrir sesión es el gatillo, cero infraestructura
nueva). Un mensaje *empujado* al WhatsApp del asesor antes de que él abra nada
requeriría un programador de tareas — eso sí sería maquinaria nueva y queda
**fuera de este documento**, anotado como opción futura al final (§9).

---

## 2. La jornada del asesor

### 2.1 Apertura — el parte del día *(responde la pregunta 1)*

El asesor abre SOFI a las 8:00. Antes de que escriba una sola letra, SOFI ya
habló:

> **Buenos días, Carlos.** Ayer cerró el día con 2 leads nuevos que aún no
> tocas. Hoy tienes **1 cita a las 11:00** (visita con Marcela Ruiz, apto de
> Laureles) y **3 clientes que necesitan seguimiento** — uno de ellos,
> caliente, lleva 4 días sin respuesta. ¿Arrancamos por ese?

Ese saludo no es un mensaje de bienvenida decorativo. Es la salida combinada de
funciones que ya existen, ordenadas por urgencia:

- `cmd_seguimientos` → los 3 clientes sin actividad y las citas próximas.
- `cmd_metricas_leads` → los leads nuevos sin dueño o recién asignados.
- El contexto de la cita vive en `leads.cita` (ya se lee hoy).

**Qué problema resuelve:** hoy, para saber por dónde empezar, el asesor tendría
que abrir el inbox, contar conversaciones, entrar al kanban, mirar quién está
frío y revisar su agenda por fuera. Cinco decisiones antes de la primera
llamada. **Cuánto tiempo ahorra:** ~10–15 min de "ordenar la cabeza" cada
mañana, todos los días. **Qué fricción elimina:** la peor de todas, la del
folio en blanco — no saber por dónde arrancar. **Por qué mejora la adopción:**
el primer contacto del día con SOFI ya le entregó valor sin pedir nada; SOFI se
gana el hábito en el momento de mayor incertidumbre de la jornada.

### 2.2 El plan del día *(responde la pregunta 3)*

El parte no es una lista pasiva: es un plan accionable. Cuando Carlos responde
"sí, arranquemos", SOFI ya tiene ordenada la jornada por prioridad comercial,
no por orden de llegada:

1. Lo que se pierde si no se atiende hoy (citas, leads calientes fríos).
2. Lo que madura (leads calificados que llevan días en "transferido").
3. Lo nuevo (leads sin tocar), al final, porque todavía están tibios.

Ese orden **ya existe como dato**: la temperatura por score (≥70 caliente, ≥40
tibio) y el embudo por estado son salidas de `cmd_embudo`; la inactividad, de
`cmd_seguimientos`. SOFI no calcula nada nuevo — **decide el orden en que te lo
cuenta**, que es exactamente el trabajo que hoy hace el asesor de memoria y mal.

**Qué problema resuelve:** el asesor trabaja por orden de bandeja (lo último que
entró), no por valor comercial (lo que está por perderse). **Cuánto ahorra:**
menos que tiempo — evita la pérdida silenciosa de leads calientes que se enfrían
por atender primero lo que llegó de último. **Qué fricción elimina:** la de
priorizar bajo presión. **Adopción:** el asesor siente que SOFI piensa como un
coordinador comercial, no como una lista de tareas.

### 2.3 Durante el día — contexto que no se repite *(responde la pregunta 6)*

Este es el corazón de "compañero" y no "buscador". La sesión ya mantiene el
**contexto activo** (§5.2 de la arquitectura): propiedad en foco, lead en foco,
última coincidencia. Usado a fondo, elimina la repetición:

> Carlos: Muéstrame la REF 9205982
> SOFI: *(ficha)*
> Carlos: ¿qué similares tengo?
> SOFI: *(3 similares — sabe que "similares" es a la 9205982)*
> Carlos: genérame un mensaje para Marcela con la segunda
> SOFI: *(borrador — sabe quién es Marcela porque es la cita de las 11:00 que
> mencionó en el parte de la mañana)*

SOFI **arrastra el contexto de toda la jornada**: la cita que anunció al abrir
sigue siendo "Marcela" ocho horas después; la propiedad que se miró a las 9
sigue siendo "esa" a las 4 de la tarde. El asesor nunca vuelve a escribir una
referencia, un nombre o una ref que ya dijo hoy.

**Qué problema resuelve:** en un buscador, cada consulta empieza de cero — el
asesor re-teclea el nombre del cliente, la ref, el contexto. **Cuánto ahorra:**
segundos por interacción, decenas de interacciones al día — pero sobre todo
elimina el **costo mental** de reconstruir el contexto cada vez. **Qué fricción
elimina:** la sensación de estar dictándole a una máquina desmemoriada.
**Adopción:** es literalmente la diferencia entre hablar con un colega que
estuvo contigo toda la mañana y hablar con un formulario.

### 2.4 Tareas repetitivas convertidas en conversación *(responde la pregunta 8)*

Las cuatro tareas que un asesor hace veinte veces al día ya tienen herramienta;
la experiencia consiste en que se sientan como pedirle un favor a alguien, no
como llenar un campo:

| Tarea repetitiva de hoy | Con SOFI (herramienta existente) |
|---|---|
| Buscar la ficha, copiar el link, pegarlo en WhatsApp del cliente | "compártele la ficha a Marcela" → `compartir_ficha` (arma el link y envía por el canal existente, con confirmación) |
| Redactar el mensaje de seguimiento desde cero | "escríbele algo para retomar" → `generar_mensaje_cliente` (usa el contexto de venta de la propiedad) |
| Anotar en algún lado la propiedad que pasó un colega | "un colega me pasó un apto en Envigado, 480, contacto Pedro 300…" → `registrar_propiedad_colega` |
| Marcar una venta cerrada / mover el estado | "marca como vendida la de Laureles con Marcela, 620 millones" → `registrar_cierre` |

Ninguna es nueva. Lo nuevo es que **se dictan en una frase** en lugar de
navegar a la pantalla, encontrar el registro, abrir el formulario y guardar.

**Qué problema resuelve:** cada micro-tarea administrativa saca al asesor de su
foco (vender) y lo mete en foco de operador de software. **Cuánto ahorra:**
1–3 min por tarea × 15–20 tareas/día = **media hora larga diaria** devuelta a
vender. **Qué fricción elimina:** el cambio de contexto pantalla-a-pantalla, que
es donde se pierde el hilo comercial. **Adopción:** el asesor deja de sentir el
CRM como "trabajo extra" y empieza a sentirlo como dictado a un asistente.

### 2.5 Cierre del día

A las 6:00, cuando Carlos escribe "me voy" o simplemente al cerrar, SOFI cierra
el ciclo:

> Buen día hoy, Carlos: **3 seguimientos hechos**, 1 cita cumplida, **1 venta
> cerrada** ($620M). Quedan 2 leads calientes sin tocar — te los dejo de
> primeros para mañana. Descansa.

Es `cmd_metricas_leads` + `cmd_metricas_ventas` + `cmd_seguimientos` en una
frase, y **siembra el parte de mañana** (los 2 pendientes serán lo primero del
día siguiente — así el contexto sobrevive incluso a la noche, sin pedirle nada
al asesor).

**Qué problema resuelve:** el asesor termina el día sin saber si avanzó o solo
se movió. **Cuánto ahorra:** el reporte que hoy no hace (o que le piden en
reunión). **Qué fricción elimina:** la ansiedad de "¿se me quedó algo?".
**Adopción:** cerrar con una pequeña victoria reconocida es lo que hace que
alguien quiera volver a abrir la app mañana.

---

## 3. La jornada del administrador

### 3.1 Apertura — el panorama, priorizado *(responde las preguntas 1 y 2)*

El admin abre SOFI y lo primero no son números planos, es **lo que exige su
atención**:

> **Buenos días, Juan.** El mes va bien: 63 leads (+18% vs junio) y 5 ventas
> ($1.240M). Pero hay dos cosas que mirar: el embudo se está **frenando en
> "transferido"** — 6 leads ahí con +5 días sin actividad — y **María tiene 4
> leads calientes sin tocar** desde el lunes. ¿Empezamos por el embudo?

La priorización automática es el punto: el admin no necesita el dato completo,
necesita **la excepción**. SOFI ordena su saludo por *desviación de lo normal*,
no por totales. Todo sale de funciones existentes:

- `cmd_metricas_ventas` ya devuelve la comparativa con el periodo anterior → el
  "+18%" y el "5 ventas".
- `cmd_embudo` ya devuelve leads por estado → detectar el atasco en un estado.
- `cmd_seguimientos` agregado por asesor → detectar quién tiene calientes fríos.

**Qué problema resuelve:** un dashboard tradicional le muestra al admin *todo* y
lo obliga a él a encontrar el problema entre el ruido. **Cuánto ahorra:** los
20–30 min diarios de "leer tableros buscando qué está mal". **Qué fricción
elimina:** la vigilancia manual. **Adopción:** el admin descubre que SOFI ya
miró por él — pasa de operador de tableros a decisor.

### 3.2 Detección temprana *(responde la pregunta 4)*

"Antes de que ocurra" no requiere predicción mágica: requiere leer las señales
que ya están en los datos y que hoy nadie mira a tiempo. Todas son composiciones
de las funciones existentes; lo nuevo es **que SOFI las levante sin que se lo
pidan**:

| Señal (ya computable) | Problema que anticipa |
|---|---|
| Un estado del embudo con leads estancados +N días (`cmd_embudo` + inactividad) | Cuello de botella: transferencias que no se atienden → ventas que se caen |
| Un asesor con leads calientes sin actividad (`cmd_seguimientos` por asesor) | Sobrecarga o desatención → leads valiosos que se enfrían |
| Caída de leads vs periodo anterior (`cmd_metricas_leads` comparado) | Problema de captación (pauta, landing) antes del cierre de mes |
| Ritmo de ventas por debajo del mes anterior a mitad de mes (`cmd_metricas_ventas`) | Mes flojo, con tiempo aún para corregir |
| Coincidencias de Memoria de Mercado sin validar acumulándose (`cmd_memoria_mercado_match`) | Oportunidades de red que se vencen sin que nadie contacte al colega |

SOFI no diagnostica la causa ni actúa por su cuenta (P8): **señala la anomalía y
propone a quién preguntarle**. La decisión sigue siendo del admin.

**Qué problema resuelve:** los problemas de un pipeline se ven cuando ya
costaron una venta; para entonces es tarde. **Cuánto ahorra:** no es tiempo, es
**ventas rescatadas** — un lead caliente atendido a tiempo. **Qué fricción
elimina:** la de tener que sospechar que algo va mal para ir a buscarlo.
**Adopción:** la primera vez que SOFI le avisa de un atasco que él no había
visto, el admin ya no puede trabajar sin ella.

### 3.3 Tareas del administrador como conversación *(responde la pregunta 9)*

El trabajo de dirección es preguntar, comparar y redirigir. Lo que ya es
computable, se conversa; lo que es una acción sobre un registro que SOFI no
posee como herramienta, SOFI lo **enruta al lugar exacto** (ver §5):

> Juan: ¿cómo va cada asesor este mes?
> SOFI: *(ranking por ventas y por leads atendidos — `cmd_metricas_*` por
> asesor)*
> Juan: los 4 leads calientes de María, ¿por qué están fríos?
> SOFI: 3 son de la última campaña de Instagram, entraron el lunes; ninguno
> tiene cita agendada. Si quieres reasignarlos, te abro la vista de leads de
> María filtrada — desde ahí los mueves en dos clics.

SOFI **no reasigna** (no es una de las 11 herramientas, y no se crean
herramientas nuevas). Pero lleva al admin de "sospecha" a "acción" sin que él
tenga que construir la consulta ni encontrar la pantalla. La navegación que
queda es la mínima e inevitable: el clic que ejecuta la decisión humana.

**Qué problema resuelve:** el admin gasta su tiempo *fabricando* las vistas
(filtrar, cruzar, exportar) en lugar de decidir sobre ellas. **Cuánto ahorra:**
los minutos de armar cada consulta ad-hoc, varias veces al día. **Qué fricción
elimina:** la traducción de una pregunta de negocio a una secuencia de filtros
de CRM. **Adopción:** el admin le habla a SOFI como le hablaría a un analista.

---

## 4. Conversaciones que se inician solas *(responde la pregunta 5)*

Estos son los eventos que SOFI levanta en el momento en que ocurren, porque son
justamente los que el usuario perdería si tuviera que acordarse de ir a
mirarlos. **Todos son eventos que la arquitectura ya produce hoy** — el cambio
es que SOFI *abre una conversación* en vez de mandar una alerta muda de un solo
tiro.

| Evento (ya existe) | Conversación que SOFI inicia | Con quién |
|---|---|---|
| Coincidencia en Memoria de Mercado para un lead (§7.4) | "Apareció una posible opción para un cliente tuyo. Está *pendiente de validación*: te paso los datos del colega para que confirmes disponibilidad antes de ofrecer." | Asesor dueño del lead |
| Transferencia de un lead calificado (tool `transferir_a_asesor`) | "Te transfirieron a Marcela Ruiz, caliente, busca en Laureles. Te dejo su ficha y un borrador de primer mensaje." | Asesor receptor |
| Cita próxima (dato en `leads.cita`) | "En una hora tienes la visita con Marcela. ¿Te preparo la ficha y la ruta?" | Asesor |
| Lead caliente que lleva N días sin actividad (`cmd_seguimientos`) | "Ojo: el lead de la pauta lleva 4 días sin respuesta y está caliente. ¿Le escribimos?" | Asesor dueño |
| Atasco del embudo / anomalía (§3.2) | El panorama de apertura, o un aviso si ocurre en el día | Admin |

La regla de proactividad honesta (§1) aplica: estos son **los únicos** disparos
no solicitados dentro de la jornada, y cada uno termina en una pregunta que el
usuario puede ignorar. SOFI abre la puerta; no empuja.

**Qué problema resuelve:** los eventos importantes hoy llegan como una
notificación suelta que el asesor lee y olvida, sin acción inmediata a mano.
**Cuánto ahorra:** convierte "me enteré" en "lo resolví" sin pasos intermedios.
**Qué fricción elimina:** la distancia entre saber que algo pasó y hacer algo al
respecto. **Adopción:** SOFI aparece exactamente cuando aporta, que es como se
gana la confianza de que vale la pena tenerla siempre abierta.

---

## 5. Cuánto se reduce la navegación *(responde la pregunta 7)*

El objetivo no es prohibir las pantallas: es que el asesor **no necesite
buscarlas**. Tres niveles, de más a menos deseable:

1. **Respuesta en la conversación** (lo ideal, la mayoría de los casos): la
   métrica, la ficha, el similar, el borrador — todo llega en el chat. Cero
   navegación.
2. **Enlace directo a la vista exacta** (cuando una tabla se ve mejor o hay una
   acción que SOFI no ejecuta): SOFI entrega el link a la vista *ya filtrada*
   ("te abro los leads de María del lunes"). El usuario aterriza donde debe, sin
   navegar el menú.
3. **Navegación libre por el menú** (lo residual): solo para exploración abierta
   o acciones masivas. Deja de ser el modo principal de trabajo.

Hoy el trabajo diario vive en el nivel 3. La experiencia que propone este
documento **mueve el 80% de las interacciones al nivel 1 y el resto al nivel 2**,
usando exactamente las herramientas y vistas que ya existen.

**Qué problema resuelve:** cada pantalla que el asesor tiene que encontrar y
cargar es una oportunidad de distraerse y una barrera de entrada para el asesor
poco técnico. **Cuánto ahorra:** clics y cargas — pero sobre todo baja la curva
de aprendizaje del CRM casi a cero (si sabes chatear, sabes usarlo). **Qué
fricción elimina:** la de aprender dónde está cada cosa. **Adopción:** es el
factor decisivo para el asesor mayor o menos digital, que es justo quien más se
resiste a un CRM tradicional.

---

## 6. Qué partes del CRM dejan de ser el día a día *(responde la pregunta 10)*

Honestamente: **nada se borra.** Pero varias vistas pasan de ser el "puesto de
trabajo" a ser herramientas ocasionales. Esa degradación es la medida real del
éxito de la experiencia.

| Vista actual | Si SOFI funciona bien… |
|---|---|
| **Inbox** | Sobrevive intacto: es la superficie de la conversación con el cliente (donde vive Sofi-Cliente). Lo que muere es el hábito de *entrar a contar* conversaciones activas — eso lo dice el parte del día. |
| **Kanban** | Deja de ser para *leer* el estado (SOFI te lo cuenta) y para *cambiar* un estado suelto (se dicta). Sobrevive para la manipulación visual masiva y la vista de conjunto ocasional. |
| **Tabla de leads** | Deja de ser para *consultar y filtrar* (SOFI responde). Sobrevive para acciones que no son herramientas de SOFI (reasignar, borrar) y como destino de los enlaces del nivel 2. |
| **Red de aliados** | Deja de ser para *registrar y validar* de a uno (se conversa: tools 9, 10 y la validación de §7.5). Sobrevive como vista de auditoría y gestión masiva. |
| **Marketing / Usuarios** | Sin cambios — fuera del alcance de Sofi-Comando, siguen siendo pantallas de admin. |

La conclusión honesta: SOFI no reemplaza el CRM, lo **vuelve invisible**. El CRM
sigue ahí, haciendo el trabajo pesado por debajo; el asesor simplemente deja de
verlo. Ese es el estado final deseado — el CRM como motor, SOFI como el único
lugar donde el usuario vive.

---

## 7. El día completo, de un vistazo

```
08:00  SOFI abre con el parte: pendientes, cita de las 11, lead caliente frío.
       → El asesor no decide por dónde empezar; ya está decidido.
09:30  "muéstrame la 9205982" → "similares" → "mensaje para Marcela".
       → Contexto arrastrado, cero repetición.
10:00  SOFI: "en una hora tienes la visita con Marcela, ¿te preparo la ficha?"
       → Evento que se inicia solo.
11:00  Visita.
13:00  "compártele la ficha al cliente de esta mañana" → enviado.
       → Tarea repetitiva en una frase.
15:00  SOFI: "apareció una posible opción para tu cliente de Envigado —
       pendiente de validación, aquí van los datos del colega."
       → Memoria de Mercado, conversación automática.
17:30  "marca como vendida la de Laureles, 620" → registrado, felicitación.
18:00  Cierre: resumen del día + siembra de los 2 pendientes para mañana.
```

Ocho horas en las que el asesor **nunca abrió un menú para saber qué hacer**,
nunca repitió un nombre, nunca redactó un mensaje desde cero y nunca perdió un
evento importante. No porque SOFI tenga capacidades nuevas — porque las que
tiene aparecen en el momento justo.

---

## 8. Tabla maestra de movimientos de experiencia

Todo lo anterior, con su justificación, sin una sola pieza nueva de
arquitectura:

| # | Movimiento | Piezas existentes que reensambla | Problema | Ahorro estimado | Fricción que elimina |
|---|---|---|---|---|---|
| 1 | Parte del día (asesor) | `cmd_seguimientos`, `cmd_metricas_leads`, `leads.cita` | Empezar sin saber por dónde | 10–15 min/día | Folio en blanco |
| 2 | Plan del día priorizado | `cmd_embudo` (temperatura), `cmd_seguimientos` | Trabajar por bandeja, no por valor | Leads calientes rescatados | Priorizar bajo presión |
| 3 | Contexto arrastrado toda la jornada | Contexto activo (§5.2) | Repetir referencias en cada consulta | Costo mental continuo | Máquina desmemoriada |
| 4 | Tareas repetitivas dictadas | Tools 7, 8, 9, 11 | Cambio de contexto pantalla-a-pantalla | ~30 min/día | Operar software en vez de vender |
| 5 | Cierre + siembra de mañana | `cmd_metricas_*`, `cmd_seguimientos` | Terminar sin saber si avanzó | Reporte no hecho | Ansiedad de pendientes |
| 6 | Panorama por excepción (admin) | `cmd_metricas_ventas`, `cmd_embudo`, `cmd_seguimientos` | Leer tableros buscando el problema | 20–30 min/día | Vigilancia manual |
| 7 | Detección temprana (admin) | Composición de funciones existentes | Ver el problema cuando ya costó | Ventas rescatadas | Sospechar para buscar |
| 8 | Conversaciones que se inician solas | Eventos ya producidos (§7.4, transfer, cita) | "Me enteré" sin acción a mano | "Enterarse" → "resolver" | Distancia saber–actuar |
| 9 | Navegación colapsada a 1 conversación | Todas las herramientas + enlaces a vistas | Encontrar y cargar pantallas | Curva de aprendizaje ≈ 0 | Aprender dónde está todo |
| 10 | CRM vuelto invisible | Vistas existentes degradadas a fallback | El CRM como carga cognitiva | — | El CRM deja de "verse" |

---

## 9. La única frontera honesta

Todo lo de este documento se dispara **dentro de una sesión que el usuario
abre**. Hay una versión más ambiciosa de "proactivo" —que SOFI le escriba al
WhatsApp del asesor a las 7:55 con el parte, sin que él abra nada— que **sí
requeriría maquinaria nueva** (un programador de tareas que despierte solo). Eso
contradice la consigna de "ninguna capacidad nueva", así que **queda fuera de
V1** y se anota como la primera candidata de una eventual Experience V2. La
distinción importa: la proactividad de V1 es *gratis* en términos de
arquitectura porque reutiliza el gatillo que ya existe (abrir sesión); la del
empujón nocturno no lo es.

Con esa sola excepción, **SOFI EXPERIENCE V1 no pide nada nuevo.** Pide usar lo
aprobado con otra actitud.

---

## Trazabilidad contra las 10 preguntas

| Pregunta | Dónde se responde |
|---|---|
| 1. ¿Qué dice SOFI al iniciar el día? | §2.1 (asesor) y §3.1 (admin) |
| 2. ¿Qué prioriza según el contexto del usuario? | §3.1 (excepción, no totales) + §2.2 (valor comercial) |
| 3. ¿Cómo ayuda a organizar la jornada del asesor? | §2.2 (plan del día priorizado) |
| 4. ¿Cómo ayuda al admin a detectar problemas antes? | §3.2 (detección temprana) |
| 5. ¿Qué conversaciones se inician automáticamente? | §4 (tabla de eventos) |
| 6. ¿Qué contexto recuerda toda la jornada? | §2.3 (contexto activo arrastrado) |
| 7. ¿Cómo reducir aún más la navegación? | §5 (tres niveles) |
| 8. ¿Qué tareas repetitivas del asesor se vuelven conversación? | §2.4 |
| 9. ¿Qué tareas del admin se vuelven conversación? | §3.3 |
| 10. ¿Qué partes del CRM dejan de ser necesarias? | §6 |
