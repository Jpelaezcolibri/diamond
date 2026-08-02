# Modelo Operacional de una Inmobiliaria Colombiana

**Estado:** BORRADOR
**Naturaleza:** modelo de referencia. Documento fundacional del programa.
Todo expediente posterior se apoya en este modelo para ubicar de qué actor,
evento o decisión está hablando.

## Premisa

Una inmobiliaria no es un conjunto de procesos. Es un **conjunto de
decisiones humanas que ocurren de forma continua**, tomadas por actores
distintos, con información incompleta, bajo riesgo, y disparadas por eventos.

Un proceso describe *cómo* se mueve el trabajo. Este modelo describe *quién
decide qué, cuándo, con qué información y con qué consecuencia si se
equivoca*. El negocio, visto así, es una cadena de decisiones tipo go/no-go
encadenadas: cada actor recibe un evento, decide, y su decisión se convierte
en el evento que dispara la decisión del siguiente.

Este documento tiene tres partes:

1. **Catálogo de actores** — para cada actor, su lógica de decisión.
2. **Mapa de eventos** — la secuencia de hechos, sin describir procesos.
3. **Grafo de decisión** — Actor → Evento → Decisión → Información → Resultado.

---

## Parte 1 — Catálogo de actores

Para cada actor se describe: objetivos, responsabilidades, información que
necesita e información que genera. Sus decisiones se presentan en una tabla
que integra —por decisión— frecuencia, riesgo de equivocarse, consecuencia
de una mala decisión, evento que la dispara y evidencia que utiliza.

---

### 1. Propietario

- **Objetivos:** obtener el mejor precio o canon, minimizar el tiempo con el inmueble improductivo y el riesgo de impago o deterioro, conservar tranquilidad y control.
- **Responsabilidades:** entregar el inmueble en condiciones, aportar documentación, fijar el precio de reserva, autorizar reparaciones, aceptar o rechazar ofertas y candidatos.
- **Información que necesita:** valor real de mercado, tiempo esperado de colocación, reputación de quien lo representa, perfil del candidato/comprador, estado de sus pagos.
- **Información que genera:** el mandato, el precio deseado y las condiciones (mascotas, plazos, restricciones), la documentación del inmueble, las autorizaciones.

| Decisión | Frecuencia | Riesgo | Consecuencia de errar | Evento disparador | Evidencia que usa |
|---|---|---|---|---|---|
| Elegir a quién confía el inmueble y en qué modalidad (exclusiva/abierta) | Una vez por inmueble | Medio | Gestión mediocre, tiempo perdido | Decide vender o arrendar | Referidos, reputación, comisión propuesta |
| Fijar el precio o canon de salida | Al inicio y en re-precios | Alto | Sobreprecio → inmueble parado; subprecio → pérdida patrimonial | Recibe valoración | Avalúo, comparables, opinión del captador |
| Aceptar, rechazar o contraofertar una oferta | Por oferta (baja) | Alto | Perder un buen comprador o cerrar mal | Llega una oferta | Monto, condiciones, su propia urgencia |
| Aprobar o rechazar un candidato arrendatario | Por candidato | Alto | Impago o daño del inmueble | Resultado del estudio | Estudio de crédito, garantías |
| Autorizar una reparación y su monto | Recurrente | Bajo-medio | Sobrecosto o inmueble deteriorado | Solicitud de reparación | Cotización, foto, historial |
| Renovar o incrementar el canon | Anual | Medio | Perder al arrendatario o resignar ingreso | Vencimiento del contrato | IPC, mercado, comportamiento de pago |

---

### 2. Comprador

- **Objetivos:** adquirir el inmueble adecuado en las mejores condiciones, evitar sobreprecio y riesgo legal, cerrar con una financiación viable.
- **Responsabilidades:** definir presupuesto y criterios, aportar documentos para el crédito, hacer la oferta, cumplir la promesa, pagar.
- **Información que necesita:** inventario disponible, precios reales, estado legal del inmueble, su capacidad de endeudamiento, costos de cierre.
- **Información que genera:** criterios de búsqueda, la oferta, sus documentos financieros, las decisiones de visita.

