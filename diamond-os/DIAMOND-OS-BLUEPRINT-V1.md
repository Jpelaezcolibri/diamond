# DIAMOND OS BLUEPRINT V1

**Estado:** BORRADOR — Constitución del producto
**Autor:** Chief Product Officer / Chief Architect (rol asumido para este documento)
**Fuentes exclusivas:** [Modelo Operacional de una Inmobiliaria Colombiana](modelo-operacional-inmobiliaria.md), [Modelo de Gobernanza de Decisiones](modelo-gobernanza-decisiones.md), [ARCHITECTURE.md](../ARCHITECTURE.md) (bot Sofi), [crm/ARCHITECTURE.md](../crm/ARCHITECTURE.md), [dmap/ARCHITECTURE.md](../dmap/ARCHITECTURE.md), [web/README.md](../web/README.md) + [web/DESIGN.md](../web/DESIGN.md), [playbook/00-INDICE.md](../playbook/00-INDICE.md). No se investigó nada fuera de estos documentos.

Este documento no diseña pantallas, componentes, base de datos, APIs, código,
prompts ni agentes. Diseña el sistema: qué capacidades tiene, cómo se
agrupan, cómo fluye el conocimiento entre ellas, cuáles son sus objetos y sus
motores. Todo desarrollo futuro se alinea con esto o cambia esto primero.

---

## 0. Declaración fundacional

> **Diamond OS no es software. Diamond OS es un modelo operativo ejecutado
> por software.**

Un CRM es software. Un ERP es software. Un chatbot es software. Todos mueren
con su stack. Lo que este documento fija —qué decisiones existen en una
inmobiliaria, quién las toma, con qué evidencia y con qué consecuencia— no
depende de Next.js, de Supabase, de Claude ni de Meta. Si en cinco años
Diamond OS migra de proveedor de IA, cambia de framework o se integra con
Salesforce, el modelo sigue siendo válido: solo cambia el software que lo
ejecuta.

El activo intelectual de este proyecto no son sus cuatro aplicaciones (bot,
CRM, DMAP, landing). Es el **modelo**: el [Modelo Operacional](modelo-operacional-inmobiliaria.md)
(cómo decide una inmobiliaria) y el [Modelo de Gobernanza](modelo-gobernanza-decisiones.md)
(quién debe decidir qué). Este Blueprint es la primera traducción de ese
modelo a arquitectura funcional. Cualquier capacidad que se diseñe de aquí
en adelante nace de una sola pregunta: **¿esta decisión pertenece a un
humano, a un humano asistido o a un sistema autónomo?**

Los diez principios del encargo se asumen como restricciones activas de
diseño (se referencian por número a lo largo del documento: **P1**
reducir decisiones manuales, **P2** concentrar el juicio humano donde
aporta valor, **P3** toda decisión importante respaldada por evidencia,
**P4** la información existe una sola vez, **P5** cada dato tiene un dueño
claro, **P6** todo evento importante se registra, **P7** cada actor conoce
solo lo necesario, **P8** la IA no reemplaza el criterio humano donde hay
responsabilidad legal o fiduciaria, **P9** cada módulo existe solo si
agrega una capacidad nueva, **P10** simplicidad sobre cantidad de
funcionalidades).

---

## 1. Punto de partida: qué ya existe

Diamond OS no se diseña sobre una hoja en blanco. Ya hay cuatro sistemas en
producción que implementan, sin haberlo nombrado así, varias capacidades de
este Blueprint:

- El **bot Sofi** ya resuelve gran parte de Canales Conversacionales y una
  porción de Calificación y Ruteo de Demanda.
- El **CRM** ya resuelve una porción de Gestión de Relaciones (inbox,
  intervención manual) y sirve de superficie para DMAP.
- **DMAP** ya resuelve, con más profundidad que cualquier otra pieza, dos
  capacidades completas: sincronización de inventario y generación/
  publicación de contenido. Es, hoy, la parte más madura del sistema.
- La **landing REF** ya resuelve Captación Digital de Demanda a nivel básico.

Este Blueprint no reemplaza nada de eso. Lo nombra dentro de un mapa de
capacidades completo, identifica qué le falta al mapa (los huecos son casi
todos los dominios de **transacción** y **operación recurrente de activos**,
que hoy no existen en ningún sistema construido) y fija el vocabulario y los
objetos que deberían usarse de aquí en adelante para que lo nuevo no
duplique lo existente (P9).

---

## 2. Mapa de capacidades

16 capacidades, agrupadas en 7 dominios. Por cada una: propósito, problema
que resuelve, decisiones que soporta (referenciadas contra el
[Modelo de Gobernanza](modelo-gobernanza-decisiones.md) con su nivel H/A/S),
actores, información que consume y genera, eventos que produce, qué otros
dominios usan esa información, prioridad y dependencias.

Escala de prioridad: **Fundacional** (ya construida, este Blueprint la
reconoce y la extiende) · **Alta** (hueco crítico, no existe hoy en ningún
sistema) · **Media** (hueco real pero de menor urgencia) · **Diferible**
(documentada por completitud, candidata a quedar fuera de V1).

