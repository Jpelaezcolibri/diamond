# Modelo de Gobernanza de Decisiones

**Estado:** BORRADOR
**Naturaleza:** modelo de referencia. Se construye sobre el
[Modelo Operacional](modelo-operacional-inmobiliaria.md): toma cada decisión
identificada allí y la clasifica según quién debe tomarla. Es la capa de
gobernanza que da coherencia a todo lo que se construya después.

## La pregunta

> Asumiendo que se puede rediseñar una inmobiliaria desde cero: ¿qué
> decisiones deben permanecer en manos de personas porque aportan juicio,
> negociación, confianza o responsabilidad legal, y cuáles pueden ser
> recomendadas o ejecutadas por un sistema inteligente sin perder el control
> del negocio?

Este documento no diseña software, ni módulos, ni agentes. Solo clasifica
decisiones y explica por qué cada una cae donde cae. La clasificación es
deliberadamente agnóstica: describe cómo debería gobernarse *cualquier*
inmobiliaria, no una en particular. Esa es justamente su ventaja: un catálogo
de funcionalidades se copia; un modelo explícito de gobernanza de decisiones,
sobre el que se construye toda una plataforma, es mucho más difícil de
replicar.

---

## Los tres niveles de gobernanza

Toda decisión del negocio cae en uno de tres niveles:

- **H — Humana (reservada).** La persona la toma. El sistema, a lo sumo,
  ordena la información previa, pero no recomienda el resultado ni lo ejecuta.
  La decisión requiere juicio contextual, negociación, confianza o
  responsabilidad legal que un sistema no puede sostener.

- **A — Asistida (recomendada por el sistema).** El sistema hace el trabajo
  pesado —reúne la evidencia, la ordena, calcula, propone una recomendación o
  un borrador— y **la persona decide y responde**. El juicio final sigue
  siendo humano, pero deja de partir de cero.

- **S — Autónoma (ejecutada por el sistema, con control).** El sistema decide
  y ejecuta dentro de una política definida. El humano no interviene en cada
  caso: supervisa por excepción y puede revertir. Reservada a decisiones
  repetitivas, de regla clara, evidencia estructurada, consecuencia acotada y
  reversible.

---

## Criterios de clasificación

El nivel de una decisión es el balance entre dos fuerzas opuestas.

**Fuerzas que la retienen en manos humanas** (las cuatro de la pregunta):

1. **Juicio** — depende de contexto difuso, matiz, lectura de la situación.
2. **Negociación** — su valor está en la interacción viva entre dos voluntades.
3. **Confianza / relación** — la decisión *es* la relación con el cliente; delegarla erosiona el activo que se gestiona.
4. **Responsabilidad legal / fiduciaria** — alguien debe responder ante la ley o ante el dueño del dinero.

**Fuerzas que la habilitan para el sistema** (las inversas):

5. **Repetitividad / frecuencia** — ocurre muchas veces igual.
6. **Determinismo por reglas** — existe un criterio explícito y estable.
7. **Evidencia estructurada** — la información para decidir está completa y es legible.
8. **Reversibilidad y magnitud acotada** — equivocarse es barato y se deshace.

Regla de lectura: a más presencia de 1–4, más se acerca a **H**; a más
presencia de 5–8, más se acerca a **S**; **A** es el terreno intermedio, y es
el más poblado.

### Dos líneas rojas (topes que la tecnología no mueve)

Por buena que sea la evidencia, dos clases de decisión **nunca** pasan a
autónomas:

- **Responsabilidad legal o fiduciaria.** Si un humano debe responder ante la
  ley, una autoridad o el propietario del dinero, el sistema puede prepararla
  y calcularla, pero el humano la firma y la posee. (Ej.: presentar una
  declaración tributaria, iniciar una acción legal, autorizar la salida de
  dinero de terceros.)
- **Relación y negociación de alto riesgo.** Cuando la decisión *es* el
  vínculo de confianza o una negociación de alto monto, delegarla destruye lo
  que se administra. (Ej.: retener a un propietario molesto, cerrar una
  contratación, aceptar una oferta importante.)

### La autonomía se gana (gradiente)

El nivel no es fijo. Una decisión **A** puede migrar a **S** a medida que se
acumula evidencia de que la recomendación acierta y de que el error es
acotado. El movimiento válido es **A → S**, nunca a costa de cruzar una línea
roja. La clasificación de abajo indica también, cuando aplica, hacia dónde
tiende una decisión con el tiempo (`A→S`).

---

## Nota sobre decisiones de actores externos y clientes

Las decisiones del **propietario, comprador, arrendatario, banco,
aseguradora, abogado externo y proveedores** no son de la inmobiliaria y no
se pueden gobernar directamente. Lo que sí se gobierna es la **decisión
sombra** de la inmobiliaria frente a ellas: la recomendación, la
pre-calificación o el insumo que la inmobiliaria aporta. En la clasificación,
esas filas se marcan como *(sombra)* y clasifican el aporte de la
inmobiliaria, no la decisión ajena.

