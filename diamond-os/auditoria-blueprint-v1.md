# Auditoría adversarial — Diamond OS Blueprint V1

**Estado:** BORRADOR
**Rol asumido:** Product Board (CTO de Salesforce, CPO de HubSpot, arquitecto
de Amazon, Director de Producto PropTech, consultor McKinsey de
transformación digital). Mandato: demostrar que el
[Blueprint V1](DIAMOND-OS-BLUEPRINT-V1.md) está equivocado, no mejorarlo.

Se analiza únicamente el modelo. No se proponen funcionalidades, pantallas,
IA, prompts, agentes ni implementación. Cada hallazgo responde: **¿qué
riesgo estamos ignorando?** Solo se incluyen hallazgos que cambiarían una
decisión de arquitectura.

---

## Hallazgos estructurales

### H1 — Un dominio entero del propio Modelo Operacional desapareció sin explicación
**Responde:** Q1, Q6, Q12, Q13
**Riesgo:** el Blueprint se declara construido "exclusivamente" a partir de
sus fuentes, pero el área 6 del programa original —Servicio al Cliente y
Postventa— no tiene capacidad, ni dominio, ni actor dueño en el mapa final.
Sus decisiones (por qué canal llega un reclamo, por qué se va un
propietario, qué reclamos se repiten) no están representadas en ninguna
parte.
**Impacto:** alto. Es, según el propio Modelo Operacional, lo que define la
retención del activo real del negocio (el propietario administrado).
**Probabilidad:** certeza — es una omisión verificable, no una hipótesis.
**Evidencia dentro del Blueprint:** §2 lista 16 capacidades en 7 dominios;
ninguna se llama "servicio" ni "postventa" ni "retención". "Caso" (§5)
absorbe PQR como subtipo de objeto, pero ningún dominio tiene la
responsabilidad de atender, enrutar o medir ese flujo.
**Recomendación:** o se declara explícitamente que Servicio al Cliente queda
fuera de V1 por decisión consciente (como se hizo con Legal en §7.5), o se
reconoce como capacidad faltante. Lo que no es aceptable es que haya
desaparecido sin dejar rastro de la decisión.

---

### H2 — Captación de Propietarios y Gestión de Relaciones son el mismo patrón, duplicado en dos dominios
**Responde:** Q2, Q3
**Riesgo:** ambas capacidades hacen lo mismo en abstracto —mover a una
Persona a través de etapas hasta un Acuerdo, con las mismas fuerzas de
decisión (perseguir/descartar, priorizar, negociar)— pero viven en dominios
distintos (Inventario vs. Relación Comercial), con lógica de pipeline
separada y ningún objeto compartido explícito.
**Impacto:** medio-alto. Construir dos motores de pipeline en paralelo
duplica esfuerzo de implementación y, peor, duplica el criterio de
priorización: nada garantiza que "perseguir a un propietario" y "priorizar
a un comprador" usen el mismo concepto de urgencia o el mismo objeto
Oportunidad.
**Probabilidad:** alta si se implementa tal como está descrito.
**Evidencia dentro del Blueprint:** §2.3 y §2.9 comparten estructura de
decisión casi idéntica; el objeto **Oportunidad** en §5 se define solo para
demanda ("desde que entra calificado hasta que cierra"), dejando a
Captación sin objeto de pipeline propio ni compartido.
**Recomendación:** el modelo debería tratar "captación" como un tipo de
Oportunidad (de oferta) simétrico al de demanda, no como una capacidad
aparte con su propia lógica.

---

### H3 — Gestión Documental está mal ubicada: es núcleo de plataforma disfrazado de capacidad de dominio
**Responde:** Q1, Q4
**Riesgo:** el propio Blueprint dice que Gestión Documental la usan
Captación de Propietarios, Cierre y Transacciones, Administración de
Activos y Legal — cuatro dominios distintos. Un dominio con responsabilidad
única no puede ser, al mismo tiempo, consumido transversalmente por otros
tres. Eso es la definición de infraestructura compartida, no de dominio de
negocio.
**Impacto:** medio. Si se construye dentro de "Transacción", cualquier
cambio en cómo Administración de Activos archiva un soporte de pago
requeriría tocar un dominio que, conceptualmente, no le pertenece.
**Probabilidad:** alta — la tabla de dependencias del propio §2.12 ya lo
demuestra.
**Evidencia dentro del Blueprint:** §2.12, campo "Otros dominios que la
usan": cuatro dominios distintos.
**Recomendación:** mover Gestión Documental al Dominio I (Núcleo de
Plataforma), junto a Identidad y Registro de Eventos.

---