---

### Dominio I — Núcleo de Plataforma

Capacidades habilitantes, transversales a todo el negocio. No toman
decisiones de negocio; existen para que las demás puedan hacerlo bien.

#### 2.1 Identidad y Tenancy
- **Propósito:** que cada organización, cada persona y cada rol se conozcan una sola vez en todo el sistema.
- **Problema que resuelve:** hoy "propietario", "comprador", "arrendatario" y "lead" se tratan como conceptos distintos aunque sean la misma persona en momentos distintos de su relación con la inmobiliaria; eso rompe P4.
- **Decisiones que soporta:** ninguna decisión de negocio directamente; habilita que P7 (cada actor ve solo lo necesario) sea aplicable.
- **Actores:** todos (transversal).
- **Información que consume:** ninguna externa.
- **Información que genera:** identidad canónica de organización, persona y rol/permiso.
- **Eventos que produce:** persona creada, personas fusionadas, rol cambiado.
- **Otros dominios que la usan:** todos.
- **Prioridad:** Fundacional — existe parcialmente (`organizations`, `advisors`, `team` con roles en el CRM); falta el objeto **Persona** unificado.
- **Dependencias:** ninguna — es la base.

#### 2.2 Registro de Eventos
- **Propósito:** que todo hecho relevante del negocio quede registrado una sola vez, en un solo lugar, consultable por cualquier dominio que lo necesite.
- **Problema que resuelve:** hoy la evidencia de lo que pasó vive fragmentada por sistema (`dmap_audit_log`, `publication_events`, `property_change_events`); no hay una sola bitácora del negocio.
- **Decisiones que soporta:** ninguna directamente; es la infraestructura que hace posible P3 (toda decisión respaldada por evidencia) y P6.
- **Actores:** ninguno humano directo; todos los dominios lo alimentan y lo consumen.
- **Información que consume:** eventos de todos los dominios.
- **Información que genera:** la bitácora misma.
- **Eventos que produce:** es el registro; no produce eventos de segundo orden.
- **Otros dominios que la usan:** todos, en especial Orquestación de Actividades y Centro de Decisiones.
- **Prioridad:** Fundacional — existe fragmentada por sistema; falta unificarla como capacidad transversal.
- **Dependencias:** ninguna.

---

### Dominio II — Inventario

Responsabilidad única: que exista una sola verdad sobre qué inmuebles
gestiona la inmobiliaria y en qué condición.

#### 2.3 Captación de Propietarios
- **Propósito:** convertir el contacto con un propietario en un inmueble documentado y con mandato firmado.
- **Problema que resuelve:** el Modelo Operacional marca la captación como la decisión de mayor competencia entre inmobiliarias y hoy no existe soporte alguno para ella en los sistemas construidos.
- **Decisiones que soporta:** perseguir/descartar un prospecto (**A**), recomendar precio de salida (**A**), exigir exclusividad o aceptar mandato abierto (**H**).
- **Actores:** captador, propietario, abogado (checklist documental).
- **Información que consume:** comparables de mercado (del propio Catálogo), reputación del captador.
- **Información que genera:** mandato firmado, ficha de inmueble lista para publicar.
- **Eventos que produce:** propietario contactado, mandato firmado, documentación completa.
- **Otros dominios que la usan:** Catálogo de Inventario (recibe el inmueble), Centro de Decisiones (embudo de captación).
- **Prioridad:** Alta — hueco crítico, no existe hoy.
- **Dependencias:** Identidad y Tenancy (Persona=propietario), Gestión Documental.

#### 2.4 Catálogo de Inventario
- **Propósito:** mantener una única ficha viva por inmueble, sincronizada con su fuente y disponible para todo el negocio.
- **Problema que resuelve:** evita que el inventario publicado se desalinee de la realidad (precio, disponibilidad, fotos).
- **Decisiones que soporta:** detectar cambios que requieren decisión humana vs. los que se re-sincronizan solos (**S** para sincronización pura; **A** para decidir qué hacer ante un cambio de precio/estado).
- **Actores:** captador, marketing, gerente (todos consultan; nadie edita el inmueble directamente, se edita en su fuente).
- **Información que consume:** datos y fotos de la fuente externa del inmueble (hoy Wasi), mandato firmado.
- **Información que genera:** ficha canónica de propiedad, eventos de cambio.
- **Eventos que produce:** propiedad creada, cambiada (precio/fotos/estado), retirada.
- **Otros dominios que la usan:** Generación y Publicación de Contenido, Canales Conversacionales, Captación Digital de Demanda, Gestión de Relaciones, Centro de Decisiones.
- **Prioridad:** Fundacional — ya construida (motor de sincronización de DMAP).
- **Dependencias:** ninguna (es fuente para el resto).

---

### Dominio III — Demanda

Responsabilidad única: generar, capturar y calificar el interés del mercado
por el inventario.

