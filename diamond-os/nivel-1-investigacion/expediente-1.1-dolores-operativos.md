# Expediente 1.1 — Plan maestro de investigación: dolores operativos de las inmobiliarias colombianas

**Estado:** EN REVISIÓN
**Nivel:** 1 — Investigación
**Naturaleza:** documento de planificación. Este expediente NO contiene
resultados de investigación; define qué se investigará, cómo, en qué orden
y con qué criterios de cierre. Ningún expediente hijo arranca sin que este
plan esté `APROBADO`.

**Regla de oro heredada del programa:** no se diseña ninguna solución hasta
demostrar con evidencia que el problema existe y tiene impacto. Los
expedientes de este nivel describen mercado y problema, nunca soluciones.

**Enfoque:** el Nivel 1 no produce "listas de dolores" ya interpretadas.
Produce **observaciones basadas en evidencia** (hecho observado + fuente +
impacto estimado). Calificar una observación como "dolor", medir su
severidad y priorizarla se difiere al **Expediente 1.10**. Esto evita el
sesgo de confirmación (buscar solo lo que justifique una solución ya
imaginada) y mantiene cada expediente honesto y acotado.

**Objetivo de fondo:** no solo entender cómo funciona una inmobiliaria, sino
dejar registrado —con evidencia— dónde un sistema operativo inteligente
podría aportar ventaja competitiva. Por eso cada expediente documenta
explícitamente las **decisiones del actor** y abre una sección de
**Observaciones para IA**. Ambas cosas se registran, no se resuelven: el
diseño de soluciones es de niveles posteriores.

---

## 1. Áreas a investigar

La operación de una inmobiliaria colombiana típica (pequeña y mediana, 2 a
30 personas, mezcla de venta y arriendo) se descompone en ocho áreas.
Siete son verticales de operación; la octava es transversal.

1. **Captación de inventario** — conseguir propiedades para vender o arrendar.
2. **Marketing y generación de demanda** — atraer compradores y arrendatarios.
3. **Ventas** — gestionar interesados de compra hasta el cierre.
4. **Arrendamientos (colocación)** — desde el interesado hasta el contrato firmado.
5. **Administración de inmuebles y back-office financiero** — recaudo, pagos a propietarios, renovaciones, reparaciones, contabilidad.
6. **Servicio al cliente y postventa** — atención a propietarios, arrendatarios y compradores después del cierre.
7. **Gerencia, datos y toma de decisiones** — cómo el dueño/gerente ve y dirige el negocio.
8. **Legal y cumplimiento (transversal)** — contratos, normativa de arrendamiento, protección de datos, requisitos habilitantes.

---

## 2. Instrumentos metodológicos comunes

Estos cuatro instrumentos se aplican igual en todos los expedientes 1.2–1.9.
Se definen una sola vez aquí para no repetirlos.

### 2.1 Observación basada en evidencia (unidad de registro)

La unidad de trabajo del Nivel 1 no es "un dolor", es **una observación**.
Cada observación tiene:

- **Hecho observado:** qué ocurre, descrito de forma neutra (sin adjetivar como bueno o malo).
- **Evidencia:** cita de entrevista, documento, dato numérico o captura que lo respalda.
- **Plantilla de impacto** (ver 2.2).

No se escribe la palabra "dolor", "problema" ni "oportunidad" en los
expedientes de área: se registra el hecho y su evidencia. La interpretación
ocurre en 1.10.

### 2.2 Plantilla estándar de impacto

Toda observación se acompaña de estos cuatro campos. Se admiten estimaciones,
pero se marcan como tales (dato medido vs. estimado).

| Campo | Qué registrar |
|---|---|
| **Frecuencia** | Cuántas veces ocurre (por día / semana / mes, o por transacción). |
| **Tiempo perdido** | Minutos u horas-persona por ocurrencia, y agregado al periodo. |
| **Impacto económico aproximado** | Costo directo, ingreso en riesgo o dinero inmovilizado; estimado y declarado como estimación. |
| **Usuarios afectados** | Qué actores lo sufren y cuántos (ej.: "los 3 asesores", "todos los propietarios administrados"). |

Una observación sin al menos frecuencia y usuarios afectados no se acepta
como cerrada; el tiempo y el impacto económico pueden quedar como "no
estimable aún" si se justifica.

