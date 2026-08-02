# SOFI — Backlog de Experiencia (priorizado por ROI)

**Estado:** BORRADOR — Backlog de ejecución, no documento de visión
**Rol:** Product Lead
**Principio rector permanente:** la pregunta deja de ser "¿qué puede responder
SOFI?" y pasa a ser **"¿qué debería ocurrir automáticamente sin que el usuario
lo pida?"**
**Métrica única de evaluación:** *cuántas acciones útiles inició SOFI sin que el
usuario tuviera que pedirlas.* Toda propuesta de aquí en adelante se acepta solo
si sube ese número.

Regla de disciplina: cada ítem se dispara con un **evento o un momento que la
arquitectura ya produce hoy** (entra un mensaje, se sincroniza inventario, el
usuario abre/cierra su sesión, se cruza un estado). Ninguno agrega tablas, APIs,
motores ni herramientas. La única pieza de plomería que *no* existe es un
temporizador que despierte solo sin evento ni usuario presente; los dos ítems
que la desearían (EXP-004, EXP-003) están marcados con su versión **libre de
plomería** en scope y el temporizador como dependencia opcional a decidir aparte.

---

## Tabla maestra (orden = ROI para inmobiliaria de 1–5 asesores)

| # | Mejora | Área | Disparador | Valor usuario | Valor comercial | Complejidad | Prioridad | Acciones/día que aporta a la métrica* |
|---|---|---|---|---|---|---|---|---|
| EXP-001 | Briefing inteligente de inicio de jornada | 1 | Asesor abre sesión | Muy Alto | Muy Alto | Baja | **P0** | 1 (universal) |
| EXP-002 | Respuesta anticipada al lead nuevo | 2 | Entra lead / se completan sus datos | Muy Alto | Muy Alto | Media | **P0** | 3–5 |
| EXP-003 | Rescate de lead caliente enfriándose | 2 | Lead score≥70 sin actividad ≥N días | Muy Alto | Muy Alto | Baja | **P0** | 1–3 |
| EXP-004 | Cita con todo listo | 2 | Cita próxima (`leads.cita`) | Alto | Alto | Baja | **P1** | 1–2 |
| EXP-005 | Aviso de cambio en propiedad de interés | 2 | `property_change_events` (precio/estado) | Alto | Alto | Baja | **P1** | 0–2 |
| EXP-006 | Cierre de jornada + siembra del día siguiente | 4 | Asesor cierra sesión / fin de día | Alto | Medio | Baja | **P1** | 1 |
| EXP-007 | Panorama por excepción del administrador | 1 | Admin abre sesión | Alto | Alto | Baja | **P1** | 1 (admin) |
| EXP-008 | Detección de cuello de botella del pipeline | 1 | Umbral de leads estancados en un estado | Medio | Alto | Baja | **P2** | 0–1 (admin) |
| EXP-009 | Inventario nuevo que calza con clientes del equipo | 3 | Sync agrega/actualiza propiedad | Medio→Alto** | Alto | Media | **P2** | 0–3 |
| EXP-010 | Propiedad de colega que resuelve al cliente de otro asesor | 3 | Se registra propiedad de colega | Medio→Alto** | Alto | Media | **P2** | 0–2 |
| EXP-011 | Emparejamiento comprador ↔ propietario | 3 | Entra/actualiza lead vendedor o comprador | Medio→Alto** | Muy Alto | Media | **P2** | 0–2 |
| EXP-012 | Contexto de objeciones al preparar el mensaje | 3 | Asesor va a contactar sobre una propiedad | Medio | Medio | Baja | **P3** | 0–2 |
| EXP-013 | Siguiente mejor acción tras cada interacción | 2 | Fin de cada interacción (contexto activo) | Medio | Medio | Baja | **P3** | 2–4 |

\* Estimación de acciones no solicitadas que SOFI inicia por asesor y por día —
la métrica. Suma potencial de un asesor activo: **~12–20 acciones/día que hoy
nadie dispara.**
\*\* Los tres ítems de conocimiento compartido (009–011) valen poco con 1 asesor
y **suben fuerte hacia 3–5 asesores**: son los que hacen que el trabajo de uno
mejore automáticamente el de otro. En una agencia de 1 persona, bajan a P3.

---