| Decisión | Frecuencia | Riesgo | Consecuencia de errar | Evento disparador | Evidencia que usa |
|---|---|---|---|---|---|
| Definir presupuesto y criterios | Una vez (se ajusta) | Medio | Buscar lo que no puede o no necesita | Decide comprar | Ahorros, preaprobación, necesidades |
| Solicitar una visita | Por inmueble de interés | Bajo | Perder tiempo | Ve una publicación | Fotos, precio, ubicación |
| Hacer una oferta y por cuánto | Por inmueble finalista | Alto | Sobrepagar o perder el inmueble | Visita convincente | Comparables, estado, urgencia percibida |
| Aceptar las condiciones del crédito | Al aprobarse | Alto | Sobreendeudamiento | Aprobación bancaria | Tasa, cuota, plazo |
| Firmar la promesa o desistir | Momento clave | Muy alto | Perder las arras | Acuerdo de precio | Estudio de títulos, avalúo bancario |

---

### 3. Arrendatario

- **Objetivos:** conseguir un inmueble adecuado, pasar el estudio, minimizar costos de entrada, vivir tranquilo.
- **Responsabilidades:** aportar documentos, conseguir garantías, pagar el canon, cuidar el inmueble, entregarlo bien al final.
- **Información que necesita:** inventario, canon más costos ocultos (administración, servicios), requisitos del estudio, condiciones del contrato.
- **Información que genera:** la solicitud, sus documentos, las garantías, los reportes de daños.

| Decisión | Frecuencia | Riesgo | Consecuencia de errar | Evento disparador | Evidencia que usa |
|---|---|---|---|---|---|
| Elegir qué inmueble solicitar | Por búsqueda | Medio | Comprometerse con lo inadecuado | Ve una publicación | Canon, ubicación, fotos |
| Presentar aplicación y garante | Al decidirse | Medio | Rechazo, perder la opción | Inmueble disponible | Requisitos, su propio perfil |
| Aceptar el contrato y sus condiciones | Al aprobarse | Alto | Cláusulas desfavorables | Aprobación del estudio | Contrato, inventario de entrada |
| Reportar o asumir una reparación | Recurrente | Bajo | Conflicto sobre responsabilidad | Ocurre un daño | Contrato (quién responde) |
| Renovar o desocupar | Anual / fin de contrato | Medio | Pagar de más o mudarse mal | Vencimiento o incremento | Nuevo canon, alternativas |

---

### 4. Captador

- **Objetivos:** sumar inventario vendible/arrendable de calidad, idealmente exclusivo, a precio correcto.
- **Responsabilidades:** prospectar propietarios, valorar el inmueble, negociar el mandato y el precio, recolectar la documentación, armar la ficha.
- **Información que necesita:** prospectos de propietarios, comparables de precio, estado documental, demanda de la zona.
- **Información que genera:** la ficha del inmueble, un avalúo comercial estimado, el mandato firmado, las condiciones.

| Decisión | Frecuencia | Riesgo | Consecuencia de errar | Evento disparador | Evidencia que usa |
|---|---|---|---|---|---|
| Perseguir o descartar un propietario/inmueble | Diaria | Medio | Llenar el inventario de propiedades imposibles | Llega un prospecto de propietario | Zona, precio pretendido, documentación |
| Recomendar el precio de salida | Por captación | Alto | Inmueble parado o subvalorado | Valoración | Comparables, estado, tiempo de mercado |
| Exigir exclusividad o aceptar mandato abierto | Por captación | Medio | Competir contra sí mismo o perder al propietario | Negociación del mandato | Interés del propietario, competencia |
| Aceptar documentación incompleta o exigirla | Por captación | Medio | Problemas legales al cerrar | Recolección de documentos | Checklist legal |

---

### 5. Asesor Comercial

- **Objetivos:** convertir leads en cierres, maximizar comisión, dejar clientes satisfechos.
- **Responsabilidades:** atender y calificar leads, agendar y hacer visitas, dar seguimiento, negociar ofertas, acompañar el cierre.
- **Información que necesita:** inventario y su estado, perfil y necesidad del lead, historial de la interacción, disponibilidad de visita, condiciones del propietario.
- **Información que genera:** el registro de la interacción, la calificación del lead, la agenda, las ofertas, el feedback de cada visita.

