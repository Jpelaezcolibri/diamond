# Diamond OS V1 — Alcance comercial mínimo

**Estado:** BORRADOR
**Rol asumido:** Product Manager senior.
**Restricción real:** 1 desarrollador, 6 meses, debe venderse a una
inmobiliaria real.
**Criterio de decisión:** no completar el [Blueprint](DIAMOND-OS-BLUEPRINT-V1.md).
Maximizar aprendizaje, minimizar complejidad, generar ingresos lo antes
posible. Cada inclusión y cada exclusión se justifica.
**Insumo:** la [auditoría](auditoria-blueprint-v1.md) confirmó que el modelo
es correcto pero que el Blueprint, tal como está, es un mapa de destino —
construirlo completo sería el hallazgo H9 materializado: infraestructura
enterprise sobre una operación de un solo desarrollador.

---

## 1. La pregunta que gobierna cada corte

No es "¿qué le falta al Blueprint?". Es: **¿cuál es la porción más pequeña
del modelo que, si funciona, demuestra que el resto del modelo también
funcionaría?** Todo lo que no responda esa pregunta queda fuera, sin
importar qué tan bien diseñado esté en el Blueprint.

## 2. Punto de partida real: mucho ya está construido

El Blueprint no se construye desde cero. Cuatro capacidades del mapa ya
existen en producción y no consumen presupuesto de los 6 meses:

| Capacidad del Blueprint | Estado real |
|---|---|
| Catálogo de Inventario | Construida (sync engine de DMAP) |
| Canales Conversacionales | Construida (bot Sofi) |
| Captación Digital de Demanda | Construida (landing REF) |
| Generación y Publicación de Contenido | Construida, y es la pieza más madura de todo el sistema (DMAP) |
| Gestión de Relaciones (básica) | Parcialmente construida (inbox del CRM) |

Esto ya cubre, sin gastar un solo día de los 6 meses, dos dominios enteros
del Blueprint (II. Inventario, III. Demanda) más una porción del IV. La
pregunta real del ejercicio no es "qué construyo de la demanda" —eso ya
casi no tiene deuda de producto— sino **qué es lo único nuevo que vale la
pena construir**.

## 3. Qué se construye: una sola capacidad nueva

### Administración de Activos, recortada a su núcleo: recaudo y liquidación

**Por qué esta y no otra (justificación de inclusión):**

- Es, según el Modelo Operacional, el área de **mayor volumen recurrente**
  del negocio — ocurre todos los meses, con todos los inmuebles
  administrados, no una vez por transacción.