### 2.3 Decisiones del actor

En cada área se documenta **qué decisiones toma el actor**, porque las
decisiones —especialmente las repetitivas y basadas en reglas— son el
insumo directo para detectar dónde un sistema inteligente podría asistir.
Por cada decisión relevante se anota: quién decide, con qué información,
bajo qué criterio (explícito o intuitivo), con qué frecuencia y qué pasa si
se decide mal. No se propone automatizarla; solo se registra.

### 2.4 Observaciones para IA (registro, no diseño)

Sección obligatoria de cada expediente. Registra —sin diseñar solución—
candidatos donde una capacidad inteligente *podría* aportar más adelante:

- Tareas repetitivas y mecánicas (re-digitar, copiar entre sistemas, rearmar el mismo reporte).
- Decisiones basadas en reglas o en patrones repetibles.
- Puntos donde se espera por una decisión o respuesta humana.
- Información que existe pero no se aprovecha (queda en un chat, un correo, la cabeza de alguien).

Regla dura: aquí se **nombra el candidato y su evidencia**, nunca la
solución. Prohibido escribir "se podría hacer un bot/modelo/módulo que…".
Esta sección alimenta los Niveles 2 y 3; no es una conclusión del Nivel 1.

### 2.5 Journey maps

El programa construye **cinco journey maps**, uno por actor principal:
**propietario, comprador, arrendatario, asesor y gerente**. Cada journey
map recorre las etapas del actor de punta a punta y en cada etapa registra:
qué hace, qué necesita, con qué puntos de contacto de la inmobiliaria
interactúa, y dónde hay fricción evidenciada (con su plantilla de impacto).

Como cada actor atraviesa varias áreas, **cada expediente construye solo el
fragmento** del journey que pasa por su área; el **Expediente 1.10 ensambla
los cinco journeys completos**. Reparto de fragmentos:

| Actor | Expedientes que aportan fragmento |
|---|---|
| Propietario | 1.2 (captación), 1.6 (administración), 1.7 (servicio) |
| Comprador | 1.3 (marketing), 1.4 (ventas) |
| Arrendatario | 1.3 (marketing), 1.5 (arriendo), 1.6 (pago de canon), 1.7 (servicio) |
| Asesor | 1.2, 1.3, 1.4, 1.5 (es actor operante en casi todas) |
| Gerente | 1.8 (gerencia), con toques en todas las demás |

---

## 3. Diseño de investigación por área

Cada área se investiga respondiendo seis frentes: por qué vale la pena, qué
preguntas responder, qué evidencia reunir, **qué decisiones toma el actor**,
qué actores entrevistar y qué documentos revisar. Los instrumentos de la
sección 2 (impacto, IA, journey) aplican a todas.

### 3.1 Captación de inventario

- **Por qué vale la pena:** sin inventario no hay negocio; es la queja más
  frecuente de los gerentes y donde más se compite. Si el dolor dominante
  está aquí, el resto del programa cambia de prioridad.
- **Preguntas:**
  - ¿Cómo consiguen propiedades hoy (referidos, avisos, llamadas en frío, alianzas)?
  - ¿Cuánto cuesta (tiempo y dinero) captar una propiedad vendible/arrendable?
  - ¿Qué porcentaje del inventario es exclusivo vs. compartido, y qué implica cada modalidad?
  - ¿Dónde se pierde el proceso: contacto, avalúo/precio, documentación, firma del encargo?
  - ¿Qué información del inmueble se recolecta, en qué formato, y cuántas veces se re-digita?
- **Evidencia:** proceso real paso a paso (no el ideal), tiempos por etapa,
  conversión propietario contactado → encargo firmado, ejemplos de fichas.
- **Decisiones del actor:** el captador decide a qué propietario perseguir,
  qué precio recomendar, si aceptar o no un inmueble, en qué modalidad. El
  gerente decide qué zonas o segmentos priorizar.
- **Actores:** gerente/dueño, captador senior, captador junior, propietario
  que entregó un inmueble recientemente.
- **Documentos:** encargo/consignación, ficha de captación, checklist de
  documentos del inmueble, planilla o sistema de inventario.

### 3.2 Marketing y generación de demanda

