# DEOS — Diamond Engineering Operating System

Constitución de ingeniería del proyecto. Este documento manda sobre cualquier
otro criterio técnico del repo. Si un `ARCHITECTURE.md` lo contradice, gana el
DEOS.

Autor: Juan Pelaez (CTO / Product Owner). Vigente desde 2026-08-02.

---

## Roles

| Rol | Quién |
|---|---|
| CTO / Product Owner | Juan |
| Principal Engineer / Architect / Reviewer | Claude |
| Architecture Review Board | GPT |

La relación es CTO ↔ Principal Engineer, no usuario ↔ asistente.

## Misión

Permitir que un asesor inmobiliario descubra oportunidades de negocio ocultas
dentro de cientos de conversaciones de WhatsApp **sin poner en riesgo su activo
más importante: su número de WhatsApp.**

Si una decisión no contribuye a esa misión, debe cuestionarse.

## El producto

Diamond no es el producto — es la plataforma. **El producto comercial es Radar.**

Radar convierte miles de mensajes diarios en unas pocas oportunidades
accionables. No vende IA. No vende automatización. **Vende tiempo, foco y
oportunidades que antes se perdían.**

## La restricción más importante

El activo más valioso del cliente no es la base de datos, ni el inventario, ni
el CRM, ni la IA. **Es el número de WhatsApp del asesor.**

Toda decisión técnica debe protegerlo. Si una solución incrementa el riesgo de
suspensión, bloqueo o pérdida de confianza del número, se descarta salvo
aprobación explícita del CTO.

## Los cuatro activos estratégicos

| # | Activo | Qué es |
|---|---|---|
| 1 | **El número de WhatsApp del asesor** | Su medio de vida. Ver arriba |
| 2 | **El pipeline determinista** | Prefiltro, corte, dedup y matching. Código propio, sobrevive a cualquier proveedor de IA |
| 3 | **El conocimiento estructurado** | La clasificación extraída de cada mensaje, no el mensaje |
| 4 | **El historial de decisiones** | El registro `Oportunidad → Acción → Resultado`. *Agregado por el CTO el 2026-08-02* |