#### 2.5 Generación y Publicación de Contenido
- **Propósito:** producir contenido de marketing sobre el inventario sin trabajo manual repetitivo, con control de calidad y aprobación antes de salir al público.
- **Problema que resuelve:** el costo y el tiempo de producir fotos, copy y creativos por cada inmueble en cada canal.
- **Decisiones que soporta:** qué inventario promover y con qué prioridad (**A**), selección y generación del creativo (**S** dentro de un umbral de calidad, con reintento acotado), publicar el resultado (**A** — toca la marca pública, se mantiene aprobación humana).
- **Actores:** marketing / equipo admin (aprueba, edita, programa).
- **Información que consume:** Catálogo de Inventario, perfil de marca, plantillas.
- **Información que genera:** publicaciones, creativos, métricas de desempeño por publicación.
- **Eventos que produce:** borrador generado, aprobado, publicado, fallido.
- **Otros dominios que la usan:** Captación Digital de Demanda (recibe el tráfico), Centro de Decisiones (costo/resultado por canal).
- **Prioridad:** Fundacional — ya construida (DMAP: sync, selector de imágenes, copywriter, Director Creativo IA, publicador).
- **Dependencias:** Catálogo de Inventario.

#### 2.6 Captación Digital de Demanda
- **Propósito:** dar visibilidad pública al inventario y capturar el primer contacto de un interesado sin fricción.
- **Problema que resuelve:** que el interesado tenga dónde explorar el inventario por su cuenta antes (o en vez) de escribir.
- **Decisiones que soporta:** ninguna de negocio en V1 (recomendar propiedades al visitante queda reservado, ver Backlog).
- **Actores:** visitante público.
- **Información que consume:** Catálogo de Inventario.
- **Información que genera:** el primer contacto (lead inicial).
- **Eventos que produce:** lead creado, redirección a conversación.
- **Otros dominios que la usan:** Canales Conversacionales, Calificación y Ruteo de Demanda.
- **Prioridad:** Fundacional — ya construida (landing REF).
- **Dependencias:** Catálogo de Inventario.

#### 2.7 Canales Conversacionales
- **Propósito:** atender cualquier interacción entrante de un interesado, por el canal que use, sin perder contexto.
- **Problema que resuelve:** que el primer contacto no dependa de que un humano esté disponible en ese instante.
- **Decisiones que soporta:** qué acción tomar dentro de la conversación —buscar propiedad, registrar un dato, transferir— (**S** dentro de la política del canal).
- **Actores:** interesado (externo), asesor (recibe la transferencia).
- **Información que consume:** Catálogo de Inventario, historial de la conversación, reglas de calificación.
- **Información que genera:** conversación, mensajes, señales de interés.
- **Eventos que produce:** mensaje recibido, transferencia solicitada.
- **Otros dominios que la usan:** Calificación y Ruteo de Demanda, Gestión de Relaciones.
- **Prioridad:** Fundacional — ya construida (bot Sofi: WhatsApp, Telegram como canal de pruebas).
- **Dependencias:** Catálogo de Inventario, Identidad y Tenancy.

#### 2.8 Calificación y Ruteo de Demanda
- **Propósito:** convertir una interacción cruda en un interesado calificado y puesto en manos del actor correcto.
- **Problema que resuelve:** que un lead caliente se enfríe por demora, o que se malgaste tiempo en uno que no calificaba.
- **Decisiones que soporta:** calificar el interés (**A**, hoy con score automático), asignar al asesor correcto (**S** por especialidad hoy; falta la dimensión de carga/desempeño que exigiría el rol de Coordinador Comercial del Modelo Operacional).
- **Actores:** coordinador comercial (rol sin soporte hoy — hueco identificado), asesor.
- **Información que consume:** señales de la conversación, reglas de calificación, disponibilidad/carga de asesores.
- **Información que genera:** calificación del interesado, asignación.
- **Eventos que produce:** interesado calificado, asignado, reasignado.
- **Otros dominios que la usan:** Gestión de Relaciones, Centro de Decisiones.
- **Prioridad:** Alta — existe parcialmente (score + especialidad en el bot); falta la capa de carga/desempeño.
- **Dependencias:** Canales Conversacionales, Identidad y Tenancy.

---

### Dominio IV — Relación Comercial

Responsabilidad única: llevar a cada interesado calificado, con acompañamiento
humano, hasta un acuerdo — sin perder ningún compromiso en el camino.

#### 2.9 Gestión de Relaciones
- **Propósito:** una sola verdad por persona y por oportunidad comercial, con su historial completo y su etapa actual.
- **Problema que resuelve:** que la información de un interesado (o de un propietario) no viva repartida entre el chat de un asesor, una planilla y la memoria de alguien.
- **Decisiones que soporta:** priorizar a qué interesado atender (**A**), qué inmuebles mostrar (**A**), recomendar aceptar/contraofertar (**A** — es negociación, se queda en asistida, nunca autónoma).
- **Actores:** asesor, coordinador, gerente.
- **Información que consume:** interesados calificados, Catálogo de Inventario, historial de conversación.
- **Información que genera:** registro de interacciones, estado de la oportunidad.
- **Eventos que produce:** visita agendada, oferta presentada, oferta aceptada/rechazada, negocio caído.
- **Otros dominios que la usan:** Orquestación de Actividades, Cierre y Transacciones, Centro de Decisiones.
- **Prioridad:** Alta — existe parcialmente (inbox y leads del CRM); falta el concepto explícito de oportunidad con etapas de punta a punta.
- **Dependencias:** Calificación y Ruteo de Demanda, Catálogo de Inventario.