- **Por qué:** es donde más dinero se gasta con menos medición; los dolores
  son invisibles para el gerente (gasto sin atribución).
- **Preguntas:**
  - ¿En qué canales publican y qué cuesta cada uno?
  - ¿Quién produce fotos, videos y textos, y cuánto tarda un inmueble en estar publicado?
  - ¿Saben de qué canal viene cada lead? ¿Cómo lo miden, si lo miden?
  - ¿Qué pasa con un inmueble 60+ días publicado sin interesados?
  - ¿Duplican trabajo publicando el mismo inmueble en varios portales a mano?
- **Evidencia:** presupuesto mensual real de pauta y portales, tiempos de
  publicación, ejemplos de publicaciones, reportes que reciba el gerente (o
  su ausencia).
- **Decisiones del actor:** quién decide dónde publicar, cuánto invertir en
  cada canal, cuándo bajar o repautar un inmueble, qué precio anunciar.
- **Actores:** gerente, encargado de publicaciones (asistente o el mismo
  asesor), agencia o freelance de pauta si existe.
- **Documentos:** facturas de portales y pauta, calendario de publicaciones,
  reportes de agencias, capturas de los dashboards que usen.

### 3.3 Ventas

- **Por qué:** mayor ticket y ciclo más largo; los dolores aquí (leads sin
  seguimiento, negocios caídos por trámites) tienen el mayor impacto unitario.
- **Preguntas:**
  - ¿Qué pasa con un lead desde que escribe hasta la primera visita? ¿Tiempos reales?
  - ¿Cuántos leads atiende un asesor y cuántos se pierden por falta de seguimiento?
  - ¿Cómo se coordinan las visitas y qué porcentaje se cae (no-show)?
  - ¿Dónde se demoran o mueren los cierres: crédito, estudio de títulos, promesa, escrituración?
  - ¿Cómo se reparte la comisión y genera eso conflictos internos?
- **Evidencia:** embudo real con números (leads → visitas → ofertas →
  cierres), duración del ciclo, motivos de caída de los últimos 6–12 meses,
  cómo registran el pipeline (o su ausencia).
- **Decisiones del actor:** el asesor decide a qué lead priorizar, cuándo y
  cómo hacer seguimiento, qué oferta recomendar aceptar; el gerente decide
  asignación de leads y estructura de comisiones.
- **Actores:** asesor con trayectoria, gerente comercial, comprador reciente,
  aliado de crédito (banco/broker) si es accesible.
- **Documentos:** planilla o CRM de seguimiento, formato de oferta/promesa,
  checklist de cierre, actas de reuniones comerciales.

### 3.4 Arrendamientos (colocación)

- **Por qué:** es el volumen de la operación (más transacciones, menor ticket)
  y el proceso con más pasos administrativos por unidad; los cuellos de
  botella se repiten decenas de veces al mes.
- **Preguntas:**
  - ¿Cuánto tarda un inmueble en arrendarse desde su publicación y dónde se pierde tiempo?
  - ¿Cómo funciona el estudio del arrendatario (aseguradora, codeudor, fiador) y cuánto demora?
  - ¿Cuántos candidatos se caen por estudio negado y qué se hace con ellos?
  - ¿Cómo se hace el inventario de entrega y qué conflictos genera?
  - ¿Qué papel juegan afianzadoras/aseguradoras y qué fricción agregan?
- **Evidencia:** tiempos por etapa (publicación → visita → estudio → contrato
  → entrega), tasa de aprobación de estudios, expedientes de un arriendo completo.
- **Decisiones del actor:** el coordinador decide a qué candidato tramitar
  primero, si aceptar un perfil dudoso, con qué afianzadora trabajar; el
  asesor decide cómo agendar visitas.
- **Actores:** coordinador de arriendos, asistente que tramita estudios,
  arrendatario reciente, contacto en afianzadora si es accesible.
- **Documentos:** contrato de arrendamiento tipo, solicitud del arrendatario,
  inventario de entrega, correos/chats de un trámite real.

### 3.5 Administración de inmuebles y back-office financiero

- **Por qué:** es el ingreso recurrente que sostiene a la mayoría de
  inmobiliarias medianas y el área con más trabajo manual repetitivo
  (recaudo, pagos, conciliación). Hipótesis: aquí vive el dolor más crónico
  aunque menos declarado.