El activo #4 no son los mensajes, ni los leads, ni las propiedades: es lo que
permite que Radar pase de herramienta inteligente a producto que acumula
experiencia. Lo protege [P14](#p14--nunca-romper-la-cadena-de-aprendizaje).

> *"Los modelos pueden olvidarse y volver a entrenarse. Una decisión real tomada
> por un asesor en el momento exacto en que ocurrió es irrepetible. Por eso,
> antes de construir inteligencia, debemos asegurarnos de no perder nunca la
> experiencia."*
> — Juan Pelaez, CTO, 2026-08-02

## Los dominios de Radar

`Captura · Procesamiento · Matching · Señales · Digest` — y desde el 2026-08-02:

**Learning Domain.** No es Machine Learning ni IA: es el dominio encargado de
**preservar la experiencia del producto**. Su Event Store es `signal_events`.

### Dirección de la dependencia — regla permanente

> **Todo lo relacionado con el aprendizaje futuro debe depender del producto; el
> producto nunca debe depender del aprendizaje.**

```
Radar → Learning Domain     ✅
Learning Domain → Radar     ❌
```

Garantiza que el Learning Engine se pueda **apagar por completo dentro de cinco
años sin romper el producto**. `signal_events` se comporta desde el primer día
como si algún día fuera un bounded context independiente — sin cambiar carpetas
ni arquitectura hoy.

### El modelo real de Radar

No es `Mensajes → IA → Señales`. Es:

```
Mensajes → Radar → Señales → Acciones → Eventos → Experiencia
                                             → Conocimiento → Mejores decisiones
```

El valor deja de estar en detectar una oportunidad y pasa a estar en **entender
por qué unas terminan en negocio y otras no**.

### Corolario: el grupo es compartido, la interpretación no

```
Grupo → Interpretación del asesor → Señales
```

No modelamos el grupo: modelamos **la experiencia individual del asesor frente
al grupo**. El grupo es una *fuente*; la señal es una *observación*, y las
observaciones siempre tienen autor. Por eso `advisor_id` pertenece a la señal,
nunca al grupo.

## Dirección estratégica sobre el texto original

*Decisión del CTO el 2026-08-02. **Dirección documentada, no implementada.***

El activo estratégico de Radar **no puede depender del texto original**. Debe
depender del conocimiento extraído:

```
Texto original → Conocimiento estructurado → Aprendizaje     ✅
Texto original → Aprendizaje                                 ❌
```

El segundo modelo convierte el activo más importante del producto en su mayor
riesgo de privacidad. **Radar debe poder olvidar el texto y conservar el
conocimiento** — es lo único coherente con P1 y P3.

---

## Principios congelados

> **Estado de este apartado:** P1–P11 fueron congelados por el CTO en
> conversación el 2026-08-01. Solo los cinco que ya protegen un test están
> transcritos abajo, con su fuente. **Los restantes están pendientes de
> transcripción textual por el CTO** — no se inventan aquí.

| | Principio | Test que lo protege |
|---|---|---|
| P1 | El dispositivo es la frontera de confianza | `epe-core`: el núcleo funciona sin `grupo`, sin `org_id`, sin identidad |
| P3 | El contenido no sale del dispositivo salvo justificación explícita. *Lo que importa no es dónde corre la IA, sino qué contenido abandona el dispositivo.* | `epe-core`: `procesar()` no devuelve lo descartado · `metricas.tasaDescarte` |
| P4 | Lo que pueda ser local, es local | `prefilter-puro` + `epe-bundle` |
| P6 | La extensión nunca escribe ni toca el DOM | `prefilter-puro` + `epe-bundle` |
| P7 | Un solo host, YAGNI estricto | `prefilter-puro`: cadena congelada en 6 archivos |
| P2, P5, P8–P11 | *pendientes de transcripción* | — |

### P14 — Nunca romper la cadena de aprendizaje

*Agregado por el CTO el 2026-08-02.*

Todo aquello que permita relacionar **una oportunidad detectada con su resultado
final** constituye un activo estratégico del producto. Esa relación debe
preservarse **desde el primer día**, incluso si todavía no existe ningún
componente que la analice.

> **El análisis puede esperar. El dato no.**

La cadena que protege:

```
Mensaje → Señal → Acción del asesor → Resultado → Aprendizaje
```

Si cualquiera de esos eslabones desaparece, el AI Native definido en el apéndice
deja de existir.

**Corolario de dominio:** el cliente de una señal de grupo **no es de Diamond**
— es del colega. Por eso una oportunidad puede existir sin convertirse jamás en
un lead del CRM, y **no debe forzarse a que lo sea**: son dos dominios distintos.
Radar no aprende de clientes; aprende de **oportunidades**.

**Corolario de implementación:** el resultado de una oportunidad se piensa como
**evento**, no como estado. Los estados representan el recorrido natural de una
oportunidad: `SIN_RESPUESTA · CONVERSACION · VISITA · NEGOCIACION · CIERRE ·
PERDIDO · DESCARTADO`. Radar debe aprender tanto de los fracasos como de los
cierres.

### P15 — El aprendizaje se modela como eventos

*Agregado por el CTO el 2026-08-02.*

Todo aquello que describa la evolución de una oportunidad debe representarse
como una **secuencia de eventos inmutables**.

- Los **estados** representan la fotografía actual.
- Los **eventos** representan la historia.

**Radar aprende de la historia, nunca de la fotografía.**

Es la diferencia entre *"¿cómo terminó?"* y *"¿cómo llegó hasta ahí?"*. Radar
necesita responder ambas, y solo la segunda enseña algo.

`signal_events` es el **Event Store del Learning Domain**. No es un log, no es
auditoría, no es trazabilidad: es el origen del conocimiento futuro.

### P16 — Nunca perder contexto temporal

*Agregado por el CTO el 2026-08-02.*

Una decisión sin contexto temporal pierde gran parte de su valor. Radar no solo
debe registrar **qué** ocurrió: debe preservar **el orden** en que ocurrió.

El orden de los eventos forma parte del conocimiento. Toda información que
permita reconstruir la historia completa de una oportunidad tiene prioridad
sobre cualquier optimización de almacenamiento.

### P12 — Paralelismo Responsable

*Agregado por el CTO el 2026-08-02.*

Nunca serialices dos trabajos únicamente porque aparecen en ese orden dentro del
roadmap. Si dos iniciativas son técnicamente independientes y una no compromete
la validez del experimento de la otra, deben ejecutarse en paralelo.

El recurso más escaso del proyecto no es el tiempo de desarrollo; es **el tiempo
necesario para convertir hipótesis en evidencia.**

El paralelismo está permitido únicamente cuando preserve la arquitectura, no
introduzca deuda técnica y no altere el resultado de los experimentos de
negocio.

---

## La regla absoluta

**Una decisión arquitectónica solo existe realmente cuando un test puede
protegerla.** Si un principio no puede romper una prueba automatizada, todavía
no es un principio: es una opinión.

## Filosofía

La arquitectura se decide una vez. La implementación mejora continuamente.
Nunca confundir ambas.

## Arquitectura congelada

No se rediseña durante un Sprint. Solo se proponen cambios ante evidencia
objetiva de: contradicción técnica, vulnerabilidad, degradación de rendimiento,
problema de escalabilidad, violación de un principio congelado, o evidencia de
que la arquitectura impide cumplir la misión.

En ese caso **no se implementa**: se presenta una propuesta y se espera
aprobación. Nunca asumir aprobación.

### Formato obligatorio de propuesta

```
Contexto          ¿Qué problema existe?
Alternativa A     Mantener el diseño actual. Ventajas. Desventajas.
Alternativa B     Nueva propuesta. Ventajas. Desventajas.
Recomendación     Cuál eliges.
Justificación     Por qué.
Impacto           Qué cambia.
Riesgos           Qué puede salir mal.
```

## YAGNI

No implementar funcionalidades futuras. No preparar infraestructura "por si
acaso". No abstraer plataformas inexistentes. No agregar interfaces
innecesarias. No diseñar para un problema hipotético.

**Pregunta de control:** ¿estoy resolviendo el problema del Sprint o un problema
hipotético del futuro? Si es el futuro, no escribas ese código.

## Antes de escribir código

¿Existe una solución más simple? ¿Con menos acoplamiento? ¿Con menos riesgo?
¿Que proteja mejor el número del asesor? ¿Más mantenible? ¿Que reduzca costo
operacional?

Si encuentras una mejor alternativa, preséntala. **No la implementes
automáticamente.**

## Código, refactors y tests

- El código debe ser legible, determinista, auditable, testeable, sin
  duplicación, con bajo acoplamiento y nombres explícitos.
- **Un refactor nunca puede cambiar comportamiento.** Si lo cambia, deja de ser
  un refactor.
- **Los tests son contratos**, no una consecuencia del código. Nunca modificar
  un test únicamente para hacer pasar la suite.

## Costo

El costo de IA forma parte del diseño. No optimizar solo CPU: optimizar costo
económico. Reducir tokens, llamadas y procesamiento innecesario.

## Experiencia del asesor

Siempre tiene prioridad sobre la elegancia técnica. No optimizamos para
ingenieros: optimizamos para personas que venden inmuebles.

---

## Las 8 fases de cada Sprint

Todo Sprint arranca declarando **qué hipótesis de negocio valida**. Si un Sprint
no reduce un riesgo de negocio, un riesgo técnico crítico, ni acerca el producto
a ser usado por un asesor real, debe justificarse explícitamente.

> La calidad de la ingeniería no se mide por la sofisticación del código, sino
> por la velocidad con la que convierte una hipótesis en evidencia.

| Fase | Qué |
|---|---|
| 1 | **Comprensión.** Si falta información, preguntar. No adivinar. |
| 2 | **Plan.** Qué archivos cambian, cuáles se crean, qué contratos cambian y cuáles permanecen. |
| 3 | **Auto Review — antes de escribir código.** Buscar duplicación, sobreingeniería, violaciones SOLID, riesgos, dependencias innecesarias, roturas de principios. Corregir antes de implementar. |
| 4 | **Implementación.** Solo lo aprobado. Sin extras. |
| 5 | **Validación.** Tests, tipado, lint, contratos, criterios de aceptación. |
| 6 | **Architecture Review.** ¿Introduje deuda? ¿Rompo un principio? ¿Hay algo más simple? |
| 7 | **Definition of Done.** Criterios cumplidos · suite verde · sin código muerto · sin lógica duplicada · documentación actualizada. |
| 8 | **Post Mortem** + **Explicación funcional del Sprint** (ver abajo). |

## Commits

Pequeños. Cada uno una sola idea. Deben contar una historia. Nunca mezclar
refactors con funcionalidades.

## Estilo de comunicación

Directo. Sin lenguaje motivacional. Sin complacer. Sin elogios sin argumentos.
Cada afirmación técnica respaldada por una razón. Si no hay evidencia
suficiente, decirlo explícitamente.

**Cuando el Principal Engineer no esté de acuerdo con el CTO:** explicarlo,
justificarlo, presentar evidencia y proponer alternativa — respetando siempre el
proceso de aprobación.

## Regla de oro

No optimices para impresionar a otros ingenieros. Optimiza para que un asesor
inmobiliario descubra una oportunidad que, sin Radar, habría perdido.

---

## Verificación final obligatoria

Antes de cerrar cualquier Sprint, generar **"Explicación funcional del Sprint"**:
sin código, sin clases, sin APIs. Explicado como si se le hablara a un asesor
inmobiliario. Debe responder:

1. ¿Qué problema resuelve este Sprint?
2. ¿Qué ocurría antes?
3. ¿Qué ocurre ahora?
4. ¿Qué cambia para el asesor?
5. ¿Qué cambia para el sistema?
6. ¿Qué información entra?
7. ¿Qué decisiones toma Radar?
8. ¿Qué información sale?
9. ¿Qué beneficio práctico obtiene el asesor?
10. ¿Qué limitaciones siguen existiendo?
11. ¿Qué prepara este Sprint para el siguiente?
12. El flujo completo, paso a paso, con un caso real — desde que aparece un
    mensaje en un grupo hasta que el asesor recibe una recomendación.

Cerrar siempre con el diagrama del flujo:

```
Mensaje en grupo
        │
        ▼
Captura
        │
        ▼
Procesamiento local (EPE)
        │
        ▼
Clasificación IA
        │
        ▼
Matching con inventario
        │
        ▼
Generación de señales
        │
        ▼
Priorización
        │
        ▼
Digest / Dashboard
        │
        ▼
Acción del asesor
```

---

# Apéndice — Visión AI Native de Radar

*Agregado por el CTO el 2026-08-02.*

> **Este apéndice no cambia nada de lo aprobado.** No cambia la arquitectura, ni
> los Sprints, ni los principios congelados, ni el roadmap, ni el MVP, ni las
> prioridades actuales. Define únicamente hacia dónde debe evolucionar Radar en
> los próximos años.

## La visión

Radar no quiere ser otra herramienta que usa IA. Quiere ser **un sistema que
acumula experiencia**. Una IA responde preguntas; un sistema con experiencia
toma mejores decisiones con el paso del tiempo.

El objetivo no es tener el modelo más inteligente. Es tener **el producto que
más aprende**.

## Definición de AI Native

Radar será AI Native cuando **el conocimiento adquirido durante su operación
tenga más valor que el software mismo**. Con los años, el activo principal
dejará de ser el código y pasará a ser la experiencia acumulada.

No buscamos entrenar modelos: buscamos construir memoria. No buscamos
automatizar decisiones: buscamos comprender cómo deciden los mejores asesores.

## El principio más importante

Todo mensaje, toda señal, toda decisión y todo resultado generan información.
**Nada de eso debe perderse.** Cada interacción debe convertirse en conocimiento
para el sistema.

## Automatizar ≠ aprender

Automatizar es hacer una tarea sin intervención humana. Aprender es mejorar la
siguiente decisión gracias a la experiencia anterior. **Radar debe evolucionar
hacia el aprendizaje, no solo hacia la automatización.**

## El Learning Engine

Capa conceptual. **No es un Sprint. No es un módulo a construir ahora. No debe
implementarse durante el MVP.**

```
Mensajes → Radar → Señales → Acciones del asesor → Resultados
                                                        │
                                                        ▼
                                                 Learning Engine
                                                        │
                                                        ▼
                                                  Conocimiento
                                                        │
                                                        ▼
                                                  Radar mejora
```

**Responsabilidad:** el Learning Engine nunca toma decisiones, nunca reemplaza
al asesor y nunca modifica el comportamiento del sistema por sí mismo. Solo
observa, registra, relaciona y aprende.

## Qué debe aprender Radar

Qué señales terminan en conversaciones · qué conversaciones en visitas · qué
visitas en cierres · qué clientes convierten mejor · qué colegas generan
oportunidades reales · qué propiedades generan interés · qué barrios convierten
· qué horarios rinden · qué argumentos usan los que más venden · qué seguimiento
aumenta el cierre · qué señales suelen ignorarse · qué decisiones producen malos
resultados.

**Radar no aprenderá reglas. Aprenderá experiencia.**

### Del asesor

Cada asesor trabaja distinto y Radar no debe volverlos iguales: debe aprender el
estilo de cada uno. **Cada asesor tendrá un Radar diferente — no porque cambie
el software, sino porque cambia la experiencia acumulada.**

### Del equipo

Solo conocimiento estadístico anonimizado. **Nunca** conversaciones, teléfonos,
nombres ni mensajes.

- Permitido: *"las oportunidades con estas características terminan en negocio
  un 37% más que el promedio."*
- Prohibido: *"Juan cerró esta venta."*

## Las cinco reglas del aprendizaje

1. **Radar nunca aprende de opiniones, solo de resultados.** La realidad tiene
   prioridad sobre las hipótesis.
2. **El asesor siempre tiene la última palabra.** Si Radar recomienda A y el
   asesor hace B, Radar no corrige: observa y aprende.
3. **Todo aprendizaje debe ser explicable.** Nunca *"porque el modelo lo
   decidió"*. Si no puede explicarlo, no debe modificar su comportamiento.
4. **El conocimiento pertenece al producto, no al modelo.** Los modelos,
   proveedores y tecnologías cambiarán; la experiencia acumulada permanece.
5. **No entrenar modelos prematuramente.** Requiere: suficientes asesores
   activos, suficientes decisiones reales, suficientes resultados medibles,
   evidencia de patrones repetibles y una métrica concreta a mejorar. Si falta
   una sola, no entrenar.

## Evolución por etapas

Radar evoluciona solo cuando existe evidencia:

`observa → registra → mide → encuentra patrones → recomienda → personaliza →
predice → optimiza`

La última etapa cubre **únicamente lo que sea seguro optimizar**. Nunca
decisiones críticas del negocio.

## Regla de oro del apéndice

Nunca construiremos una funcionalidad porque la IA pueda hacerla. Solo cuando
aumente la capacidad del asesor de vender más, ahorrar tiempo o decidir mejor.
**La IA es un medio, nunca el objetivo.**

## La pregunta adicional de cada Sprint

> **¿Lo que estamos construyendo hoy deja a Radar mejor preparado para aprender
> mañana?**

Si es sí, explicar de qué manera. Si es no, **no forzar una integración con
IA**. No todo Sprint debe aportar al aprendizaje — pero **ninguno debe
impedirlo**.

## La prueba de los cinco años

Si mañana desaparecieran todos los proveedores de IA, ¿qué quedaría?

- Respuesta incorrecta: *"nos quedamos sin producto"* → construimos un
  integrador de modelos, no una empresa.
- Respuesta correcta: *"perdimos una herramienta, pero conservamos años de
  experiencia comercial acumulada."*

Cualquier competidor puede comprar acceso a un modelo. **Lo que no puede comprar
son millones de decisiones reales acumuladas.** Ese conocimiento se protege con
la misma prioridad que hoy protegemos el número de WhatsApp del asesor.

## Lema del proyecto

> *"No estamos construyendo el mejor software para leer grupos de WhatsApp.
> Estamos construyendo el primer sistema que aprende, junto con los asesores
> inmobiliarios, cómo vender mejor cada día."*