| Decisión | Frecuencia | Riesgo | Consecuencia de errar | Evento disparador | Evidencia que usa |
|---|---|---|---|---|---|
| A qué lead atender primero | Constante (horaria) | Alto | Perder un lead caliente por demora | Entra un lead | Canal, mensaje, urgencia, presupuesto |
| Calificar el lead (caliente/frío/descartar) | Por lead | Medio | Malgastar tiempo o descartar uno bueno | Primera conversación | Respuestas, presupuesto, timing |
| Qué inmuebles mostrar | Por lead | Medio | Mostrar lo inadecuado y enfriar | Lead calificado | Necesidad vs. inventario |
| Agendar o reagendar la visita | Por interés | Bajo-medio | No-show, pérdida de impulso | Interés confirmado | Disponibilidad de ambas partes |
| Recomendar aceptar o contraofertar | Por oferta | Alto | Matar el negocio o dejar dinero sobre la mesa | Llega una oferta | Distancia de precio, ánimo del propietario, otras ofertas |
| Cuándo y cómo hacer seguimiento | Diaria | Medio | Enfriar un lead vivo | Silencio del cliente | Última interacción, etapa del negocio |

---

### 6. Coordinador Comercial

- **Objetivos:** que el equipo cumpla metas, repartir la carga, evitar que un lead o un negocio se caiga por gestión.
- **Responsabilidades:** asignar leads, supervisar el pipeline, resolver conflictos (doble atención, comisiones), acompañar al equipo, reportar a gerencia.
- **Información que necesita:** volumen y fuente de leads, capacidad y desempeño de cada asesor, estado del pipeline, metas.
- **Información que genera:** las reglas de asignación, los reportes de pipeline, las resoluciones de conflicto, el pronóstico.

| Decisión | Frecuencia | Riesgo | Consecuencia de errar | Evento disparador | Evidencia que usa |
|---|---|---|---|---|---|
| A qué asesor asignar cada lead | Continua | Medio-alto | Lead a un asesor saturado o inadecuado | Entra un lead | Carga, especialidad, zona, desempeño |
| Reasignar un negocio estancado | Por caso | Medio | Quitarle a quien lo trabajó o dejarlo morir | Negocio sin movimiento | Días sin avance, feedback |
| Resolver conflicto de comisión o doble atención | Esporádica | Alto | Injusticia, daño al clima | Dos asesores reclaman el mismo cliente | Registro de quién contactó primero |
| Intervenir en una negociación difícil | Por caso | Medio | Empeorar el cierre | El asesor no logra cerrar | Historial del negocio |
| Ajustar el foco del equipo (qué inventario empujar) | Semanal | Medio | Empujar lo que no rota | Inventario parado o meta atrasada | Reporte de inventario y ventas |

---

### 7. Marketing

- **Objetivos:** generar flujo suficiente de leads calificados al menor costo posible y dar rotación al inventario.
- **Responsabilidades:** producir contenido, publicar en los canales, gestionar la pauta, medir el origen de los leads.
- **Información que necesita:** qué inventario promover y con qué prioridad, el presupuesto, el desempeño por canal, el perfil de la demanda.
- **Información que genera:** publicaciones, campañas, métricas de costo por lead, reportes por canal.

| Decisión | Frecuencia | Riesgo | Consecuencia de errar | Evento disparador | Evidencia que usa |
|---|---|---|---|---|---|
| Qué inmuebles promover y con qué prioridad | Diaria/semanal | Medio | Gastar en lo que no rota o no importa | Nuevo inventario o inmueble parado | Antigüedad, exclusividad, margen |
| Cómo repartir el presupuesto entre canales | Semanal/mensual | Alto | Quemar presupuesto sin generar leads | Cierre de periodo o caída de flujo | Costo por lead histórico, conversión |
| Cuándo pausar, repautar o bajar el precio de un anuncio | Por inmueble | Medio | Sostener un anuncio muerto | Anuncio sin interacción | Métricas del anuncio |
| Qué mensaje o creativo usar | Por campaña | Bajo-medio | Bajo alcance o leads no calificados | Nueva campaña | Qué funcionó antes, atributos del inmueble |