- **Preguntas:**
  - ¿Cómo se recauda el canon, cuánta cartera vencida hay y cómo se cobra?
  - ¿Cómo y cuándo se paga a los propietarios? ¿Cuánto manual implica cada corte?
  - ¿Cómo se gestionan reparaciones: quién recibe, quién autoriza, quién paga?
  - ¿Cómo se manejan renovaciones e incrementos anuales de canon?
  - ¿Con qué herramientas llevan la contabilidad del negocio y la de los inmuebles?
- **Evidencia:** número de inmuebles administrados, días-persona por corte
  mensual, % de cartera vencida, volumen mensual de reparaciones, herramientas
  usadas (software, Excel, papel).
- **Decisiones del actor:** el auxiliar decide el orden de recaudo y de pagos;
  alguien autoriza (o no) cada reparación y su monto; el gerente decide
  incrementos y a quién cobrar cartera. Muchas son decisiones por regla.
- **Actores:** auxiliar administrativo/contable, contador, gerente,
  propietario que recibe pagos, arrendatario que pidió una reparación.
- **Documentos:** liquidación/extracto de propietario, planillas de recaudo,
  contrato de administración, flujo de aprobación de reparaciones.

### 3.6 Servicio al cliente y postventa

- **Por qué:** define retención de propietarios (el activo real) y reputación;
  suele ser el área sin dueño claro dentro de la inmobiliaria.
- **Preguntas:**
  - ¿Por qué canales llegan las solicitudes (WhatsApp personal, fijo, correo) y quién atiende?
  - ¿Se pierde algo entre canales? ¿Hay registro o vive en el teléfono de cada quien?
  - ¿Por qué se van los propietarios que retiran sus inmuebles?
  - ¿Qué reclamos se repiten más y cuánto tardan en resolverse?
- **Evidencia:** volumen aproximado de interacciones por canal, casos reales
  de solicitudes perdidas o demoradas, tasa de retiro anual de propietarios
  y motivos declarados.
- **Decisiones del actor:** quién atiende decide qué solicitud es urgente, a
  quién escalar, qué responder; el gerente decide cómo retener a un propietario
  molesto.
- **Actores:** quien contesta teléfono/WhatsApp principal, gerente,
  propietario que se retiró, propietario antiguo satisfecho.
- **Documentos:** registro de PQRs si existe, chats ejemplares (anonimizados),
  encuestas si alguna vez se hicieron.

### 3.7 Gerencia, datos y toma de decisiones

- **Por qué:** determina si el negocio se dirige con información o con
  intuición; si el gerente no ve su operación, no puede priorizar la mejora
  de las demás áreas.
- **Preguntas:**
  - ¿Qué números revisa, con qué frecuencia y de dónde salen?
  - ¿Cuánto tarda en saber cuánto vendió/arrendó/recaudó el mes pasado?
  - ¿Cómo mide el desempeño de los asesores y calcula comisiones?
  - ¿Qué decisiones recientes tomó "a ciegas" y le costaron dinero?
  - ¿Qué software compró, cuál abandonó y por qué?
- **Evidencia:** los reportes reales que usa (o constatar que no existen),
  historial de herramientas adoptadas y abandonadas, tiempo que dedica a
  armar información vs. a decidir.
- **Decisiones del actor:** el gerente decide precios, inversión en marketing,
  contratación y salida de asesores, en qué zonas crecer, qué software pagar
  — casi siempre con información incompleta.
- **Actores:** dueño/gerente (actor principal), contador, socio si lo hay.
- **Documentos:** reportes gerenciales existentes, planillas de comisiones,
  facturas de software contratado y cancelado.

### 3.8 Legal y cumplimiento (transversal)

- **Por qué:** la normativa de arrendamiento, la protección de datos y los
  requisitos habilitantes atraviesan todas las áreas; un dolor legal mal
  entendido invalida conclusiones de las demás.
- **Preguntas:**
  - ¿Qué obligaciones normativas perciben como carga operativa?
  - ¿Qué conflictos legales recurrentes enfrentan (incumplimientos, restituciones, siniestros)?
  - ¿Cómo manejan los datos personales de clientes y candidatos?
  - ¿Qué tanto varía la práctica entre ciudades?