- Es el único punto del mapa donde hoy la inmobiliaria paga con **tiempo
  humano repetitivo y medible**: alguien arma a mano, cada mes, quién debe,
  cuánto se le paga a cada propietario y qué se descuenta. Eso es un dolor
  con un antes/después cuantificable en 6 meses (cartera vencida, horas
  invertidas por corte) — exactamente lo que permite un pitch comercial
  concreto ("reducimos tu cartera en X%", no "mejoramos tu gobernanza de
  decisiones").
- La auditoría (H9) señaló que Legal, Coordinador Comercial y Centro de
  Decisiones están sobredimensionados para la realidad de la empresa; este
  recorte va en la dirección contraria: es la única área que la auditoría
  confirmó como **infra-construida**, no sobre-diseñada.
- Es la prueba más barata y más honesta de si la tesis central del programa
  —clasificar decisiones en H/A/S y que el sistema respete esa
  clasificación— funciona en un proceso real. Si el corte automático (S) y
  la aprobación de liquidación (A, línea fiduciaria) funcionan aquí, el
  resto del modelo tiene evidencia a su favor. Si no funciona aquí, es
  mucho más barato descubrirlo en una sola capacidad que después de
  construir siete dominios.

**Qué incluye exactamente (y qué no):**

| Dentro de V1 | Fuera de V1 (queda manual) |
|---|---|
| Recordatorio automático de vencimiento de canon (**S**) | Gestión de mora escalada a cobro jurídico |
| Cálculo automático de la liquidación mensual al propietario, con aprobación humana antes de pagar (**A** — línea roja fiduciaria, confirmada por H7 de la auditoría) | Reparaciones y mantenimiento (Caso/proveedores) |
| Visibilidad simple de cartera vencida (quién debe, hace cuánto) | Renovación/incremento anual de contrato |

Se corta deliberadamente el resto de Administración de Activos
(mantenimiento, renovaciones) porque, aunque están en el Blueprint, no son
el cuello de botella mensual — son eventos de baja frecuencia que hoy ya se
resuelven por WhatsApp sin fricción crítica.

**Objeto nuevo mínimo:** Movimiento Financiero (recaudo, pago a
propietario), referenciado contra el contrato de arrendamiento activo que
ya existe hoy como texto/PDF fuera del sistema — **no** se construye el
objeto "Acuerdo" polimórfico completo que la auditoría (H5) marcó como
riesgo; se modela solo el subtipo que se necesita, sin forzar los otros
tres regímenes legales a compartir esquema.

**Comisión y Garantía (H7):** quedan fuera de V1 explícitamente. La
auditoría los marcó como objetos faltantes de alto riesgo fiduciario, pero
ninguno de los dos es necesario para el recorte de recaudo/liquidación —
se documentan como deuda consciente, no se inventan objetos que esta V1 no
usa.

## 4. Cómo se aplica la gobernanza H/A/S: sin motor genérico

**Decisión de PM, no de arquitecto:** no se construye el Motor de Decisión
como pieza de infraestructura reutilizable en V1. El criterio H/A/S se
aplica **directamente, embebido**, dentro de la única capacidad nueva:
- Ordenar y disparar el cobro → autónomo, sin pantalla de aprobación.
- Calcular la liquidación → automático, pero el pago no sale sin que un
  humano lo apruebe.

Construir un "motor" genérico para un solo caso de uso es la definición de
sobre-ingeniería. La extracción a un motor reutilizable se hace la primera
vez que una **segunda** capacidad necesite el mismo patrón — no antes. Esto
también responde directamente al hallazgo H8 de la auditoría (proliferación
de motores): en V1, el conteo correcto de motores nuevos es **cero**.

Por la misma razón, tampoco se construye un Registro de Eventos unificado
como infraestructura genérica: la nueva capacidad registra lo que necesita
para su propia auditoría (qué se cobró, qué se aprobó, cuándo), sin
pretender ser el sistema nervioso de los otros seis dominios que no existen
todavía.

## 5. Todo lo demás del Blueprint: fuera de V1, con justificación

| Capacidad/pieza del Blueprint | Por qué queda fuera |
|---|---|
| Captación de Propietarios | El captador ya lo hace sin sistema; no es el cuello de botella que un propietario o gerente pagaría por resolver primero. Además, la auditoría (H2) encontró que su diseño actual duplica Gestión de Relaciones — construirla ahora significaría construir la versión equivocada. |
| Cierre y Transacciones (banco/aseguradora/abogado) | Bajo volumen mensual comparado con recaudo; hoy "funciona" a mano vía WhatsApp sin fricción que un cliente pague por resolver primero. |
| Gestión Documental y Motor Documental | La auditoría (H3, H8) ya señaló que están mal ubicados y son prematuros. No se construyen hasta que una capacidad real los necesite con volumen. |
| Legal y Cumplimiento | Ya marcada "Diferible" en el propio Blueprint (§7.5) y ratificada por la auditoría (H9) como sobredimensionada para el tamaño actual del negocio. |
| Coordinador Comercial / ruteo por carga | La empresa real tiene 1-3 asesores; una capacidad de balanceo de carga es arquitectura para un equipo que no existe. |
| Centro de Decisiones como dominio | La auditoría (H4) mostró que es una vista con dependencia total de los otros seis dominios, casi todos inexistentes. En V1 se reduce a lo mínimo: un reporte de cartera dentro de la única capacidad nueva, no una plataforma de analítica. |
| Servicio al Cliente / Postventa | La auditoría (H1) confirmó que es un hueco real del Blueprint, pero de bajo volumen de reclamos hoy; se documenta como pendiente, no se construye. |
| Gestión Financiera contable completa (retenciones, declaraciones) | Se queda con el contador externo actual; V1 solo registra el movimiento de recaudo/pago, no automatiza tributación. |
| Identidad y Tenancy — Persona unificada | Migrar la identidad de los cuatro sistemas ya en producción es alto riesgo y bajo impacto de ingresos en 6 meses. Se acepta como deuda técnica consciente: la nueva capacidad referencia los contactos que ya existen, sin migrarlos. |
| Multi-tenant a escala ("cientos de inmobiliarias") | Fuera de alcance por diseño: V1 valida con una inmobiliaria (o un puñado), no con cientos. Los riesgos de aislamiento de identidad (H11) y gobernanza configurable (H10) que señaló la auditoría son reales pero prematuros — se resuelven cuando haya un segundo o tercer cliente real, no antes. |

## 6. Qué tan grande es el corte

No se puede medir en "70% de las 16 capacidades" de forma literal, porque
buena parte del Blueprint ya estaba construida antes de este ejercicio (esa
inversión no se descarta, se reconoce como base). Medido en **esfuerzo
nuevo de los 6 meses**, el corte es más drástico que 70%:

- De 7 dominios del Blueprint → **1 dominio parcial** recibe trabajo nuevo.
- De 16 capacidades → **1 capacidad nueva**, recortada a su núcleo.
- De 6 motores centrales propuestos → **0 motores nuevos**; el criterio de
  gobernanza se embebe directo en la capacidad.
- De 12 objetos de núcleo → **1 objeto nuevo** (Movimiento Financiero),
  reutilizando lo mínimo necesario del resto sin construirlo completo.

## 7. Qué valida esta V1

Si recaudo + liquidación con aprobación humana funciona en producción con
un cliente real durante unos meses, eso demuestra tres cosas a la vez:

1. Que la clasificación H/A/S del [Modelo de Gobernanza](modelo-gobernanza-decisiones.md)
   sostiene un proceso operativo real, no solo teoría — la validación de
   fondo que todo el programa necesita antes de invertir en más dominios.
2. Que hay un problema real que una inmobiliaria paga por resolver
   (reducción de cartera vencida y de horas de trabajo manual), no solo un
   problema interesante de modelar.
3. Qué capacidad construir después: la elección entre extender
   Administración de Activos (mantenimiento, renovaciones) o abrir un
   segundo dominio (Relación Comercial, Transacción) se decide con datos de
   uso real de esta V1, no con la prioridad teórica que el Blueprint le
   asignó en el papel.

Si no funciona, se descubrió en la porción más barata posible de construir
— y se corrige el Modelo de Gobernanza antes de haber invertido en seis
dominios más.