---

## Clasificación de las decisiones

### Nivel S — Autónomas (ejecuta el sistema, control por excepción)

Repetitivas, de regla clara, evidencia estructurada y consecuencia acotada.

| Decisión | Actor / origen | Por qué es autónoma | Rol del sistema |
|---|---|---|---|
| Ordenar y priorizar la fila de leads por urgencia | Asesor | Alta frecuencia, criterio scoreable, reversible | Ordena la cola; la atención sigue siendo humana |
| Rutear/asignar cada lead al asesor | Coordinador | Regla clara (carga, zona, especialidad, desempeño) | Asigna dentro de política; override humano |
| Disparar la cadencia de seguimiento (cuándo tocar) | Asesor | Tiempo regido por reglas, reversible | Dispara el recordatorio; el *qué decir* delicado es humano |
| Coordinar y agendar/reagendar visitas | Asesor | Logística determinista, reversible | Agenda dentro de disponibilidad |
| Pausar, repautar o bajar prioridad de un anuncio sin tracción | Marketing | Regla sobre métricas, reversible | Ejecuta dentro de política de pauta |
| Calcular el incremento anual de canon (IPC/contrato) | Administración | Cálculo determinista | Calcula; la retención/negociación es humana |
| Ordenar y ejecutar la cadencia de recaudo/cobro temprano | Administración | Alta frecuencia, regla clara, reversible | Ejecuta cobro rutinario; casos sensibles a humano |
| Autorizar reparación bajo umbral y con proveedor aprobado | Administración | Monto acotado, política definida, reversible | Ejecuta dentro del umbral; sobre umbral sube a A/H |
| Calcular la liquidación mensual al propietario | Administración/Contab. | Cómputo determinista | Calcula; la *aprobación del pago* queda en A (línea roja fiduciaria) |
| Clasificar y registrar transacciones estándar | Contabilidad | Regla contable estable, evidencia estructurada | Registra; excepciones a revisión humana |
| Verificar checklist documental de captación | Captador | Cotejo contra requisitos, sin ambigüedad | Verifica completitud; la decisión de proceder es A/H |
| Despachar trabajos rutinarios a proveedores del roster aprobado | Administración | Selección acotada a lista aprobada | Despacha dentro del roster |

### Nivel A — Asistidas (recomienda el sistema, decide el humano)

El terreno más amplio: hay evidencia suficiente para una buena
recomendación, pero el juicio, la relación o la responsabilidad exigen que
decida una persona. Varias tienden a `A→S` con madurez.

| Decisión | Actor / origen | Por qué es asistida | Rol del sistema |
|---|---|---|---|
| Recomendar el precio de salida | Captador → Propietario *(sombra)* | Scoreable con comparables, pero decide el dueño y hay negociación | Calcula y recomienda; el humano valida y sustenta `A→S` en el cálculo |
| Perseguir o descartar un propietario/inmueble | Captador | Mucho es scoreable (zona, docs, precio), pero hay lectura de contexto | Prioriza y filtra; el humano decide la persecución `A→S` |
| Calificar el lead (caliente/frío) | Asesor | Señales scoreables, pero con matiz | Pre-califica y puntúa; el humano confirma `A→S` |
| Recomendar qué inmuebles mostrar (match) | Asesor | Emparejamiento evidenciable | Recomienda el match; el humano curó `A→S` |
| Detectar y proponer reasignar un negocio estancado | Coordinador | Detección automática, pero decisión relacional y de justicia | Señala el estancamiento; el humano decide |
| Recomendar qué inventario promover y con qué prioridad | Marketing | Scoreable (antigüedad, exclusividad, margen) | Recomienda prioridad `A→S` |
| Recomendar la distribución de presupuesto por canal | Marketing | Optimizable con datos, pero compromete gasto | Recomienda asignación; el humano compromete el presupuesto |
| Redactar/proponer mensajes y creativos | Marketing | Hay patrón, pero el criterio de marca es humano | Propone borradores; el humano aprueba |
| Recomendar aceptar/contraofertar una oferta | Asesor → Propietario *(sombra)* | Analizable con comparables, pero es negociación de alto monto | Aporta el análisis del trato; el humano negocia y decide |
| Validar soportes antes de un pago | Contabilidad | Cotejo automatizable, pero el dinero sale (fiduciario) | Pre-valida contra soporte/autorización; el humano libera |
| Aplicar y liquidar retenciones/impuestos | Contabilidad | Reglas deterministas, pero con responsabilidad legal | Calcula; el contador responde y firma |
| Aprobar la liquidación/pago mensual al propietario | Administración | Cálculo automático, pero es dinero de terceros | Presenta la liquidación lista; el humano aprueba por excepción |
| Decidir escalar una mora a cobro jurídico | Administración → Abogado | Umbral objetivo, pero consecuencia legal alta | Señala al llegar al umbral; el humano dispara la acción |
| Priorizar la cartera vencida y el mapa de riesgo | Gerente/Administración | Aging y riesgo son computables | Ranquea el riesgo; la estrategia la decide el humano |
| Recomendar zonas/segmentos donde crecer | Gerente | Demanda y margen son analizables | Surface de analítica; el humano decide la apuesta |
| Recomendar condiciones de crédito / pre-calificar comprador | Banco *(sombra)* | La inmobiliaria puede anticipar viabilidad | Pre-califica al comprador antes de enviarlo al banco `A→S` |
| Pre-evaluar candidato arrendatario antes del estudio | Aseguradora *(sombra)* | Perfil scoreable de forma anticipada | Pre-filtra viabilidad; la aseguradora decide `A→S` |
| Recomendar y controlar selección de proveedor | Administración | Historial y costo comparables | Ranquea proveedores; el humano selecciona `A→S` |
| Emparejar y recomendar inventario al comprador/arrendatario | Comprador/Arrendatario *(sombra)* | Matching evidenciable | Recomienda opciones; el cliente decide |
| Redactar cláusulas y contratos estándar | Abogado | Plantillas estables, pero con responsabilidad legal | Genera el borrador estándar; el abogado lo posee y adapta |