- **Evidencia:** casos reales de conflictos y su costo, prácticas actuales de
  manejo documental y de datos.
- **Decisiones del actor:** quién decide cuándo iniciar una restitución, cómo
  redactar una cláusula, qué documentos exigir; muchas se toman consultando
  a un abogado externo caso a caso.
- **Actores:** abogado que asesore inmobiliarias, gerente, gremio local (lonja)
  si es accesible.
- **Documentos:** contratos tipo en uso, políticas de datos si existen,
  requerimientos recibidos de autoridades o gremios.

---

## 4. División en expedientes

Cada expediente es independiente: puede ejecutarse, revisarse y aprobarse
solo, en cualquier orden dentro de su fase. El orden sugerido prioriza las
áreas con mayor impacto hipotético y deja la síntesis para el final.

| Expediente | Área | Fase |
|---|---|---|
| 1.2 | Captación de inventario | A |
| 1.3 | Marketing y generación de demanda | A |
| 1.4 | Ventas | A |
| 1.5 | Arrendamientos (colocación) | B |
| 1.6 | Administración de inmuebles y back-office | B |
| 1.7 | Servicio al cliente y postventa | C |
| 1.8 | Gerencia, datos y decisiones | C |
| 1.9 | Legal y cumplimiento | C |
| 1.10 | Síntesis: journeys, mapa priorizado y candidatos de IA | Cierre |

---

## 5. Ficha de cada expediente

Plantilla común — los campos marcados con (*) se repiten idénticos en
1.2–1.9 y se detallan una sola vez aquí:

- **Entradas (*):** este plan (1.1) aprobado + los expedientes ya `APROBADO`
  de fases anteriores (solo para no repetir preguntas ya respondidas, no como
  fuente de conclusiones).
- **Entregables (*):** un documento por expediente con:
  1. Proceso actual descrito paso a paso, evidenciado.
  2. **Fragmento(s) de journey map** del/los actor(es) del área (ver 2.5).
  3. **Decisiones del actor** identificadas (ver 2.3).
  4. **Observaciones basadas en evidencia**, cada una con su **plantilla de impacto** (ver 2.1 y 2.2). Sin calificarlas ni priorizarlas.
  5. **Observaciones para IA** (ver 2.4): candidatos registrados, sin diseñar solución.
  6. Preguntas que quedaron abiertas.
  Sin soluciones, sin benchmark, sin priorización.
- **Criterios de aceptación (*):**
  - Cada observación lleva evidencia concreta y plantilla de impacto (al menos frecuencia y usuarios afectados; lo demás puede quedar "no estimable aún" justificado).
  - El fragmento de journey del área está construido.
  - Las decisiones del actor están documentadas con quién/con qué información/bajo qué criterio.
  - La sección Observaciones para IA registra candidatos **sin proponer soluciones**.
  - Ninguna sección califica, cuantifica como "dolor" ni prioriza (eso es 1.10).
  - Las preguntas del plan quedan respondidas o marcadas como abiertas.
  - El documento se sostiene leído de forma aislada.

### Expediente 1.2 — Captación de inventario
- **Objetivo:** mapear el proceso real de captación, las decisiones del captador y observaciones con impacto; aportar el fragmento de journey de propietario (etapa entrega) y de asesor.
- **Alcance:** desde la búsqueda del propietario hasta el encargo firmado e inmueble documentado.
- **Fuera del alcance:** publicación y marketing (1.3), avalúos como disciplina técnica, captación de compradores, priorización.
- **Tiempo estimado:** 2–3 sesiones.
- **Complejidad:** media.

### Expediente 1.3 — Marketing y generación de demanda
- **Objetivo:** mapear canales, costos, tiempos de publicación y capacidad real de atribución; fragmento de journey de comprador y arrendatario (etapa descubrimiento) y de asesor (publicación).
- **Alcance:** desde el inmueble captado hasta el lead que escribe o llama.
- **Fuera del alcance:** atención del lead (1.4/1.5), estrategia de marca, contenido orgánico como disciplina, priorización.
- **Tiempo estimado:** 2 sesiones.
- **Complejidad:** media.