---

### 8. Gerente

- **Objetivos:** rentabilidad y crecimiento sostenibles, reputación, retención de propietarios y de equipo, control del riesgo.
- **Responsabilidades:** fijar estrategia y metas, precios y comisiones, contratación, inversión, control financiero y de riesgo, relaciones clave.
- **Información que necesita:** estado financiero (ingresos, cartera, gastos), desempeño comercial, satisfacción de propietarios, estado del mercado.
- **Información que genera:** metas, políticas, presupuestos, decisiones de inversión y de personal.

| Decisión | Frecuencia | Riesgo | Consecuencia de errar | Evento disparador | Evidencia que usa |
|---|---|---|---|---|---|
| Fijar o ajustar comisiones e incentivos | Esporádica | Alto | Desmotivar al equipo o romper el margen | Cambio de mercado o rotación | Márgenes, comparación interna, rotación |
| Cuánto invertir en marketing y en tecnología | Mensual/trimestral | Alto | Gastar sin retorno o quedarse corto | Cierre de periodo | Retorno, flujo de caja |
| Contratar o desvincular | Esporádica | Alto | Costo hundido o brecha de capacidad | Brecha de capacidad o bajo desempeño | Desempeño, carga |
| En qué zonas o segmentos crecer | Trimestral | Alto | Invertir donde no hay negocio | Saturación u oportunidad | Demanda, competencia, márgenes |
| Aceptar o soltar un propietario/negocio problemático | Por caso | Medio | Cargar con un cliente que resta | Conflicto o riesgo detectado | Historial, rentabilidad del cliente |
| Cómo priorizar la cartera vencida y el riesgo | Mensual | Alto | Dejar crecer la mora | Reporte de cartera | Aging, garantías |

---

### 9. Administración

- **Objetivos:** que el portafolio administrado funcione sin fricción: recaudo puntual, propietarios pagados, inmuebles mantenidos.
- **Responsabilidades:** recaudo de cánones, pago a propietarios, gestión de reparaciones, renovaciones, novedades de contrato, atención operativa.
- **Información que necesita:** cartera (quién debe), calendario de pagos, solicitudes de reparación, estado de los contratos, autorizaciones.
- **Información que genera:** liquidaciones a propietarios, recibos, órdenes de reparación, novedades, reportes de cartera.

| Decisión | Frecuencia | Riesgo | Consecuencia de errar | Evento disparador | Evidencia que usa |
|---|---|---|---|---|---|
| A quién cobrar, en qué orden y cómo | Diaria (pico en el corte) | Medio | La cartera crece | Vencimiento del canon | Aging, historial del arrendatario |
| Cuándo escalar una mora a cobro jurídico | Por caso | Alto | Perder tiempo o perder la recuperación | Mora prolongada | Días de mora, garantía, respuesta |
| Autorizar una reparación y elegir proveedor | Recurrente | Medio | Sobrecosto o mala obra | Reporte de daño | Cotización, contrato, historial del proveedor |
| Aprobar la liquidación mensual al propietario | Mensual | Alto | Pagar mal y perder la confianza | Corte de mes | Recaudo, deducciones, contrato |
| Gestionar la renovación o el incremento | Anual por contrato | Medio | Perder al arrendatario o resignar ingreso | Vencimiento del contrato | IPC, mercado, comportamiento |

---

### 10. Contabilidad

- **Objetivos:** registros correctos, cumplimiento tributario, información financiera confiable y a tiempo.
- **Responsabilidades:** registrar ingresos y egresos, conciliar bancos, liquidar impuestos y retenciones, generar estados financieros, facturar.
- **Información que necesita:** movimientos de recaudo y pagos, facturas de proveedores, comisiones, normativa tributaria vigente.
- **Información que genera:** asientos, conciliaciones, estados financieros, declaraciones, facturas.