#### 2.10 Orquestación de Actividades
- **Propósito:** que ningún compromiso (visita, seguimiento, entrega, pago) dependa de que alguien se acuerde.
- **Problema que resuelve:** hoy el seguimiento vive en la cabeza de cada asesor; nada dispara ni vence solo.
- **Decisiones que soporta:** cuándo disparar un seguimiento (**S** dentro de una cadencia definida), reagendar (**S** logística).
- **Actores:** todos los actores internos (transversal a Captación, Comercial, Administración).
- **Información que consume:** eventos de cualquier dominio (ej. "oferta aceptada" dispara "coordinar promesa"), reglas de cadencia.
- **Información que genera:** actividades, su estado de cumplimiento.
- **Eventos que produce:** actividad creada, vencida, completada.
- **Otros dominios que la usan:** todos (es transversal).
- **Prioridad:** Alta — no existe como capacidad explícita en ningún sistema hoy.
- **Dependencias:** Registro de Eventos.

---

### Dominio V — Transacción

Responsabilidad única: llevar un acuerdo alcanzado hasta su cierre legal y
financiero, coordinando actores externos que la inmobiliaria no controla.

#### 2.11 Cierre y Transacciones
- **Propósito:** que un negocio con precio acordado no se caiga por descoordinación entre comprador/arrendatario, banco, aseguradora y abogado.
- **Problema que resuelve:** el tramo con mayor valor en riesgo (promesa, crédito, estudio de títulos, escrituración o contrato de arriendo, entrega) hoy no tiene ningún seguimiento estructurado.
- **Decisiones que soporta:** preparar y validar documentación (**A**), decidir viabilidad legal (**H**), aprobar al candidato — sombra de la aseguradora (**A**), aprobar al arrendatario — propietario (**H**).
- **Actores:** comprador, arrendatario, propietario, abogado, banco (sombra), aseguradora (sombra), asesor.
- **Información que consume:** oferta aceptada, documentos, resultado de estudios externos.
- **Información que genera:** estado del cierre, expediente de la transacción.
- **Eventos que produce:** promesa firmada, crédito aprobado, estudio aprobado/rechazado, contrato firmado, entrega realizada.
- **Otros dominios que la usan:** Gestión de Relaciones (cierra la oportunidad), Administración de Activos (arranca al entregar), Gestión Financiera (comisión).
- **Prioridad:** Alta — hueco crítico, hoy vive en WhatsApp y en la memoria del asesor.
- **Dependencias:** Gestión de Relaciones, Gestión Documental.

#### 2.12 Gestión Documental
- **Propósito:** que todo documento del negocio (mandato, contrato, estudio, soporte) tenga un único lugar de verdad, versión y dueño.
- **Problema que resuelve:** documentos dispersos entre correo, WhatsApp y carpetas locales, sin saber cuál es la versión vigente.
- **Decisiones que soporta:** verificar completitud contra un checklist (**S**), redactar un borrador estándar (**A**), aprobar/firmar (**H** — responsabilidad legal).
- **Actores:** captador, abogado, administración, contabilidad.
- **Información que consume:** plantillas, datos de la persona/propiedad/transacción a la que se ancla.
- **Información que genera:** documentos, versiones, estado de completitud.
- **Eventos que produce:** documento generado, firmado, vencido.
- **Otros dominios que la usan:** Captación de Propietarios, Cierre y Transacciones, Administración de Activos, Legal y Cumplimiento.
- **Prioridad:** Alta — hueco parcial (ningún sistema actual gestiona documentos de transacción o legales).
- **Dependencias:** Identidad y Tenancy, Catálogo de Inventario (el objeto al que se ancla el documento).

#### 2.13 Legal y Cumplimiento
- **Propósito:** dar visibilidad y trazabilidad a los riesgos legales y a las acciones derivadas (restitución, cobro jurídico), sin sustituir el juicio del abogado.
- **Problema que resuelve:** que un incumplimiento no se pierda de vista ni se actúe sobre él sin evidencia ordenada.
- **Decisiones que soporta:** aprobar/frenar un negocio por riesgo (**H**), iniciar una acción legal (**H**) — el sistema solo señala el umbral y prepara el expediente.
- **Actores:** abogado, gerente, administración.
- **Información que consume:** estado de mora/incumplimiento, documentos.
- **Información que genera:** expediente del caso legal, estado de la acción.
- **Eventos que produce:** incumplimiento detectado, acción iniciada, caso resuelto.
- **Otros dominios que la usan:** Administración de Activos, Cierre y Transacciones, Gestión Documental.
- **Prioridad:** Diferible — ver hipótesis en Decisiones Arquitectónicas §7.4. El volumen actual del negocio puede no justificar una capacidad dedicada en V1; podría absorberse dentro de Casos y Documentos.
- **Dependencias:** Administración de Activos, Gestión Documental.