### Expediente 1.4 — Ventas
- **Objetivo:** reconstruir el embudo de venta con números, las decisiones del asesor y dónde mueren los negocios; fragmento de journey de comprador (contacto → cierre) y de asesor (venta).
- **Alcance:** desde el lead de compra hasta la escritura y el pago de comisión.
- **Fuera del alcance:** generación del lead (1.3), arriendos (1.5), crédito hipotecario salvo por su efecto en tiempos, priorización.
- **Tiempo estimado:** 3 sesiones (ciclo largo, exige reconstruir casos históricos).
- **Complejidad:** alta.

### Expediente 1.5 — Arrendamientos (colocación)
- **Objetivo:** medir tiempos y fricciones del ciclo publicación → contrato → entrega y el rol de afianzadoras; fragmento de journey de arrendatario (contacto → entrega) y de asesor (arriendo).
- **Alcance:** desde el lead de arriendo hasta el inmueble entregado con inventario.
- **Fuera del alcance:** recaudo y administración posterior (1.6), disputas legales de fondo (1.9), priorización.
- **Tiempo estimado:** 2–3 sesiones.
- **Complejidad:** media.

### Expediente 1.6 — Administración de inmuebles y back-office
- **Objetivo:** cuantificar el trabajo manual del ciclo mensual y las decisiones por regla del back-office; fragmento de journey de propietario (recibir pagos) y arrendatario (pagar canon, pedir reparación).
- **Alcance:** desde el contrato firmado hasta la terminación o renovación; contabilidad operativa asociada.
- **Fuera del alcance:** colocación (1.5), contabilidad tributaria del negocio, propiedad horizontal (copropiedades), priorización.
- **Tiempo estimado:** 3 sesiones (área con más subprocesos).
- **Complejidad:** alta.

### Expediente 1.7 — Servicio al cliente y postventa
- **Objetivo:** mapear canales de atención, puntos de pérdida de solicitudes y causas de fuga de propietarios; fragmento de journey de propietario (postventa) y arrendatario (postventa).
- **Alcance:** toda interacción posterior al cierre (venta) o a la entrega (arriendo), más la atención general multicanal.
- **Fuera del alcance:** atención comercial pre-cierre (1.4/1.5), reparaciones como proceso financiero (1.6), priorización.
- **Tiempo estimado:** 1–2 sesiones.
- **Complejidad:** baja.

### Expediente 1.8 — Gerencia, datos y decisiones
- **Objetivo:** entender con qué información dirige el gerente, qué decisiones toma a ciegas y qué herramientas adoptó y abandonó; construir el fragmento troncal del journey de gerente.
- **Alcance:** reporting, comisiones, desempeño de asesores, historial de software.
- **Fuera del alcance:** los procesos operativos que generan los datos (1.2–1.7), finanzas personales del dueño, priorización.
- **Tiempo estimado:** 1–2 sesiones.
- **Complejidad:** baja-media.

### Expediente 1.9 — Legal y cumplimiento
- **Objetivo:** inventariar las cargas normativas y conflictos legales recurrentes vividos como carga operativa, con sus decisiones asociadas.
- **Alcance:** normativa de arrendamiento, requisitos habilitantes, manejo de datos, conflictos típicos.
- **Fuera del alcance:** asesoría legal sustantiva, litigios particulares, reforma normativa, priorización.
- **Tiempo estimado:** 1–2 sesiones.
- **Complejidad:** media (requiere fuente experta externa).

### Expediente 1.10 — Síntesis: journeys, mapa priorizado y candidatos de IA
- **Objetivo:** consolidar 1.2–1.9 en (a) los **cinco journey maps completos** ensamblados de sus fragmentos, (b) un **mapa de dolores priorizado** —aquí y solo aquí se califica e interpreta— por severidad × frecuencia × evidencia usando la plantilla de impacto, y (c) un **catálogo consolidado de Observaciones para IA** deduplicado. Todo como entrada al Nivel 2.
- **Entradas:** exclusivamente los expedientes 1.2–1.9 en estado `APROBADO`.
- **Alcance:** ensamblaje de journeys, consolidación y deduplicación de observaciones que aparecen en varias áreas, y priorización con criterio explícito escrito antes de aplicarse.
- **Fuera del alcance:** investigación nueva, benchmark, diseño de soluciones.
- **Entregables:** los 5 journey maps + mapa priorizado de dolores + catálogo de candidatos de IA + lista de preguntas abiertas heredadas + recomendación de qué llevar a Nivel 2.
- **Criterios de aceptación:** cada dolor y cada candidato de IA referencia su expediente y su evidencia fuente; el criterio de priorización está escrito antes de aplicarse; ningún elemento entra sin evidencia; los journeys cubren las etapas de punta a punta de cada actor.
- **Tiempo estimado:** 2 sesiones.
- **Complejidad:** media-alta (síntesis, no descubrimiento).