### H4 — "Centro de Decisiones" no es un dominio: es una vista con dependencia total
**Responde:** Q1, Q9
**Riesgo:** el propio Blueprint admite que este dominio "consume de todos,
no alimenta a otros" y que "depende por completo de que los demás dominios
generen eventos limpios primero". Un dominio con responsabilidad única
existe porque tiene una razón propia para cambiar; este cambia cada vez que
cambia cualquiera de los otros seis. Llamarlo "dominio" oculta que en
realidad es un punto de acoplamiento total del sistema.
**Impacto:** alto a escala. Cualquier evolución de esquema en Inventario,
Demanda, Relación, Transacción, Activos o Financiera es, por definición, un
cambio potencialmente disruptivo para Gobierno. No hay contrato ni
versionado de eventos declarado.
**Probabilidad:** alta — es matemática, no hipótesis: fan-in de seis
dominios sin contrato es deuda garantizada.
**Evidencia dentro del Blueprint:** §2.16, "Dependencias: Registro de
Eventos + todos los dominios operativos".
**Recomendación:** no tratarlo como un séptimo dominio par de los otros
seis; tratarlo como una capacidad de lectura que se construye *al final* de
cada dominio maduro, no en paralelo, y definir un contrato de evento
explícito antes de construirlo.

---

### H5 — "Acuerdo" es un objeto polimórfico que fuerza cuatro regímenes legales distintos a compartir esquema
**Responde:** Q5, Q9, Q14, Q15
**Riesgo:** mandato de captación, contrato de arrendamiento, contrato de
administración y promesa de compraventa tienen ciclos de vida, obligaciones
regulatorias y partes interesadas completamente distintos. Modelarlos como
subtipos de un mismo objeto "Acuerdo" es el patrón clásico de tabla
polimórfica que acumula campos nulos y casos especiales.
**Impacto:** alto y compuesto en el tiempo. En Colombia, la normativa de
arrendamiento urbano y la de compraventa evolucionan de forma
independiente; una reforma a una no debería obligar a tocar el esquema de
la otra, y con este diseño sí lo haría.
**Probabilidad:** alta — es la clase de decisión que parece barata al
diseñar y cara cinco años después, exactamente lo que Q15 pregunta.
**Evidencia dentro del Blueprint:** §5, definición de "Acuerdo": "mandato de
captación, contrato de arrendamiento, contrato de administración, promesa
de compraventa" en un mismo objeto.
**Recomendación:** separar al menos en dos familias con ciclo de vida
propio (vínculos de oferta: mandato/administración; vínculos de cierre:
promesa/contrato de arrendamiento), no un solo objeto con subtipo.

---

### H6 — "Caso" mezcla mantenimiento, PQR y legal sin distinguir requisitos de retención
**Responde:** Q5, Q15
**Riesgo:** una reparación de una gotera y un proceso de restitución de
inmueble no tienen el mismo requisito de confidencialidad, retención ni
acceso. Un mismo objeto para ambos obliga, más adelante, a separar
retroactivamente datos operativos de datos con privilegio legal — una
migración de alto riesgo una vez hay historial real encima.
**Impacto:** medio-alto, se paga en el futuro, no ahora.
**Probabilidad:** media — solo se materializa si Legal y Cumplimiento se
activa (hoy diferido según §7.5), pero el objeto ya está definido para
absorberlo sin separación.
**Evidencia dentro del Blueprint:** §5, "Caso": "una reparación, un reclamo
(PQR), un asunto legal" en un mismo objeto.
**Recomendación:** si Legal se activa alguna vez, debe tener su propio
objeto desde el día uno, no heredar el de mantenimiento.

---