---

### Dominio VI — Operación de Activos

Responsabilidad única: operar, mes a mes, el portafolio de inmuebles ya
colocados (arrendados o bajo administración), con su dinero asociado.

#### 2.14 Administración de Activos
- **Propósito:** operar el portafolio administrado con puntualidad, sin que cada corte de mes dependa de trabajo manual.
- **Problema que resuelve:** es, según el Modelo Operacional, el área de mayor volumen recurrente del negocio, y hoy no existe en ningún sistema construido.
- **Decisiones que soporta:** cobrar el canon en orden y momento (**S**), autorizar reparación bajo un umbral (**S**), aprobar la liquidación al propietario (**A** — línea roja fiduciaria), renovar/incrementar el canon (**A**), escalar una mora prolongada (**A**, con umbral objetivo).
- **Actores:** administración, propietario, arrendatario, proveedores, contabilidad.
- **Información que consume:** Acuerdo activo (contrato), calendario de vencimientos, reportes de daño.
- **Información que genera:** liquidaciones, órdenes de reparación, estado de cartera.
- **Eventos que produce:** canon vencido, pago recibido, mora detectada, reparación solicitada/autorizada/completada, contrato por vencer.
- **Otros dominios que la usan:** Gestión Financiera, Gestión de Relaciones (postventa), Centro de Decisiones.
- **Prioridad:** Alta — el mayor hueco del sistema completo.
- **Dependencias:** Cierre y Transacciones (arranca al entregar), Gestión Documental.

#### 2.15 Gestión Financiera
- **Propósito:** registrar, conciliar y respaldar cada movimiento de dinero con trazabilidad y cumplimiento tributario.
- **Problema que resuelve:** que un pago, una comisión o una retención no dependan de que alguien lo recuerde o lo calcule bien a mano.
- **Decisiones que soporta:** clasificar una transacción (**S**), aplicar retención/impuesto (**A** — responsabilidad legal), validar antes de liberar un pago (**A** — línea roja fiduciaria).
- **Actores:** contabilidad, gerente, administración.
- **Información que consume:** movimientos de recaudo y pago, facturas, comisiones.
- **Información que genera:** asientos, estados financieros, comprobantes.
- **Eventos que produce:** transacción registrada, pago liberado, declaración presentada.
- **Otros dominios que la usan:** Administración de Activos, Cierre y Transacciones (comisiones), Centro de Decisiones.
- **Prioridad:** Media — hueco real, menos urgente que Administración de Activos porque hoy el volumen se puede sostener manualmente un tiempo más.
- **Dependencias:** Administración de Activos, Cierre y Transacciones.

---

### Dominio VII — Gobierno

Responsabilidad única: que quien dirige el negocio decida con evidencia
agregada de todos los dominios, no con reportes armados a mano.

#### 2.16 Centro de Decisiones
- **Propósito:** dar al gerente visibilidad consolidada del negocio para decidir precio, inversión, comisiones, riesgo y crecimiento con evidencia.
- **Problema que resuelve:** el Modelo Operacional identifica que el gerente hoy decide "a ciegas" y arma su información a mano; esta capacidad es la contraparte de esa observación.
- **Decisiones que soporta:** todas son **H** en el Modelo de Gobernanza (comisiones, inversión, contratación, riesgo, crecimiento); esta capacidad no las toma, las alimenta con evidencia agregada y recomendaciones de foco (**A**).
- **Actores:** gerente.
- **Información que consume:** eventos y resultados de **todos** los demás dominios.
- **Información que genera:** métricas, alertas, recomendaciones de foco.
- **Eventos que produce:** alerta generada, corte de periodo cerrado.
- **Otros dominios que la usan:** ninguno (es hoja del grafo: consume de todos, no alimenta a otros dominios operativos).
- **Prioridad:** Alta en propósito, pero **depende por completo de que los demás dominios generen eventos limpios primero** — no puede construirse antes que el Registro de Eventos y al menos un dominio operativo maduro.
- **Dependencias:** Registro de Eventos + todos los dominios operativos.

---

## 3. Dominios funcionales — resumen de responsabilidad

| Dominio | Responsabilidad única | Qué NO hace |
|---|---|---|
| I. Núcleo de Plataforma | Que cada organización/persona/evento se conozca una sola vez | No decide nada de negocio |
| II. Inventario | Una sola verdad sobre qué inmuebles existen y su estado | No decide precio final ni gestiona la demanda |
| III. Demanda | Generar, capturar y calificar interés del mercado | No negocia ni cierra nada |
| IV. Relación Comercial | Acompañar a un interesado calificado hasta el acuerdo | No ejecuta la parte legal/financiera del cierre |
| V. Transacción | Llevar un acuerdo hasta su cierre legal y financiero | No opera el activo después de entregado |
| VI. Operación de Activos | Operar mes a mes lo ya colocado | No capta ni vende nada nuevo |
| VII. Gobierno | Dar evidencia agregada para decidir | No opera ni ejecuta nada directamente |