### Nivel H — Humanas (reservadas)

Aquí dominan juicio, negociación, confianza o responsabilidad legal. El
sistema puede preparar el terreno, pero no recomienda el resultado ni lo
ejecuta. Muchas tocan una línea roja.

| Decisión | Actor / origen | Por qué se reserva | Línea roja |
|---|---|---|---|
| Exigir exclusividad o aceptar mandato abierto | Captador | Negociación y relación con el propietario | Negociación |
| Intervenir en una negociación difícil de cierre | Coordinador/Asesor | Lectura viva de la contraparte | Negociación |
| Resolver un conflicto de comisión o doble atención | Coordinador | Justicia y clima interno; el sistema solo aporta el registro de quién contactó primero | Confianza |
| Retener (o soltar) a un propietario/negocio problemático | Gerente | La decisión *es* la relación | Confianza / Negociación |
| Fijar o ajustar comisiones e incentivos | Gerente | Estratégica, alto impacto en el equipo | Confianza |
| Contratar o desvincular personas | Gerente | Legal, ético y relacional | Legal / Confianza |
| Decidir la inversión estratégica (marketing/tecnología) | Gerente | Apuesta de capital bajo incertidumbre | — |
| Aprobar o frenar un negocio por riesgo legal | Abogado | Responde ante la ley por el vicio no detectado | Legal |
| Iniciar una acción legal (restitución/cobro jurídico) | Abogado | Compromiso legal y de costo | Legal |
| Recomendar acuerdo vs. litigio | Abogado | Juicio jurídico de resultado incierto | Legal |
| Firmar declaraciones y responsabilidad tributaria final | Contabilidad | Responde ante la autoridad | Legal |

---

## Cómo se lee esta clasificación

- **La mayoría de las decisiones son Asistidas.** El negocio no se parte en
  "lo que hace la máquina" y "lo que hace la persona": casi todo es un humano
  decidiendo mejor porque el sistema le puso la evidencia y una recomendación
  enfrente. Ese es el estado natural del negocio bien gobernado.
- **Lo Autónomo es lo repetitivo, acotado y reversible**, no lo difícil.
  Autonomía no significa "el sistema decide lo importante"; significa "el
  sistema absorbe el volumen mecánico" para que el humano gaste su juicio
  donde importa.
- **Lo Humano se concentra en tres focos:** la negociación (donde el valor
  está en la interacción), la relación (donde decidir mal rompe el activo) y
  la responsabilidad legal (donde alguien debe responder). Fuera de esos
  focos, casi todo es delegable como mínimo a Asistido.
- **Las líneas de cálculo y de aprobación se separan.** Un patrón que se
  repite: el sistema *calcula* de forma autónoma (liquidación, incremento,
  retención) pero el humano *aprueba* la consecuencia cuando hay dinero de
  terceros o responsabilidad legal. Calcular y decidir no son el mismo acto.
- **La frontera se mueve, pero no atraviesa las líneas rojas.** El diseño
  maduro empuja decisiones de A hacia S conforme la evidencia demuestra
  acierto y bajo costo del error, y mantiene intactas las que tocan
  responsabilidad legal o relación de confianza.

Estas son lecturas del modelo, no recomendaciones de producto ni diseño de
solución. Su valor es servir de criterio único: ante cualquier pieza que se
quiera construir después, la primera pregunta será siempre la misma —**¿esta
decisión pertenece a un humano, a un humano asistido o a un sistema
autónomo?**— y este documento es dónde se responde.