### H7 — Dos decisiones de máximo riesgo fiduciario no tienen objeto que las respalde: Comisión y Garantía
**Responde:** Q6, Q12, Q13
**Riesgo:** el Modelo Operacional identifica explícitamente "cómo se
reparte la comisión y genera eso conflictos internos" (Asesor) y "fijar o
ajustar comisiones" (Gerente) como decisiones de alto riesgo. El Modelo de
Gobernanza clasifica "aprobar un candidato arrendatario" como **H** de alto
riesgo, apoyada en garantías (fiador, aseguradora, codeudor). Ninguno de los
dos —comisión ni garantía— tiene objeto propio en el núcleo del Blueprint;
quedan disueltos dentro de "Movimiento Financiero" y "Acuerdo"
respectivamente, sin trazabilidad propia.
**Impacto:** alto. Viola directamente P3 ("toda decisión importante
respaldada por evidencia") exactamente en las dos decisiones que el propio
Modelo de Gobernanza marcó como de mayor riesgo.
**Probabilidad:** certeza si se construye tal como está.
**Evidencia dentro del Blueprint:** §5 no lista Comisión ni Garantía entre
los 12 objetos de núcleo; §2.15 (Gestión Financiera) solo tiene "Movimiento
Financiero" como objeto genérico.
**Recomendación:** ambos deben ser objetos de primera clase, no atributos
sueltos, antes de construir cualquier capacidad que dependa de ellos.

---

### H8 — Proliferación de motores: al menos dos deberían fusionarse y uno es prematuro
**Responde:** Q7, Q8
**Riesgo:**
- **Motor de Sincronización + Motor de Eventos** son, estructuralmente, el
  mismo mecanismo: detectar un cambio y emitirlo como evento. Tratarlos como
  dos motores separados obliga a mantener dos sistemas de detección de
  diferencias en paralelo.
- **Motor Conversacional** no se sometió al mismo criterio de disciplina que
  el propio Blueprint aplicó a Orquestación de Actividades y Calificación y
  Ruteo (§6, nota de cierre): "decide qué tool ejecutar" es, en la propia
  lógica del documento, una instancia del Motor de Decisión sobre una
  Conversación — pero se le da estatus de motor independiente sin
  justificación distinta a la que se negó a las otras dos capacidades.
- **Motor Documental** se define antes de que exista una sola línea de
  Gestión Documental construida; es un motor especulativo.
**Impacto:** medio-alto — es exactamente la lista "Decision Engine, Workflow
Engine, Rules Engine, Notification Engine..." que un diseño disciplinado
debería evitar, y aun así aparecen inconsistencias en cuáles se fusionaron
y cuáles no.
**Probabilidad:** alta — la inconsistencia ya está en el texto, no es
hipotética.
**Evidencia dentro del Blueprint:** §6.1/§6.3 (motores paralelos), §6.4 vs.
la nota de cierre de §6 (aplicación inconsistente del criterio), §6.6
(motor sin capacidad construida encima).
**Recomendación:** fusionar Sincronización dentro de Eventos; someter Motor
Conversacional al mismo criterio que Orquestación/Calificación (no es un
motor aparte, es una aplicación del Motor de Decisión); no construir Motor
Documental hasta que exista Gestión Documental real que lo justifique.

---

### H9 — Todo el Blueprint está dimensionado para una organización enterprise, no para la que dice modelar
**Responde:** Q10, Q11
**Riesgo:** el documento diseña Coordinador Comercial con ruteo por
carga/desempeño, Legal y Cumplimiento con expediente propio, Centro de
Decisiones como dominio de analítica cruzada, y seis motores centrales —
para una operación que, según el propio repositorio del que se extrajo el
Blueprint, es "1 dev, sin admin en la máquina Windows, presupuesto de
infra ~5 USD/mes por servicio" y "1-3 asesores". Esto se lee como
arquitectura escrita para vender a un board, no para operar la inmobiliaria
real de la que parte el modelo.
**Impacto:** crítico. Es el riesgo más caro de todos: construir
infraestructura para una escala que no existe todavía, en vez de la
capacidad que resolvería el dolor real hoy.
**Probabilidad:** alta si el Blueprint se toma como plan de construcción
literal en vez de como mapa de referencia.
**Evidencia dentro del Blueprint:** §2.8 (Coordinador Comercial: "rol sin
soporte hoy"), §2.13 (Legal: expediente completo para volumen no
verificado), §2.16 (Centro de Decisiones: dominio entero para reporting).
**Recomendación:** este es precisamente el objeto del siguiente ejercicio
(ver documento de alcance comercial V1): el Blueprint es un mapa de
destino, no una lista de construcción. Ninguna versión comercial temprana
debería intentar completarlo.

---

### H10 — Gobernanza H/A/S está tratada como universal y fija, no configurable — riesgo a escala y en 5 años
**Responde:** Q14, Q15
**Riesgo:** el Motor de Decisión se describe como un único criterio
aplicado igual en todo el sistema. Pero inmobiliarias distintas tendrán
apetitos de riesgo distintos (una oficina conservadora vs. una agresiva), y
jurisdicciones distintas (si el producto sale de Colombia) tendrán líneas
rojas legales distintas. El documento no contempla que el propio criterio
de gobernanza —el activo diferenciador que motivó todo el programa— pueda
necesitar variar por tenant o por país.
**Impacto:** alto a cinco años. Si el criterio se vuelve configurable
después de construido como fijo, es una reescritura del núcleo, no una
extensión.
**Probabilidad:** media — se materializa solo si el producto escala fuera
de una sola inmobiliaria o de Colombia, pero el propio encargo original
habla explícitamente de "cientos de inmobiliarias" y de "Latinoamérica"
(subtítulo del programa).
**Evidencia dentro del Blueprint:** §6.2 no menciona configuración por
tenant; §0 fija las líneas rojas como principios (P8), no como parámetros.
**Recomendación:** no es un cambio para V1, pero debe quedar documentado
como decisión consciente de alcance, no como omisión.

---

### H11 — Identidad de Persona no resuelve aislamiento entre tenants
**Responde:** Q14, Q13
**Riesgo:** en un mercado compartido como Medellín, es plausible que la
misma persona sea lead de dos inmobiliarias distintas usando Diamond OS. El
Blueprint no dice si Persona es un objeto global o por tenant, ni cómo se
evita que la resolución de identidad entre canales filtre señal de una
inmobiliaria a otra.
**Impacto:** alto si ocurre — es un riesgo de confianza y potencialmente
legal (protección de datos), no solo técnico.
**Probabilidad:** baja con un solo tenant (hoy), alta si el producto crece
a "cientos de inmobiliarias" tal como el programa se llama a sí mismo.
**Evidencia dentro del Blueprint:** §5, "Persona" no especifica el límite
de tenant; §2.1 dice que Identidad y Tenancy "existe parcialmente" sin
resolver este punto.
**Recomendación:** decisión de diseño pendiente y explícitamente marcada
como bloqueante antes de aceptar un segundo tenant real.

---

### H12 — El precio del inmueble no tiene dueño único
**Responde:** Q13
**Riesgo:** §2.3 dice que Captación de Propietarios "recomienda el precio de
salida"; §2.4 dice que Catálogo de Inventario mantiene "una única ficha
viva". Cuando el precio necesita ajustarse (inmueble estancado, decisión
marcada como **A** en el propio Modelo de Gobernanza), no queda claro cuál
capacidad es la autoridad sobre el valor vigente.
**Impacto:** medio. Ambigüedad de dueño en el dato más consultado de todo
el sistema (todo dominio de Demanda depende de él).
**Probabilidad:** alta si se construye sin resolver esto primero.
**Evidencia dentro del Blueprint:** §2.3 y §2.4, ambos reclaman una relación
con el precio sin que el documento diga cuál manda.
**Recomendación:** Catálogo de Inventario debe ser la única fuente de
verdad del precio vigente; Captación de Propietarios solo propone, nunca
posee el campo.