## Área 1 — Inicio de jornada
> *Contexto, no dashboards: lo primero que SOFI dice ya es lo que hay que hacer.*

### EXP-001 · Briefing inteligente de inicio de jornada
- **Acción que inicia SOFI:** al abrir sesión, sin que nadie pregunte, entrega
  el parte del día ordenado por urgencia (pendientes de seguimiento, cita de
  hoy, lead caliente frío) y propone por dónde empezar.
- **1. Evento disparador:** el asesor abre su primera sesión del día
  (`command_sessions`).
- **2. Info que ya existe:** `cmd_seguimientos`, `cmd_metricas_leads`,
  `leads.cita`, contexto activo.
- **3. Decisión que ayuda a tomar:** por dónde empezar el día.
- **4. Tiempo que ahorra:** 10–15 min/día de organización manual.
- **5. Riesgo que evita:** arrancar por lo último que entró y dejar enfriar lo
  caliente.
- **6. Cómo mejora el día:** elimina el folio en blanco; la primera acción
  comercial ocurre antes.
- **7. Qué reutiliza:** las funciones de consulta y la memoria de sesión, ya
  aprobadas.
- **8. Por qué no requiere motores nuevos:** solo cambia *cuándo* se llaman
  funciones existentes (al abrir sesión) y en qué orden se presenta el
  resultado. Cero plomería.
- **Impacto:** Muy Alto · **Complejidad:** Baja · **Prioridad:** P0 ·
  **Dependencias:** ninguna · **Métrica de éxito:** tiempo hasta la primera
  acción comercial.
- **Justificación ROI:** toca al 100 % de los usuarios el 100 % de los días con
  cero dependencias. Es el mejor retorno posible por sprint invertido.

### EXP-007 · Panorama por excepción del administrador
- **Acción que inicia SOFI:** al abrir sesión el admin, muestra solo lo que se
  sale de lo normal (embudo atascado, asesor con calientes fríos, ritmo de
  ventas bajo el del periodo anterior), no un tablero completo.
- **1. Disparador:** el admin abre sesión.
- **2. Info existente:** `cmd_metricas_ventas` (comparativa), `cmd_embudo`,
  `cmd_seguimientos` agregado por asesor.
- **3. Decisión:** dónde intervenir hoy como dirección.
- **4. Tiempo:** 20–30 min/día de leer tableros buscando el problema.
- **5. Riesgo:** que un problema del pipeline se vea cuando ya costó ventas.
- **6. Mejora:** el admin pasa de operar tableros a decidir sobre excepciones.
- **7. Reutiliza:** las mismas funciones de métricas, ordenadas por desviación.
- **8. Sin motores nuevos:** es un reordenamiento de salidas existentes por
  "distancia a lo normal"; el cálculo ya lo hacen las funciones.
- **Impacto:** Alto · **Complejidad:** Baja · **Prioridad:** P1 ·
  **Dependencias:** ninguna · **Métrica de éxito:** nº de anomalías levantadas
  por SOFI antes de que el admin las buscara.
- **Justificación ROI:** en agencias de 1–5, el admin suele también vender; cada
  minuto suyo es caro. Alto valor, complejidad baja.

### EXP-008 · Detección de cuello de botella del pipeline
- **Acción que inicia SOFI:** cuando un estado del embudo acumula leads
  estancados +N días, lo señala y sugiere a quién preguntarle (sin actuar por su
  cuenta).
- **1. Disparador:** cruce de umbral (evaluado en el briefing admin o al mover
  el kanban).
- **2. Info existente:** `cmd_embudo` + inactividad de `conversations`.
- **3. Decisión:** dónde está frenado el flujo comercial.
- **4. Tiempo:** el de auditar manualmente el kanban.
- **5. Riesgo:** transferencias que nadie atiende → ventas que se caen calladas.
- **6. Mejora:** convierte una revisión que casi nunca se hace en un aviso
  automático.
- **7. Reutiliza:** `cmd_embudo`.
- **8. Sin motores nuevos:** es una comparación contra un umbral sobre una
  salida que ya se calcula.
- **Impacto:** Medio (Alto para el dueño) · **Complejidad:** Baja ·
  **Prioridad:** P2 · **Dependencias:** EXP-007 (comparte el momento admin) ·
  **Métrica de éxito:** atascos detectados y resueltos por semana.

---