| Decisión | Frecuencia | Riesgo | Consecuencia de errar | Evento disparador | Evidencia que usa |
|---|---|---|---|---|---|
| Cómo clasificar y registrar una transacción | Diaria | Medio | Error contable que se arrastra | Ocurre un movimiento | Soporte, comprobante |
| Qué retención o impuesto aplicar | Por transacción | Alto | Sanción tributaria | Un pago o una factura | Normativa, tipo de tercero |
| Reconocer o provisionar cartera/gasto | Periódica | Medio | Estados financieros distorsionados | Cierre contable | Aging, contratos |
| Validar antes de autorizar un pago | Por pago | Alto | Pagar de más o indebidamente | Solicitud de pago | Soporte, disponibilidad, autorización |

---

### 11. Abogado

- **Objetivos:** minimizar el riesgo legal, contratos sólidos, recuperar inmuebles o cartera cuando algo falla, cumplimiento normativo.
- **Responsabilidades:** revisar y redactar contratos, estudio de títulos, procesos de restitución y cobro, conceptos legales, defensa.
- **Información que necesita:** documentos del inmueble y de las partes, el contrato, el historial del conflicto, la normativa vigente.
- **Información que genera:** contratos, conceptos, estudios de títulos, demandas y acuerdos.

| Decisión | Frecuencia | Riesgo | Consecuencia de errar | Evento disparador | Evidencia que usa |
|---|---|---|---|---|---|
| Aprobar o frenar un negocio por riesgo legal | Por caso | Alto | Cerrar sobre un vicio oculto | Estudio de títulos o de las partes | Certificado de tradición, documentos |
| Cómo redactar una cláusula o condición especial | Por contrato | Medio-alto | Dejar a la inmobiliaria expuesta | Contrato nuevo o situación especial | Normativa, riesgo específico |
| Iniciar o no una acción legal (restitución/cobro) | Por caso | Alto | Gastar más de lo recuperable, o no recuperar | Incumplimiento | Mora, garantías, viabilidad procesal |
| Recomendar acuerdo o litigio | Por caso | Medio | Alargar o perder el conflicto | Conflicto activo | Probabilidad de éxito, costos |

---

### 12. Proveedores

*(mantenimiento, avalúo, fotografía, cerrajería, etc.)*

- **Objetivos:** ganar y retener trabajo, cobrar a tiempo, ejecutar dentro de su margen.
- **Responsabilidades:** cotizar, ejecutar el servicio, responder por la obra.
- **Información que necesita:** el alcance del trabajo, acceso al inmueble, aprobación y presupuesto, plazos.
- **Información que genera:** la cotización, la factura, el reporte de entrega, su disponibilidad.

| Decisión | Frecuencia | Riesgo | Consecuencia de errar | Evento disparador | Evidencia que usa |
|---|---|---|---|---|---|
| Aceptar o no el trabajo y a qué precio | Por solicitud | Bajo-medio | Cotizar mal, no llegar a tiempo | Solicitud de cotización | Alcance, historial de pago |
| Cómo y cuándo ejecutar | Por trabajo | Medio | Mala obra que afecta al inmueble | Orden aprobada | Diagnóstico, acceso |

*(Desde la óptica de la inmobiliaria, la decisión asociada es la selección y el control del proveedor.)*

---

### 13. Aseguradora / Afianzadora

- **Objetivos:** suscribir riesgo rentable, minimizar siniestros y fraude, pagar solo lo cubierto.
- **Responsabilidades:** estudiar candidatos arrendatarios, emitir póliza o fianza, gestionar reclamaciones, cubrir impago o daños según el contrato.
- **Información que necesita:** perfil del candidato (ingresos, historial crediticio, referencias), datos del inmueble y del contrato, evidencia del siniestro.
- **Información que genera:** el resultado del estudio, la póliza, las decisiones sobre reclamaciones.