---

## Resumen de riesgos por severidad

| # | Hallazgo | Riesgo | Impacto | Probabilidad |
|---|---|---|---|---|
| H1 | Servicio al Cliente desaparecido | Alto | Alto | Certeza |
| H9 | Diseño de escala enterprise sobre operación de 1 dev | Crítico | Crítico | Alta |
| H5 | "Acuerdo" polimórfico | Alto | Alto (compuesto) | Alta |
| H7 | Comisión y Garantía sin objeto propio | Alto | Alto | Certeza |
| H4 | "Centro de Decisiones" con fan-in total | Alto | Alto (a escala) | Alta |
| H3 | Gestión Documental mal ubicada | Medio | Medio | Alta |
| H2 | Captación de Propietarios duplica Gestión de Relaciones | Medio-alto | Medio-alto | Alta |
| H8 | Proliferación/inconsistencia de motores | Medio-alto | Medio-alto | Alta |
| H11 | Identidad sin aislamiento multi-tenant | Alto (latente) | Alto | Baja hoy / alta a escala |
| H10 | Gobernanza fija, no configurable | Alto (latente) | Alto a 5 años | Media |
| H6 | "Caso" mezcla mantenimiento/PQR/legal | Medio | Medio-alto (futuro) | Media |
| H12 | Precio sin dueño único | Medio | Medio | Alta |

---

## Veredicto

**Si fueras el CTO responsable... ¿aprobarías este Blueprint para construir
el producto?**

## SI, CON CAMBIOS

**Justificación:** la premisa central del Blueprint sobrevive al ataque —
modelar el negocio como decisiones clasificadas en H/A/S es una idea sólida
y, como estructura de razonamiento, no se cae ante ninguno de los doce
hallazgos. Lo que falla es la **traducción de esa idea a un mapa de
construcción**: el documento mezcla responsabilidades (H3, H4), duplica
lógica (H2), deja sin dueño exactamente los datos de mayor riesgo fiduciario
(H7), fuerza objetos a compartir esquema cuando sus ciclos de vida
divergen (H5, H6), y —el hallazgo más caro— está dimensionado para una
inmobiliaria que no es la que existe hoy (H9). Ningún inversionista serio
financiaría la construcción literal de las 16 capacidades, 7 dominios y 6
motores tal como están descritos; eso sería construir un ERP inmobiliario
completo antes de vender la primera suscripción. El modelo es correcto
como **mapa de referencia** (para eso se diseñó, según su propio §9); es
peligroso como **plan de construcción**. De ahí que la aprobación sea
condicionada: se aprueba el modelo, no el orden ni el alcance de
construcción — que es exactamente lo que se resuelve a continuación.