## Área 2 — Durante la jornada
> *SOFI recuerda el contexto de todo el día, anticipa lo que se va a perder y
> sugiere el siguiente paso sin que se lo pidan.*

### EXP-002 · Respuesta anticipada al lead nuevo *(el ítem de mayor conversión)*
- **Acción que inicia SOFI:** en cuanto un lead tiene datos suficientes (zona,
  tipo, presupuesto), SOFI **deja ya preparadas** las 2–3 propiedades que le
  calzan y un borrador de mensaje, esperando solo el "envíalo" del asesor.
- **1. Disparador:** entra un lead nuevo o `registrar_dato_lead` completa el
  perfil mínimo.
- **2. Info existente:** `leads` (zona/tipo/presupuesto), `properties.search`,
  `generar_mensaje_cliente`, `contexto_venta` del DCE.
- **3. Decisión:** qué ofrecer y cómo abrir la conversación, ya resuelto.
- **4. Tiempo:** 5–10 min por lead de buscar propiedades y redactar; con 3–5
  leads/día son 20–40 min diarios.
- **5. Riesgo:** la lentitud de respuesta, que es el factor nº1 de pérdida de
  conversión en captación digital.
- **6. Mejora:** el asesor pasa de "tengo que armar la respuesta" a "reviso y
  envío"; velocidad de respuesta al minuto.
- **7. Reutiliza:** el matching de inventario y el generador de mensaje, ambos
  ya definidos; el borrador queda en el contexto activo de la sesión.
- **8. Sin motores nuevos:** el lead ya se procesa en el flujo del bot; SOFI
  encadena dos herramientas existentes al detectar perfil suficiente. El envío
  usa el canal WhatsApp que ya existe, y solo tras confirmación humana (nivel A).
- **Impacto:** Muy Alto · **Complejidad:** Media · **Prioridad:** P0 ·
  **Dependencias:** ninguna · **Métrica de éxito:** minutos entre llegada del
  lead y primer mensaje enviado.
- **Justificación ROI:** ataca directamente la variable que más mueve la
  facturación de una agencia pequeña (velocidad al lead). Segundo mejor ROI solo
  porque depende del flujo de leads, no de todos los días como el briefing.

### EXP-003 · Rescate de lead caliente enfriándose
- **Acción que inicia SOFI:** detecta el lead caliente sin actividad y abre la
  conversación con un borrador de retoma listo: "este lleva 4 días y está
  caliente, ¿le escribimos?".
- **1. Disparador:** lead con score≥70 y sin actividad ≥N días. *Versión en
  scope:* se evalúa al abrir sesión y tras cada interacción (sin plomería).
  *Opcional:* empuje en el momento exacto → requiere temporizador (fuera de la
  regla de cero maquinaria; a decidir aparte).
- **2. Info existente:** `cmd_seguimientos`, `generar_mensaje_cliente`.
- **3. Decisión:** a quién recontactar antes de perderlo.
- **4. Tiempo:** el de revisar manualmente quién se está enfriando (que rara vez
  se hace a tiempo).
- **5. Riesgo:** perder un lead ya calificado por olvido — el más caro de todos.
- **6. Mejora:** ningún caliente se enfría en silencio.
- **7. Reutiliza:** la función de seguimientos y el generador de mensaje.
- **8. Sin motores nuevos:** la versión en scope solo lee `cmd_seguimientos` en
  momentos que ya ocurren (sesión/interacción).
- **Impacto:** Muy Alto · **Complejidad:** Baja · **Prioridad:** P0 ·
  **Dependencias:** ninguna (temporizador opcional para el empuje inmediato) ·
  **Métrica de éxito:** leads calientes recontactados dentro de las 48 h.

### EXP-004 · Cita con todo listo
- **Acción que inicia SOFI:** antes de una cita, deja lista la ficha de la
  propiedad, la ubicación y un borrador de confirmación al cliente.
- **1. Disparador:** cita próxima en `leads.cita`. *Versión en scope:* aparece en
  el briefing del día y al abrir sesión. *Opcional:* recordatorio "1 hora antes"
  → temporizador (a decidir aparte).
- **2. Info existente:** `leads.cita`, `ficha_propiedad` (+ link de landing).
- **3. Decisión:** llegar preparado y confirmar asistencia.
- **4. Tiempo:** 3–5 min de preparar cada cita.
- **5. Riesgo:** llegar sin la ficha o que el cliente no confirme y se pierda el
  desplazamiento.