| Decisión | Frecuencia | Riesgo | Consecuencia de errar | Evento disparador | Evidencia que usa |
|---|---|---|---|---|---|
| Aprobar, negar o condicionar un arrendatario | Por solicitud | Alto | Negar a uno bueno o aprobar a uno malo | Llega la solicitud de estudio | Score crediticio, ingresos, referencias |
| Fijar condiciones y prima | Por póliza | Medio | Prima mal calibrada al riesgo | Aprobación del candidato | Nivel de riesgo del perfil |
| Aceptar, rechazar o pagar una reclamación | Por siniestro | Alto | Pagar lo que no cubre o negar lo cubierto | Reporte de impago o daño | Soportes, cumplimiento de condiciones |

---

### 14. Banco

- **Objetivos:** colocar crédito rentable con riesgo controlado, minimizar la cartera vencida.
- **Responsabilidades:** estudiar la capacidad de pago, avaluar la garantía, aprobar y desembolsar el crédito, gestionar la hipoteca.
- **Información que necesita:** perfil financiero del comprador (ingresos, historial, endeudamiento), avalúo del inmueble, estudio de títulos.
- **Información que genera:** preaprobación, avalúo, condiciones (tasa/plazo/monto), aprobación y desembolso.

| Decisión | Frecuencia | Riesgo | Consecuencia de errar | Evento disparador | Evidencia que usa |
|---|---|---|---|---|---|
| Preaprobar o no, y por cuánto | Por solicitud | Alto | Habilitar o matar la compra | Solicitud de crédito | Ingresos, centrales de riesgo, endeudamiento |
| Aceptar la garantía (avalúo y títulos) | Por operación | Alto | Prestar sobre una garantía débil | Avalúo y estudio de títulos | Avalúo, certificado de tradición |
| Fijar tasa, plazo y condiciones | Por aprobación | Medio | Precio del riesgo mal calibrado | Aprobación | Perfil de riesgo, políticas internas |
| Desembolsar o frenar | Momento del cierre | Alto | Desembolsar sobre un cierre defectuoso | Firma de escritura e hipoteca | Registro, pólizas, cumplimiento de condiciones |

---

## Parte 2 — Mapa de eventos

Solo eventos: hechos que ocurren y que disparan la decisión de algún actor.
No se describe el trabajo intermedio. El negocio corre por varios flujos que
se conectan entre sí.

### Flujo A — Captación (entra el inventario)

```
Propietario decide vender o arrendar
      ↓
Contacta (o es contactado por) la inmobiliaria
      ↓
Se valora el inmueble
      ↓
Se acuerdan precio y mandato
      ↓
Se firma el encargo
      ↓
Se recolecta la documentación
      ↓
El inmueble queda listo para publicar
```

### Flujo B — Demanda (entra el interesado)

```
El inmueble se publica
      ↓
El anuncio recibe interacción
      ↓
Se genera un lead
      ↓
El lead entra a la inmobiliaria
```

### Flujo C — Venta

```
Lead entra → Lead calificado → Visita agendada → Visita realizada
      ↓
Interés confirmado → Oferta presentada → Negociación → Oferta aceptada
      ↓
Solicitud de crédito → Preaprobación → Estudio de títulos → Avalúo bancario
      ↓
Promesa firmada → Crédito aprobado → Escrituración → Registro
      ↓
Entrega del inmueble → Pago de comisión → Postventa
```

### Flujo D — Arriendo (colocación)

```
Lead entra → Lead calificado → Visita → Interés confirmado
      ↓
Aplicación del candidato → Estudio del arrendatario → Resultado del estudio
      ↓
Aprobación del propietario → Firma del contrato → Inventario de entrada
      ↓
Entrega de llaves → Inicia la administración
```

### Flujo E — Administración (recurrente, mientras dura el contrato)

```
Vence el canon → Se recauda → (¿Mora?) → Se liquida al propietario → Se paga al propietario

En paralelo:
Se reporta un daño → Se cotiza → Se autoriza → Se repara → Se paga al proveedor

Anual:
Vence el contrato → Renovación/incremento  ó  Desocupación → Inventario de salida → Devolución
```

### Flujo F — Conflicto / legal (cuando algo falla)

```
Incumplimiento (impago, daño o no desocupa)
      ↓
Reclamación a la aseguradora  /  Gestión de cobro
      ↓
Escalamiento a cobro jurídico
      ↓
Proceso de restitución o recuperación
```