---

## 6. Riesgos y mitigaciones

### Qué puede salir mal

| Riesgo | Mitigación |
|---|---|
| **Sesgo de fuente única:** concluir el mercado a partir de una sola inmobiliaria conocida. | Cada expediente incluye al menos una fuente externa a la operación propia, o declara la limitación en el entregable. |
| **Describir el proceso ideal, no el real.** | Pedir siempre el último caso concreto ("el último arriendo que cerraste") y contrastar con documentos reales, no con opiniones. |
| **Contaminar investigación con diseño:** proponer soluciones a mitad del expediente. | Los entregables de Nivel 1 no contienen soluciones. La sección Observaciones para IA solo **nombra candidatos con evidencia**; cualquier idea de solución va a un parking lot fuera del expediente. |
| **Calificar y priorizar antes de tiempo:** cada expediente empieza a decidir qué es "el dolor grave". | La calificación, la severidad y la priorización son exclusivas de 1.10. Los expedientes de área solo registran observaciones con su plantilla de impacto. |
| **Observaciones sin cuantificar:** quejas sueltas sin frecuencia ni impacto. | Criterio de aceptación: toda observación lleva la plantilla de impacto (mínimo frecuencia + usuarios afectados). |
| **Journeys inconsistentes entre expedientes:** cada uno mapea el actor a su manera. | Las etapas de cada actor y el formato de fragmento se fijan en la sección 2.5; 1.10 valida el empalme. |
| **Expedientes que se estancan abiertos.** | Timebox por expediente; lo no resuelto se registra como pregunta abierta y el expediente cierra igual. |
| **Confundir Colombia con Medellín.** | Marcar en cada hallazgo si la evidencia es local o nacional; 1.9 y 1.10 verifican la variación regional. |

### Cómo evitar investigaciones redundantes

- Los solapamientos previsibles ya están resueltos por diseño en los campos
  "fuera del alcance" y en el reparto de fragmentos de journey (sección 2.5):
  las reparaciones se investigan en 1.6, no en 1.7; el lead en 1.3 hasta que
  escribe y en 1.4/1.5 desde que escribe.
- Antes de abrir un expediente, releer solo los índices, las secciones de
  observaciones y los fragmentos de journey de los expedientes ya aprobados
  — no los documentos completos.
- Si dos expedientes descubren la misma observación, ninguno la re-investiga:
  se referencia al que la documentó primero; la deduplicación formal ocurre en 1.10.
- Una entrevista puede alimentar varios expedientes (un gerente responde
  sobre captación y gerencia en la misma sesión). La agenda de entrevistas de
  cada fase se planifica en bloque para no citar dos veces a la misma persona.

### Cómo evitar gastar demasiados tokens

- **Una sesión = un expediente.** Nunca investigar dos áreas en la misma
  conversación; el contexto se mantiene pequeño y enfocado.
- **Entradas mínimas:** cada sesión carga solo este plan y las secciones que
  le sirvan de los expedientes aprobados, no la base entera.
- **Sin agentes múltiples ni deep research por defecto:** las búsquedas
  externas, si se necesitan, son puntuales y dirigidas por las preguntas del
  plan, nunca exploratorias.
- **Entregables acotados:** los expedientes responden las preguntas del plan y
  registran observaciones/decisiones/IA; profundidad extra requiere aprobación
  explícita antes de ejecutarse.
- **Cerrar antes de abrir:** no se abre un expediente de la fase siguiente con
  expedientes de la fase actual en `BORRADOR`.

---

## 7. Siguiente paso

Este plan queda en `EN REVISIÓN`. Tras su aprobación, el primer expediente a
ejecutar es el **1.2 — Captación de inventario**. No se inicia ninguna
investigación sin esa aprobación.