- **6. Mejora:** el asesor llega a cada visita con todo a mano.
- **7. Reutiliza:** el dato de cita ya capturado y la herramienta de ficha.
- **8. Sin motores nuevos:** la versión en scope lee un campo existente en
  momentos existentes; solo el recordatorio horario querría temporizador.
- **Impacto:** Alto · **Complejidad:** Baja · **Prioridad:** P1 ·
  **Dependencias:** temporizador opcional · **Métrica de éxito:** citas
  confirmadas y cumplidas.

### EXP-005 · Aviso de cambio en propiedad de interés
- **Acción que inicia SOFI:** cuando una propiedad que un cliente miró cambia de
  precio o de estado, avisa al asesor dueño de ese lead: "bajó de precio la que
  le gustó a Marcela, buen momento para retomar".
- **1. Disparador:** `property_change_events` (price_changed / status_changed /
  removed) que produce el sync de DMAP, cruzado con `leads.property_ref_origen`.
- **2. Info existente:** `property_change_events` (ya se generan hoy), `leads`.
- **3. Decisión:** aprovechar una rebaja para reactivar, o avisar antes de que
  el cliente pregunte por algo ya vendido.
- **4. Tiempo:** el de vigilar manualmente cambios de inventario (que nadie
  hace).
- **5. Riesgo:** ofrecer algo que ya no está, o perder el timing de una rebaja.
- **6. Mejora:** el cambio de inventario se convierte en una oportunidad de
  contacto con excusa legítima.
- **7. Reutiliza:** los eventos de cambio que el sync **ya emite** + el vínculo
  lead-propiedad ya existente.
- **8. Sin motores nuevos:** el evento ya se produce en cada corrida de sync;
  SOFI solo lo lee y usa el canal de alerta al asesor que el bot ya dispara en
  las transferencias.
- **Impacto:** Alto · **Complejidad:** Baja · **Prioridad:** P1 ·
  **Dependencias:** que el sync de DMAP esté corriendo (ya lo está) ·
  **Métrica de éxito:** reactivaciones a partir de cambios de precio.