Cada dominio tiene una sola razón para cambiar (principio de responsabilidad
única aplicado a negocio, no solo a código). Un dominio nuevo solo se crea si
ninguno de los siete puede absorber la capacidad sin romper su
responsabilidad única (P9).

---

## 4. Flujo natural de información

No el flujo de pantallas: el flujo del conocimiento.

**1. El conocimiento nace en dos orígenes.** Por el lado de la oferta, en el
contacto con un propietario (**Captación de Propietarios**). Por el lado de
la demanda, en el mercado que ve el inventario publicado y escribe
(**Captación Digital de Demanda** y **Canales Conversacionales**).

**2. Ese conocimiento converge en dos objetos núcleo.** Lo que aporta el
propietario se convierte en **Propiedad** (vía **Catálogo de Inventario**).
Lo que aporta el interesado se convierte en **Persona** + **Oportunidad**
(vía **Calificación y Ruteo de Demanda**).

**3. Desde ahí, la relación humana toma el relevo.** **Gestión de
Relaciones** combina Persona + Propiedad + Oportunidad y las hace avanzar;
**Orquestación de Actividades** asegura que cada paso tenga un compromiso
vivo (nadie deja "morir" una visita o un seguimiento porque el sistema, no
la memoria de un asesor, sabe que está pendiente).

**4. Cuando una Oportunidad llega a un acuerdo de precio**, el conocimiento
pasa a **Cierre y Transacciones**, que se apoya en **Gestión Documental**
para generar y validar lo formal, y coordina con actores externos (banco,
aseguradora, abogado) cuyo conocimiento entra al sistema como **decisión
sombra**: la inmobiliaria no controla esa decisión, pero sí prepara y
recibe su resultado.

**5. Al cerrar, el conocimiento se bifurca según el tipo de negocio.** En
una venta, termina en **Gestión Financiera** (comisión) y en el histórico
de Persona/Propiedad. En un arriendo, migra a **Administración de
Activos**, que lo convierte en un flujo recurrente de movimientos
financieros y casos operativos (recaudo, mantenimiento, renovación) que se
repite mes a mes mientras el contrato viva.

**6. En cada paso de todo lo anterior, se emite un Evento** hacia el
**Registro de Eventos**, que lo redistribuye a quien lo necesite: dispara
nuevas actividades en Orquestación, queda como evidencia auditable, y
alimenta al **Centro de Decisiones**, que agrega conocimiento de todos los
dominios sin que ninguno tenga que reportar manualmente.

**7. El Motor de Decisión atraviesa todo el flujo de forma transversal.**
En cada punto donde el Modelo de Gobernanza clasificó una decisión, es este
motor el que resuelve si el sistema ejecuta (**S**), recomienda (**A**) o
solo prepara evidencia para que decida un humano (**H**). Cada resolución,
sea del nivel que sea, queda registrada como objeto **Decisión** con su
evidencia — eso es lo que hace operativo el principio P3, y lo que
eventualmente permite demostrar que una decisión Asistida puede convertirse
en Autónoma (A→S) con evidencia acumulada de acierto.

El conocimiento, entonces, no fluye en línea recta: fluye en dos ríos
(oferta y demanda) que confluyen en la relación humana, se estrechan en la
transacción, y se abren de nuevo en un ciclo recurrente (activos) o se
cierran (venta) — con un sistema nervioso (Eventos) y un árbitro
transversal (Decisión) presentes en cada tramo.

---

## 5. Núcleo del sistema: objetos fundamentales

Se descubrieron, no se asumieron, a partir de lo que cada capacidad del
mapa anterior consume y genera. Doce objetos, cada uno con un dueño único
(P5) y existiendo una sola vez en todo el sistema (P4):

| Objeto | Qué representa | Dominio dueño |
|---|---|---|
| **Organización** | El tenant: una inmobiliaria (o marca) operando en el sistema. | Núcleo de Plataforma |
| **Persona** | Cualquier individuo con el que la inmobiliaria se relaciona — propietario, comprador, arrendatario, proveedor — con uno o varios roles simultáneos sobre el tiempo. | Núcleo de Plataforma |
| **Propiedad** | Un inmueble, su ficha y su estado actual. | Inventario |
| **Acuerdo** | Cualquier vínculo formal con vigencia entre Personas y/o una Propiedad: mandato de captación, contrato de arrendamiento, contrato de administración, promesa de compraventa. | Transacción / Inventario según el tipo |
| **Oportunidad** | El recorrido de un interés desde que entra calificado hasta que cierra o se descarta — de venta o de arriendo. | Relación Comercial |
| **Conversación** | Un hilo de interacción con una Persona, independiente del canal. | Demanda |
| **Actividad** | Un compromiso pendiente (visita, seguimiento, entrega, pago) con su vencimiento y su estado. | Relación Comercial |
| **Documento** | Cualquier archivo formal (contrato, estudio, soporte) con versión y dueño. | Transacción |
| **Movimiento Financiero** | Un hecho de dinero: recaudo, pago a propietario, comisión, gasto. | Operación de Activos |
| **Caso** | Una incidencia operativa que requiere resolución: una reparación, un reclamo (PQR), un asunto legal. | Operación de Activos / Transacción según el tipo |
| **Decisión** | El registro de una decisión tomada por el sistema o por una persona, con su nivel de gobernanza (H/A/S), su evidencia y su resultado. | Núcleo de Plataforma (transversal) |
| **Evento** | El hecho atómico: algo ocurrió, en qué objeto, cuándo, y qué lo disparó. | Núcleo de Plataforma (transversal) |