Los flujos no son independientes: el evento final de A ("listo para
publicar") es el evento inicial de B; el de B ("lead entra") es el inicial de
C y D; el de D ("inicia administración") es el inicial de E; y E deriva a F
cuando hay incumplimiento.

---

## Parte 3 — Decisión inmediata tras cada evento

Cada evento existe porque obliga a alguien a decidir algo enseguida. Esta
tabla hace explícito ese acoplamiento evento → decisión → actor.

| Evento | Decisión inmediata que dispara | Actor que decide |
|---|---|---|
| Propietario decide vender/arrendar | ¿A quién le confío el inmueble y en qué modalidad? | Propietario |
| Contacta a la inmobiliaria | ¿Persigo o descarto este inmueble? | Captador |
| Se valora el inmueble | ¿A qué precio salgo? | Propietario (con recomendación del captador) |
| Se firma el encargo | ¿La documentación alcanza para publicar sin riesgo? | Captador / Abogado |
| El inmueble queda listo | ¿Lo promuevo, con qué prioridad y en qué canal? | Marketing |
| Se genera un lead | ¿A qué asesor lo asigno? | Coordinador Comercial |
| El lead entra al asesor | ¿Lo atiendo ya o después? ¿Está caliente? | Asesor Comercial |
| Lead calificado | ¿Qué inmuebles le muestro? | Asesor Comercial |
| Interés confirmado | ¿Cuándo y cómo agendo la visita? | Asesor Comercial |
| Visita realizada | ¿Sigo, insisto o descarto? ¿Cómo hago seguimiento? | Asesor Comercial |
| Oferta presentada | ¿Acepto, rechazo o contraofertó? | Propietario (asesorado) |
| Oferta aceptada (venta) | ¿Solicito crédito? ¿Por cuánto? | Comprador |
| Solicitud de crédito | ¿Preapruebo y por cuánto? | Banco |
| Estudio de títulos | ¿El negocio es legalmente viable? | Abogado / Banco |
| Promesa firmada | ¿Desembolso o freno? | Banco |
| Aplicación del candidato (arriendo) | ¿Apruebo, niego o condiciono? | Aseguradora |
| Resultado del estudio | ¿Acepto a este arrendatario? | Propietario |
| Firma del contrato | ¿Qué cláusulas y condiciones? | Abogado |
| Vence el canon | ¿A quién cobro, en qué orden? | Administración |
| Mora prolongada | ¿Escalo a cobro jurídico? | Administración / Abogado |
| Se reporta un daño | ¿Autorizo la reparación, con qué proveedor y monto? | Administración / Propietario |
| Corte de mes | ¿La liquidación al propietario está correcta? | Administración / Contabilidad |
| Vence el contrato | ¿Renuevo, incremento o dejo ir? | Propietario / Administración |
| Incumplimiento | ¿Inicio acción legal o negocio un acuerdo? | Abogado |

---

## Parte 4 — Grafo de decisión

Cadenas de la forma **Actor → Evento → Decisión → Información requerida →
Resultado esperado**. Cada fila es una arista del grafo; el "resultado
esperado" de una fila suele ser el "evento" que activa otra, lo que teje el
negocio completo.

| Actor | Evento | Decisión | Información requerida | Resultado esperado |
|---|---|---|---|---|
| Captador | Contacto de un propietario | Perseguir o descartar | Zona, precio pretendido, documentación | Inmueble entra (o no) al pipeline de captación |
| Propietario | Valoración recibida | Fijar precio de salida | Avalúo, comparables, urgencia propia | Precio definido y publicable |
| Marketing | Inmueble listo | Qué promover y en qué canal | Prioridad del inventario, costo por lead por canal | Publicación activa que genera interacción |
| Coordinador | Lead generado | A qué asesor asignarlo | Carga, especialidad y desempeño de cada asesor | Lead en manos del asesor adecuado |
| Asesor | Lead recibido | Priorizar y calificar | Canal, mensaje, presupuesto, urgencia | Lead clasificado y atendido a tiempo |
| Asesor | Lead calificado | Qué inmuebles mostrar y agendar visita | Necesidad del lead vs. inventario, disponibilidad | Visita realizada con interés real |
| Comprador | Visita convincente | Hacer oferta y monto | Comparables, estado del inmueble, urgencia percibida | Oferta presentada al propietario |
| Propietario | Oferta recibida | Aceptar, rechazar o contraofertar | Monto, condiciones, otras ofertas, su urgencia | Acuerdo de precio (o negocio caído) |
| Banco | Solicitud de crédito | Preaprobar y por cuánto | Ingresos, centrales de riesgo, endeudamiento | Comprador con capacidad confirmada |
| Abogado | Estudio de títulos | Aprobar o frenar por riesgo legal | Certificado de tradición, documentos de las partes | Negocio legalmente habilitado |
| Banco | Promesa firmada | Desembolsar o frenar | Registro, pólizas, cumplimiento de condiciones | Recursos disponibles para escriturar |
| Aseguradora | Aplicación de arrendatario | Aprobar, negar o condicionar | Score crediticio, ingresos, referencias | Candidato viable con garantía |
| Propietario | Resultado del estudio | Aceptar al arrendatario | Estudio, garantías, condiciones | Contrato habilitado |
| Abogado | Contrato a firmar | Qué cláusulas y condiciones | Normativa, riesgo específico del caso | Contrato que protege a las partes |
| Administración | Vencimiento del canon | A quién cobrar y cómo | Aging de cartera, historial del arrendatario | Recaudo puntual |
| Administración | Reporte de daño | Autorizar reparación y proveedor | Cotización, contrato, historial del proveedor | Inmueble mantenido sin sobrecosto |
| Administración | Corte de mes | Aprobar la liquidación al propietario | Recaudo, deducciones, contrato | Propietario pagado correctamente y a tiempo |
| Contabilidad | Solicitud de pago | Validar antes de pagar | Soporte, disponibilidad, autorización | Pago correcto y respaldado |
| Administración | Mora prolongada | Escalar a cobro jurídico | Días de mora, garantía, respuesta | Recuperación iniciada a tiempo |
| Abogado | Incumplimiento | Acción legal o acuerdo | Mora, garantías, viabilidad procesal | Inmueble o cartera recuperados |
| Gerente | Reporte de cartera/periodo | Priorizar riesgo e inversión | Estado financiero, desempeño, mercado | Recursos dirigidos donde rinden |

---

## Lecturas del modelo (solo observación)

Del modelo, sin proponer nada, se desprende:

- **El negocio es una cadena de decisiones go/no-go acopladas.** El resultado
  de una decisión es el evento que dispara la siguiente. Un eslabón lento o
  mal decidido no solo pierde su propio valor: bloquea toda la cadena aguas
  abajo.
- **El riesgo no está repartido de forma uniforme.** Se concentra en unas
  pocas "compuertas" de alto riesgo y baja frecuencia: fijar el precio,
  aceptar una oferta, aprobar un arrendatario, aprobar un crédito, escriturar,
  escalar una mora. Ahí una sola decisión mueve mucho dinero.
- **Casi todas las decisiones se toman con información incompleta.** El actor
  decide con la evidencia que tiene a mano, no con la que idealmente
  necesitaría; la calidad de la evidencia disponible es, en la práctica, el
  techo de la calidad de la decisión.
- **Muchos actores clave son externos** (banco, aseguradora, abogado,
  proveedores) y deciden con su propia lógica y sus propios tiempos; la
  inmobiliaria depende de decisiones que no controla.
- **Las decisiones se agrupan en dos regímenes distintos:** las
  transaccionales de la venta/arriendo (alto valor, baja frecuencia, ciclo
  largo) y las recurrentes de la administración (bajo valor unitario, alta
  frecuencia, repetición constante). Son negocios con física muy diferente
  conviviendo bajo el mismo techo.

Estas lecturas son observaciones del modelo, no conclusiones de mercado ni
recomendaciones. Su verificación con evidencia y su priorización pertenecen
a los expedientes de investigación del Nivel 1.