### EXP-013 · Siguiente mejor acción tras cada interacción
- **Acción que inicia SOFI:** al cerrar cada intercambio, propone el próximo
  paso lógico según el contexto activo ("¿le agendamos visita?", "¿le comparto
  la ficha?").
- **1. Disparador:** fin de una interacción con contexto activo (propiedad/lead
  en foco).
- **2. Info existente:** contexto activo + las herramientas de acción (7, 8, 11).
- **3. Decisión:** cuál es el siguiente movimiento comercial.
- **4. Tiempo:** el micro-costo de decidir "y ahora qué".
- **5. Riesgo:** conversaciones que mueren sin siguiente paso.
- **6. Mejora:** cada intercambio empuja el negocio un paso más.
- **7. Reutiliza:** contexto activo + herramientas existentes.
- **8. Sin motores nuevos:** es una sugerencia derivada del estado de la sesión.
- **Impacto:** Medio · **Complejidad:** Baja · **Prioridad:** P3 ·
  **Dependencias:** ninguna · **Métrica de éxito:** interacciones que terminan
  en una acción concreta.

---

## Área 3 — Conocimiento compartido
> *No es un chat de equipo ni un Slack: es que lo que un asesor genera durante
> el día mejore automáticamente el trabajo de los demás, sin que nadie
> reenvíe nada.*

### EXP-009 · Inventario nuevo que calza con clientes del equipo
- **Acción que inicia SOFI:** cuando el sync agrega o actualiza una propiedad,
  SOFI revisa qué leads activos del equipo la estaban buscando y avisa a cada
  asesor dueño: "entró algo que calza con tu cliente de Envigado".
- **1. Disparador:** `property_change_events` de tipo *created* (o vuelta a
  disponible) en el sync.
- **2. Info existente:** la nueva propiedad, `cmd_similares`/matching por
  zona-tipo-precio, `leads` activos por owner.
- **3. Decisión:** ofrecer de inmediato una propiedad recién entrada al cliente
  correcto.
- **4. Tiempo:** el de que cada asesor revise todo el inventario nuevo buscando
  calce (nunca ocurre bien).
- **5. Riesgo:** que una propiedad fresca se publique al mercado antes de
  ofrecerse al cliente que ya la pedía.
- **6. Mejora:** el inventario que trae un asesor/el sync trabaja para todo el
  equipo automáticamente.
- **7. Reutiliza:** eventos de sync + lógica de similitud + leads por owner, todo
  existente.
- **8. Sin motores nuevos:** el evento y el matching ya existen; SOFI los cruza y
  usa el canal de alerta al asesor ya en uso.
- **Impacto:** Medio→Alto (escala con el equipo) · **Complejidad:** Media ·
  **Prioridad:** P2 · **Dependencias:** sync activo · **Métrica de éxito:**
  ofertas hechas dentro de las 24 h de entrar la propiedad.

### EXP-010 · Propiedad de colega que resuelve al cliente de otro asesor
- **Acción que inicia SOFI:** cuando un asesor registra una propiedad de colega,
  SOFI la cruza contra los leads activos del equipo y avisa al dueño del lead que
  calza — siempre marcada *pendiente de validación*, con los datos del colega y
  la acción "contactar colega".
- **1. Disparador:** `registrar_propiedad_colega` crea una `ally_property`.
- **2. Info existente:** `ally_properties`, `cmd_memoria_mercado_match`, `leads`
  activos.
- **3. Decisión:** verificar disponibilidad con el colega para un cliente
  concreto de otro asesor.
- **4. Tiempo:** el de que la inteligencia de calle de un asesor llegue a otro
  (hoy: nunca, salvo que se lo cuente de pasillo).
- **5. Riesgo:** perder una venta de red por no cruzar lo que un compañero ya
  sabía.
- **6. Mejora:** convierte un dato individual en conocimiento del equipo sin
  reuniones ni reenvíos.
- **7. Reutiliza:** toda la Memoria de Mercado y su matching, ya diseñados.
- **8. Sin motores nuevos:** el registro y el match ya existen; SOFI encadena el
  match tras el registro y avisa por el canal existente. Respeta las reglas
  duras de la Red de Colegas (nunca inventario propio, nunca promete).
- **Impacto:** Medio→Alto (escala con el equipo) · **Complejidad:** Media ·
  **Prioridad:** P2 · **Dependencias:** ninguna · **Métrica de éxito:**
  coincidencias de red enrutadas al asesor correcto.

### EXP-011 · Emparejamiento comprador ↔ propietario
- **Acción que inicia SOFI:** al entrar o actualizarse un lead vendedor
  (`intencion = vender`) o comprador, SOFI cruza vendedores contra compradores
  del equipo por zona/tipo/rango y sugiere el match al asesor.
- **1. Disparador:** alta o actualización de un lead con intención de venta o
  compra.
- **2. Info existente:** `leads` (intención, zona, tipo, presupuesto), el mismo
  matching de similitud.
- **3. Decisión:** conectar oferta y demanda que ya están dentro de la agencia.
- **4. Tiempo:** el de cruzar manualmente la cartera (no se hace).
- **5. Riesgo:** tener el comprador y el vendedor en casa y no darse cuenta.
- **6. Mejora:** doble comisión (capta y vende) a partir de datos que ya
  estaban.
- **7. Reutiliza:** la tabla `leads` y la lógica de matching por atributos.
- **8. Sin motores nuevos:** es un cruce entre filas de una tabla existente con
  criterios ya usados en la búsqueda de inventario.
- **Impacto:** Medio→Alto (escala con el equipo) · **Complejidad:** Media ·
  **Prioridad:** P2 · **Valor comercial:** Muy Alto · **Dependencias:** ninguna ·
  **Métrica de éxito:** matches internos oferta-demanda sugeridos y trabajados.

### EXP-012 · Contexto de objeciones al preparar el mensaje
- **Acción que inicia SOFI:** al ir a contactar sobre una propiedad, adjunta al
  borrador las objeciones típicas ya resueltas de esa propiedad (ángulo,
  beneficios, respuestas), para que el asesor las tenga a mano.
- **1. Disparador:** el asesor prepara un mensaje/seguimiento sobre una
  propiedad concreta.
- **2. Info existente:** `property_contexts` / `contexto_venta` del DCE (ya
  guarda "objeciones resueltas" por propiedad).
- **3. Decisión:** cómo responder la objeción que probablemente venga.
- **4. Tiempo:** el de improvisar la respuesta a una objeción conocida.
- **5. Riesgo:** perder la conversación por una objeción mal manejada.
- **6. Mejora:** el conocimiento de venta destilado por el DCE llega al asesor en
  el momento justo.
- **7. Reutiliza:** el contexto de venta que el DCE ya genera y almacena.
- **8. Sin motores nuevos:** solo surface de un dato ya persistido. *Nota
  honesta:* detectar objeciones **nuevas y repetidas** a través de las
  conversaciones del equipo en tiempo real sí exigiría análisis de lenguaje
  nuevo — eso queda **fuera**; este ítem se limita a lo que el DCE ya sabe.
- **Impacto:** Medio · **Complejidad:** Baja · **Prioridad:** P3 ·
  **Dependencias:** DCE con contexto poblado · **Métrica de éxito:** objeciones
  respondidas con material del sistema.

---

## Área 4 — Fin de jornada
> *Cerrar el ciclo y dejar armado el día siguiente, para que el briefing de
> mañana (EXP-001) nazca del cierre de hoy.*

### EXP-006 · Cierre de jornada + siembra del día siguiente
- **Acción que inicia SOFI:** al cerrar el día, resume lo logrado (seguimientos
  hechos, citas cumplidas, ventas) y **deja armada la cola de mañana** con lo que
  quedó pendiente y los calientes sin tocar.
- **1. Disparador:** el asesor cierra su sesión / última interacción del día.
  *Opcional:* cierre a hora fija → temporizador (a decidir aparte).
- **2. Info existente:** `cmd_metricas_leads`, `cmd_metricas_ventas`,
  `cmd_seguimientos`; la cola queda en el contexto/sesión.
- **3. Decisión:** qué queda sin resolver y con qué se arranca mañana.
- **4. Tiempo:** el reporte diario que hoy no se hace, y el reordenar mental de
  mañana.
- **5. Riesgo:** que un pendiente de hoy desaparezca en la noche.
- **6. Mejora:** el asesor cierra con una victoria reconocida y empieza mañana
  sin reconstruir nada — cierra el círculo con EXP-001.
- **7. Reutiliza:** las funciones de métricas y seguimientos + la memoria de
  sesión.
- **8. Sin motores nuevos:** son las mismas funciones llamadas al cerrar; la
  "siembra" es persistir la cola en la sesión, que ya guarda contexto.
- **Impacto:** Alto · **Complejidad:** Baja · **Prioridad:** P1 ·
  **Dependencias:** ninguna (alimenta a EXP-001) · **Métrica de éxito:**
  pendientes que sobreviven de un día al siguiente sin perderse.

---

## Secuencia de entrega sugerida (por ROI y dependencias)

1. **Sprint 1 — el círculo del asesor:** EXP-001 → EXP-006 (briefing y cierre se
   alimentan mutuamente) + EXP-003 (rescate). Máximo valor, complejidad baja,
   cero dependencias.
2. **Sprint 2 — velocidad y anticipación:** EXP-002 (respuesta anticipada) +
   EXP-004 + EXP-005. Aquí se mueve la aguja de conversión.
3. **Sprint 3 — el ojo del dueño:** EXP-007 + EXP-008.
4. **Sprint 4 — inteligencia compartida (sube con el tamaño del equipo):**
   EXP-010 → EXP-009 → EXP-011, y EXP-012/EXP-013 como pulido ambiental.

## Frontera honesta (lo que queda fuera a propósito)
- **Temporizador sin evento ni usuario** (empuje a hora fija con nadie
  conectado): lo desean EXP-003, EXP-004, EXP-006 para su versión más fuerte.
  Es la única plomería nueva posible; queda como decisión aparte, no incluida en
  el "cero maquinaria". Todas esas mejoras tienen versión en scope que funciona
  sin él (se disparan al abrir/cerrar sesión y por evento).
- **Detección de objeciones nuevas por lenguaje** a través de conversaciones:
  fuera (sería capacidad nueva). EXP-012 se queda con lo que el DCE ya sabe.
- **Cualquier acción con efecto hacia el cliente** (enviar, cerrar) sigue
  exigiendo confirmación humana (nivel A/H). SOFI prepara y propone; el asesor
  aprueba. La proactividad nunca cruza a autonomía sobre el cliente.