**Decisiones de modelado descartadas explícitamente** (para que quede
registrado por qué el núcleo no es más grande de lo necesario, P10):
- **"Activo"** no es un objeto aparte: una propiedad física ya es
  **Propiedad**; el dinero ya es **Movimiento Financiero**. Un objeto
  adicional solo duplicaría a los dos anteriores.
- **"Relación"** no es un objeto aparte de **Acuerdo**: todo vínculo con
  vigencia entre partes (mandato, contrato, promesa) es la misma naturaleza
  de objeto con distinto subtipo.
- **"Lead"**, como se usa hoy en el bot y el CRM, no es un objeto de núcleo
  propio: es una **Oportunidad** en su primera etapa. Mantenerlo como
  concepto aparte duplicaría el pipeline en dos lugares.

---

## 6. Motores centrales

Se descubrieron a partir de qué mecanismo, ya construido o necesario,
**se repite a través de más de una capacidad** — un motor solo se nombra
si evita construir el mismo mecanismo dos veces (P9, P10). Seis motores:

### 6.1 Motor de Sincronización
Mantiene el Catálogo de Inventario alineado con su fuente externa
detectando cambios (hoy: Wasi, vía hashing de contenido). Generalizable a
cualquier fuente externa futura sin cambiar el resto del sistema.
*Ya existe (motor de sync de DMAP).*

### 6.2 Motor de Decisión
El núcleo diferenciador. Dado un tipo de decisión y su clasificación en el
Modelo de Gobernanza, resuelve si el sistema ejecuta dentro de política
(**S**), calcula y recomienda esperando al humano (**A**), o solo prepara
evidencia sin proponer resultado (**H**). Cada resolución se persiste como
objeto **Decisión**. Es el motor que convierte el Modelo de Gobernanza de
documento en comportamiento real y consistente en todo el sistema — sin él,
cada capacidad reinventaría su propio criterio de "qué tanto decide el
sistema aquí", rompiendo la coherencia que le da valor al modelo.
*No existe hoy como motor explícito; existe implícito y disperso (scoring en
el bot, umbrales en DMAP). Construirlo es la apuesta arquitectónica central
de V1.*

### 6.3 Motor de Eventos
El sistema nervioso: captura cada Evento, lo persiste en el Registro de
Eventos y lo distribuye a quien lo necesite (Orquestación de Actividades,
auditoría, Centro de Decisiones). Es lo que permite que un dominio reaccione
a lo que pasa en otro sin acoplarse directamente a él.
*Existe fragmentado por sistema; falta unificarlo.*

### 6.4 Motor Conversacional
Orquesta cualquier interacción por canal: carga contexto, decide qué
capacidad invocar (buscar propiedad, registrar dato, transferir), mantiene
el hilo. Generalizable a cualquier canal futuro sin rediseñar la lógica de
conversación.
*Ya existe (`engine.js` del bot Sofi).*

### 6.5 Motor de Generación de Contenido
Produce contenido creativo de marketing a partir de la Propiedad y el
perfil de marca, con control de calidad automático y umbral de aceptación.
*Ya existe con más madurez que cualquier otra pieza del sistema (Diamond AI
Creative Director, Copywriter, Image Selector de DMAP).*

### 6.6 Motor Documental
Genera documentos formales (contratos, mandatos) desde plantillas y datos
del Acuerdo/Persona/Propiedad correspondiente, con control de versión. Se
separa del Motor de Generación de Contenido porque su naturaleza es
distinta: fidelidad exacta y trazabilidad legal, no creatividad.
*No existe hoy; el patrón de plantillas de DMAP (Content Templates) es un
antecedente reutilizable pero para un propósito distinto.*

**Decisión de diseño explícita:** ni Orquestación de Actividades ni
Calificación y Ruteo de Demanda son motores aparte. La primera es una
capacidad que consume el Motor de Eventos y aplica reglas de cadencia a
través del Motor de Decisión; la segunda es una instancia de aplicación del
Motor de Decisión sobre las señales de una Conversación. Nombrarlos como
motores independientes habría duplicado mecanismo ya cubierto (P9).

---

## 7. Decisiones arquitectónicas y contradicciones resueltas

Registradas tal como pide el encargo: sin reabrir investigación, se fija la
decisión y se continúa.

**7.1 — Publicar contenido se clasifica como Asistida (A), no Autónoma (S).**
El Modelo de Gobernanza no había clasificado explícitamente "publicar" como
acto distinto de "generar" o "recomendar qué promover". Al construir este
Blueprint, y en coherencia con lo que DMAP ya implementa (aprobación humana
obligatoria antes de publicar), se fija: generar y seleccionar el creativo
es S dentro de un umbral de calidad; el acto de publicar permanece A porque
compromete la marca pública ante el mercado — toca la fuerza de "confianza"
del Modelo de Gobernanza aunque no sea, en sentido estricto, una relación
interpersonal. Se ratifica lo ya construido, no se cambia.

**7.2 — El rol de Coordinador Comercial no se fuerza a existir en V1.**
El Modelo Operacional lo define como actor separado del Asesor, con
decisiones propias (asignación por carga, resolución de conflictos). Ningún
sistema construido hoy lo soporta. Este Blueprint diseña la capacidad
**Calificación y Ruteo de Demanda** para que ese rol quepa cuando exista,
pero no obliga a que V1 lo implemente: se documenta como hueco, no como
requisito.

**7.3 — "Lead" migra conceptualmente a "Oportunidad".**
El dato que hoy se llama `leads` en el bot y el CRM es una entidad más
angosta que el objeto de núcleo **Oportunidad** definido en la sección 5
(que cubre todo el recorrido hasta el cierre). La migración de datos y de
nombre es una decisión de implementación que no corresponde resolver en este
documento; se deja registrada para la siguiente etapa.

**7.4 — Hipótesis sin validar: Persona unificada entre roles.**
Se asume, sin haberlo verificado con evidencia de campo, que un mismo
contacto (mismo número de WhatsApp, por ejemplo) puede ser simultáneamente
propietario de un inmueble y comprador de otro, y que modelarlo como una
sola **Persona** con roles múltiples es correcto y deseable (coherente con
P4). Se registra como hipótesis de diseño, no como hecho verificado, y se
continúa sobre ella.

**7.5 — Hipótesis sin validar: Legal y Cumplimiento como capacidad separada
podría ser sobre-ingeniería para el tamaño actual del negocio.** Con un
volumen bajo de casos legales mensuales y un solo desarrollador, es posible
que en V1 baste con modelar un asunto legal como un **Caso** + **Documento**
sin una capacidad dedicada. Se deja definida por completitud (§2.13) pero
marcada **Diferible**; la decisión de activarla o no se toma con evidencia
de volumen real, no aquí.

---

## 8. Backlog Estratégico

Ideas que surgieron durante el diseño y que, por regla del encargo, no
cambian el alcance de este Blueprint. Quedan registradas para su momento:

- **Asistente conversacional embebido en la landing** (ya reservado como
  `features.aiAssistant` en la configuración de la landing REF) — extendería
  Canales Conversacionales a un canal adicional (web) sin rediseño de motor.
- **Comparador de propiedades en la landing** (`features.comparator`, ya
  reservado en config) — nueva forma de consumir el Catálogo de Inventario,
  no una capacidad nueva.
- **Motor de Decisión con ajuste automático de umbral A→S** basado en tasa
  de acierto histórica de cada tipo de decisión — hoy el movimiento de
  Asistida a Autónoma es una decisión curada manualmente; podría, con datos
  suficientes, sugerirse solo.
- **Fusión y deduplicación automática de Personas** — el objeto Persona
  permite roles múltiples desde el diseño, pero la lógica para detectar que
  dos registros son la misma persona (mismo teléfono, distinto canal) es
  trabajo de implementación futura.
- **Reporting predictivo en el Centro de Decisiones** (forecast de cierre,
  forecast de cartera) — V1 es descriptivo (qué pasó y qué está pasando);
  lo predictivo requiere historia acumulada que hoy no existe.
- **Multi-fuente de inventario** — el Motor de Sincronización se diseñó
  generalizable a cualquier fuente; incorporar una segunda fuente además de
  Wasi es extensión, no rediseño.
- **Generación de respuestas conversacionales complejas vía el Motor de
  Generación de Contenido** (hoy separado del Motor Conversacional, que
  solo orquesta tools) — explorar si conviene compartir mecanismo entre
  ambos motores.

---

## 9. Cómo se usa este documento

Este Blueprint es la Constitución del producto. No se implementa
directamente: primero cada dominio se detalla en su propia especificación
(objetos de datos concretos, contratos entre capacidades, políticas exactas
del Motor de Decisión por cada tipo de decisión). Pero ninguna especificación
posterior puede introducir un dominio, un objeto o un motor que no esté aquí
—o debe volver aquí primero, actualizar este documento y justificar por qué
el mapa cambia.

La pregunta que abre cada decisión de diseño futura sigue siendo una sola:

**¿Esta decisión pertenece a un humano, a un humano asistido o a un sistema
autónomo?**

Este documento es donde se responde.
