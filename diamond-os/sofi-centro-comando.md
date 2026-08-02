# SOFI — Centro de Comando Conversacional

**Estado:** BORRADOR — Diseño funcional para aprobación
**Autor:** Chief Product Officer / Chief Architect (rol asumido para este documento)
**Fuentes exclusivas:** [DIAMOND-OS-BLUEPRINT-V1](DIAMOND-OS-BLUEPRINT-V1.md), [Auditoría del Blueprint](auditoria-blueprint-v1.md), [Modelo de Gobernanza de Decisiones](modelo-gobernanza-decisiones.md), [ARCHITECTURE.md](../ARCHITECTURE.md) (bot Sofi), [crm/ARCHITECTURE.md](../crm/ARCHITECTURE.md), [db/schema.sql](../db/schema.sql) + migraciones, [web/README.md](../web/README.md). No se investigó nada fuera de estos documentos y del código real desplegado.

Este documento no diseña pantallas, componentes, APIs, código ni prompts.
Diseña la **experiencia funcional**: actores, permisos, flujos
conversacionales, memoria y su encaje en Diamond OS. Todo desarrollo futuro
de esta capacidad se alinea con esto o cambia esto primero.

Decisiones ya tomadas por el dueño del producto (2026-07-10):
- **Canal dual**: chat embebido en el CRM + canal WhatsApp para asesores.
- **Ventas cerradas** se modelan extendiendo los estados del lead
  (`cerrado_ganado` / `cerrado_perdido`), no con un objeto Oportunidad nuevo.

---

## 0. Declaración

> **El CRM deja de ser un lugar que se navega y pasa a ser un sistema con el
> que se conversa. SOFI es la interfaz principal de operación interna de la
> inmobiliaria.**

Hoy SOFI existe como un solo actor: la asesora virtual que atiende clientes
por WhatsApp. Este diseño la desdobla en **dos actores sobre el mismo Motor
Conversacional** (Blueprint §6.4):

| Actor | Interlocutor | Superficie | Misión | Existe hoy |
|---|---|---|---|---|
| **Sofi-Cliente** | Interesados externos (leads) | WhatsApp / Telegram | Captar, calificar, transferir | Sí (`procesarMensaje`) |
| **Sofi-Comando** | Asesores y admins de la inmobiliaria | Chat en el CRM + WhatsApp | Responder cualquier pregunta del negocio y ejecutar acciones comerciales asistidas | No — este diseño |

Son el mismo motor (loop de tool-use con Claude), pero **personas, reglas y
herramientas completamente separadas**. Las 40 reglas de Sofi-Cliente
(calificar, no inventar, formato de ficha al cliente) no aplican a un asesor
interno; mezclarlas en un solo prompt degradaría a ambos. No se reutiliza
`procesarMensaje`: está acoplado al ciclo lead → calificación → transferencia,
y un asesor no es un lead.

Lo que sí se reutiliza, íntegro: la capa de datos (`src/data/*`), el patrón de
engine con tool-use y prompt caching, el canal WhatsApp existente, la
infraestructura de fichas y links de la landing REF, y la tabla
`ally_properties` como base de la Memoria de Mercado.

---

## 1. Principios de diseño

1. **La base de datos calcula, la IA conversa.** Toda pregunta agregable
   ("¿cuántos leads llegaron hoy?") se responde con UNA llamada a una función
   SQL que ya aplica el alcance del usuario y devuelve un resultado compacto
   (`{ total: 47, por_fuente: {...} }`). El modelo nunca recibe filas crudas
   para contarlas ni listas largas para filtrarlas. Es la traducción operativa
   de la restricción de eficiencia de tokens, y de paso hace las respuestas
   deterministas: dos asesores que preguntan lo mismo obtienen el mismo número.
2. **El modelo nunca decide el alcance.** Los permisos se resuelven ANTES del
   loop de IA y viajan como contexto inmutable dentro de cada herramienta. Un
   prompt malicioso o un error del modelo no pueden ampliar lo que el usuario
   ve, porque el filtro vive en la función SQL, no en el prompt.
3. **Conversational-first, no conversational-only.** Las vistas actuales del
   CRM (inbox, kanban, leads, aliados) se conservan como vistas de apoyo;
   Sofi-Comando puede enlazarlas ("te dejo el kanban aquí"). Se extiende, no
   se reemplaza (P9 del Blueprint).
4. **Toda acción hacia un cliente pasa por confirmación humana.** Sofi-Comando
   redacta y prepara; el asesor aprueba. Nivel A (asistido) del
   [Modelo de Gobernanza](modelo-gobernanza-decisiones.md), nunca S.
5. **Todo comando queda registrado** (quién, qué herramienta, con qué alcance,
   por qué canal) — P6 del Blueprint, mismo patrón que `dmap_audit_log`.
6. **Multi-tenant desde el diseño**: todo alcance incluye `org_id`. El CRM hoy
   opera con una sola organización, pero ninguna pieza nueva puede asumirlo.

---

## 2. Identidad y permisos — el Resolutor de Alcance

### 2.1 Cómo sabe SOFI quién habla

| Canal | Identidad | Mecanismo |
|---|---|---|
| **Chat en el CRM** | Fuerte (sesión autenticada) | Sesión Supabase → `uid` + rol en `auth.users.app_metadata.role` (lógica existente de `crm/lib/auth.ts`: `isAdmin`, `userRole`, `roleEspecialidad`) |
| **WhatsApp interno** | Media (número verificado por Meta) | Número entrante → match contra `advisors.phone` de un asesor `activo` con `auth_user_id` vinculado → misma identidad que en el CRM |

Regla de enrutamiento del canal WhatsApp: si el número entrante corresponde a
un asesor registrado, la conversación va a **Sofi-Comando**; cualquier otro
número sigue yendo a **Sofi-Cliente** como hoy. Un asesor jamás es tratado
como lead y un cliente jamás accede al centro de comando.

Supuesto documentado: Meta Cloud API verifica el remitente del mensaje, por lo
que la identidad por número es aceptable para este uso. Mitigación adicional:
si el teléfono de un asesor cambia, el vínculo se actualiza en el CRM
(gestión de usuarios existente); un número dado de baja pierde acceso al
instante porque el match exige `activo = true`.

### 2.2 El alcance (scope)

Antes de invocar al modelo, el sistema construye un objeto de alcance
inmutable:

```
{ org_id, viewer_uid, role (admin | asesor_*), especialidad (venta|arriendo|vehiculos|otro), canal (crm|whatsapp) }
```

Toda herramienta lo recibe por fuera del control del modelo. Las funciones de
consulta en base lo reciben como parámetros y aplican el filtro internamente.

### 2.3 Matriz de permisos

| Recurso | ADMIN | ASESOR |
|---|---|---|
| Leads, conversaciones y mensajes de clientes | Todos los de la org | Solo leads con `owner_id = viewer_uid`; además puede listar leads **sin dueño** (para reclamarlos, como hoy en el CRM) |
| Métricas de negocio | Completas: totales, por asesor, por fuente, embudo | Solo las propias (sus leads, sus ventas, sus seguimientos) |
| Inventario propio (`properties`) | Todo | Todo (el inventario es de la inmobiliaria, no del asesor); por conveniencia, las búsquedas sin filtro explícito arrancan en su especialidad |
| Memoria de Mercado (`ally_properties`) | Toda + gestión de estados | Lectura de toda la org (el valor de la red es compartirla); registra nuevas; confirma/descarta las que registró o las que coinciden con sus leads |
| Enviar un mensaje de WhatsApp a un cliente | A cualquier lead, con confirmación | Solo a sus leads, con confirmación |
| Gestión de usuarios, marketing (DMAP) | Vía CRM actual (fuera del alcance de Sofi-Comando V1) | No |

Notas de diseño:
- La distinción admin/asesor reutiliza sin cambios el modelo existente
  (`app_metadata.role` + `leads.owner_id`); no se crea ninguna tabla de
  permisos nueva.
- El RLS actual ("authenticated lee todo") no cambia en esta fase: el
  enforcement sigue siendo de aplicación, como en todo el CRM. Endurecer RLS
  por `owner_id` queda anotado como mejora futura no bloqueante (§10).
- Cuando un asesor pregunta por datos fuera de su alcance ("¿cuántas ventas
  hizo Carlos?"), Sofi-Comando responde con el límite explícito y ofrece la
  alternativa válida ("puedo mostrarte las tuyas; las del equipo las ve el
  administrador"). Nunca finge que el dato no existe.

---

## 3. Catálogo funcional de herramientas de Sofi-Comando

Cada herramienta se define por: qué pregunta responde, qué consulta en base la
resuelve, qué devuelve al modelo (siempre compacto) y su nivel H/A/S.

| # | Herramienta | Pregunta tipo | Se resuelve con | Devuelve al modelo | Nivel |
|---|---|---|---|---|---|
| 1 | `metricas_leads(periodo, agrupacion?)` | "¿Cuántos leads llegaron hoy?" "¿De dónde vinieron los de esta semana?" | RPC de agregación sobre `leads` (por día/fuente/estado/asesor según rol) | Totales y desgloses, nunca filas | S |
| 2 | `metricas_ventas(periodo)` | "¿Cuántas ventas hice este mes?" | RPC sobre `leads` en `cerrado_ganado` (conteo, suma de `valor_cierre`) | `{ ventas: n, valor_total, por_mes }` | S |
| 3 | `leads_para_seguimiento()` | "¿Qué clientes necesitan seguimiento?" | RPC: leads `calificado`/`transferido` sin actividad ≥ N días, citas vencidas o próximas 48 h | Top N (≤10) con nombre, teléfono, motivo y días sin contacto | S |
| 4 | `buscar_inventario(filtros)` | "¿Qué propiedades tengo disponibles?" "Apartamentos en Laureles hasta 500" | Reutiliza `properties.search` (filtros ref/zona/tipo/precio/habitaciones, `disponible = true`) | ≤5 fichas resumidas | S |
| 5 | `ficha_propiedad(ref)` | "Muéstrame la REF 9205982" "Resume esta propiedad" | Reutiliza `properties.findByRef` + `withLandingLink` (+ `contexto_venta` del DCE si existe) | Ficha estructurada de UNA propiedad con link de landing | S |
| 6 | `propiedades_similares(ref)` | "¿Qué propiedades similares tengo?" | Función SQL nueva con la heurística probada de la web (`getSimilar`: misma operación > misma zona > misma ciudad) + banda de precio ±25 % | ≤3 similares resumidas, con motivo del match | S |
| 7 | `generar_mensaje_cliente(lead, proposito)` | "Genera un mensaje para enviarle al cliente" | Redacción del modelo con contexto compacto: datos del lead + propiedad en foco + `contexto_venta` | Borrador de mensaje para aprobación del asesor | **A** |
| 8 | `compartir_ficha(ref, lead)` | "Comparte la ficha por WhatsApp" | Arma el link canónico de la landing y/o el link corto `/wa/{ref}`; si el asesor confirma, envía por el canal WhatsApp existente del bot (`sendWhatsApp`) | Confirmación de envío o link listo para copiar | **A** |
| 9 | `registrar_propiedad_colega(datos)` | "Anota este apartamento que me pasó un colega de X inmobiliaria" | Reutiliza `allyProperties.create` — estado `pendiente`, con `registered_by` y origen `asesor` | Resumen de lo registrado para confirmación | A |
| 10 | `consultar_memoria_mercado(filtros)` | "¿Qué hay en la red de colegas en El Poblado?" | Reutiliza `allyProperties.search/list` (estados activos) | ≤5 coincidencias con estado y datos del colega | S |
| 11 | `registrar_cierre(lead, resultado, valor?)` | "Marca la venta del apto de Laureles con Marcela" | Actualiza `leads.estado` → `cerrado_ganado`/`cerrado_perdido` + `closed_at` + `valor_cierre`, respetando ownership | Confirmación del cierre | **H** (el humano decide; el sistema solo registra) |

Reglas transversales del catálogo:
- **Límite duro en toda lista** (top 3–10 según herramienta). Si hay más
  resultados, la herramienta devuelve el total y los primeros N; el asesor
  refina conversando, no paginando.
- **Ninguna herramienta acepta un alcance del modelo**: `viewer_uid`, `role` y
  `org_id` se inyectan desde el Resolutor de Alcance.
- Las herramientas 7, 8 y 11 son las únicas con efecto hacia afuera o sobre el
  pipeline, y las tres exigen confirmación explícita del usuario dentro de la
  conversación antes de ejecutar.
- El **contexto activo** de la sesión (§5.2) resuelve las referencias
  anafóricas: "resume **esta** propiedad", "envíale **al cliente**".

---

## 4. Capa de Consulta en Base

La pieza que garantiza la restricción de eficiencia: **ninguna métrica se
calcula en el runtime de la IA ni en JavaScript sobre filas descargadas**. Hoy
no existe ni una vista ni una función RPC en `db/` — esta capa es nueva.

Contrato general de toda función de consulta:

```
f(org_id, viewer_uid, viewer_role, ...parámetros de negocio) → JSON compacto
```

- El filtro de alcance vive DENTRO de la función: si `viewer_role` no es
  admin, todo se restringe a `owner_id = viewer_uid`. Una sola función sirve a
  ambos perfiles; imposible olvidarse del filtro en un llamador.
- Toda función lista devuelve `total` + top N; toda función agregada devuelve
  solo el agregado.
- Fechas y periodos se resuelven en SQL con zona horaria de Colombia (misma
  convención que el bloque volátil del prompt de Sofi-Cliente).

Inventario inicial de funciones (firmas y semántica; el SQL es implementación):

| Función | Semántica |
|---|---|
| `cmd_metricas_leads(org, uid, rol, desde, hasta, agrupacion)` | Conteos de leads por día/fuente/estado/asesor en el periodo. Asesor: solo los suyos. |
| `cmd_metricas_ventas(org, uid, rol, desde, hasta)` | Cierres `cerrado_ganado`: cantidad, `sum(valor_cierre)`, comparativa con el periodo anterior. |
| `cmd_embudo(org, uid, rol)` | Foto del pipeline: leads por estado + temperatura por score (umbrales existentes: ≥70 caliente, ≥40 tibio). |
| `cmd_seguimientos(org, uid, rol, dias_inactividad)` | Leads calificados/transferidos sin mensajes recientes (join con `conversations.last_activity_at`), citas en `leads.cita` vencidas o próximas. |
| `cmd_similares(org, ref, limite)` | Heurística de similitud (operación > zona > ciudad, banda de precio) sobre `properties` disponibles. |
| `cmd_memoria_mercado_match(org, filtros)` | Coincidencias en `ally_properties` con estado activo (`pendiente`/`confirmada`), para el flujo de la Red de Colegas (§7). |
| `cmd_inventario_resumen(org, especialidad?)` | Conteo de propiedades disponibles por tipo/operación/zona — para respuestas de panorama ("¿cómo está el inventario?"). |

Criterio para crecer la capa: cada pregunta nueva que Sofi-Comando no pueda
responder con una función existente se convierte en candidata a función
nueva — nunca en una descarga de filas al modelo.

---

## 5. Memoria

Tres niveles, cada uno con un propósito distinto:

### 5.1 Memoria de sesión (conversación interna)

Tablas nuevas `command_sessions` y `command_messages`, **separadas** de
`conversations`/`messages`. Motivo: el inbox del CRM es la bandeja de
conversaciones con clientes; mezclar ahí las sesiones internas contaminaría la
vista, el Realtime y las métricas de conversación. Una sesión pertenece a un
usuario (`auth.users`) y una org; guarda los mensajes y el contexto activo.
La memoria corta del motor son los últimos N mensajes de la sesión (mismo
patrón `HISTORY_LIMIT` del engine actual).

### 5.2 Contexto activo (el "foco")

La sesión mantiene referencias explícitas a las entidades en discusión:
propiedad en foco (por `ref`), lead en foco (por id), última coincidencia de
memoria de mercado. Se actualiza cada vez que una herramienta resuelve una
entidad. Es lo que permite el encadenamiento natural:

> "Muéstrame la REF 9205982" → *(propiedad en foco = 9205982)* →
> "resume esta propiedad" → "¿qué similares tengo?" →
> "genera un mensaje para el cliente" → *(lead en foco)* →
> "compártele la ficha por WhatsApp".

Sin contexto activo, cada pregunta exigiría repetir la referencia — y cada
repetición mal resuelta quemaría una búsqueda extra. El foco es también una
barrera de seguridad: "el cliente" solo puede resolverse a un lead que el
usuario tenga permitido ver.

### 5.3 Memoria de Mercado

Es la memoria institucional de la Red de Colegas (§7): `ally_properties`
formalizada. No es memoria de la conversación, es memoria del negocio: lo que
la inmobiliaria sabe del inventario ajeno, con vigencia (`expires_at`) y
estados de confianza.

### 5.4 Auditoría

Cada ejecución de herramienta registra: usuario, rol, canal, herramienta,
parámetros de negocio (no el texto libre de la conversación) y resultado
resumido. Mismo patrón que `dmap_audit_log`. Responde a P6 y habilita la
pregunta inversa del admin: "¿qué ha consultado el equipo esta semana?".

---

## 6. Flujos conversacionales de referencia

Guiones normativos (el tono es el de Sofi: cercano, paisa suave, sin
muletillas forzadas; con datos siempre precisos).

**Consulta de métricas (asesor):**
> Asesor: ¿Cuántos leads llegaron hoy?
> SOFI: Hoy te llegaron **4 leads**: 3 de Instagram y 1 de la landing. 2 ya están calificados. ¿Quieres verlos?

*(Una llamada a `cmd_metricas_leads`; los números vienen calculados de la base.)*

**Consulta fuera de alcance (asesor):**
> Asesor: ¿Cuántas ventas hizo el equipo este mes?
> SOFI: Esa vista completa la tiene el administrador. Lo tuyo este mes: **2 ventas cerradas** por $580M. ¿Te muestro el detalle?

**Panorama de negocio (admin):**
> Admin: ¿Cómo vamos este mes?
> SOFI: Van **63 leads** (+18 % vs junio), 21 calificados, 9 transferidos y **5 ventas cerradas por $1.240M**. El embudo se está frenando en "transferido": hay 6 leads ahí con más de 5 días sin actividad. ¿Te los listo por asesor?

**Trabajo sobre una propiedad (asesor):**
> Asesor: Muéstrame la REF 9205982
> SOFI: *(ficha compacta + link de la landing)*
> Asesor: ¿Qué similares tengo?
> SOFI: Tengo 3 similares disponibles en venta: … *(motivo del match en una línea cada una)*
> Asesor: Genera un mensaje para Marcela con la segunda
> SOFI: *(borrador del mensaje, usando el contexto de venta de la propiedad)* — ¿Te lo envío a su WhatsApp o lo ajustamos?
> Asesor: Envíalo
> SOFI: Listo, enviado a Marcela (+57 …). Quedó registrado en su conversación.

*(El envío usa el canal WhatsApp que ya existe en el bot; el mensaje queda en
`messages` de la conversación del lead, visible en el inbox como intervención
humana — el mismo contrato que el envío manual actual del CRM.)*

**Registro de cierre (asesor):**
> Asesor: Marca como vendida la de Laureles con Marcela, 620 millones
> SOFI: Confirmo: **cierre ganado** — REF 9205982, lead Marcela Ruiz, $620M, hoy 10 de julio. ¿Lo registro?
> Asesor: Sí
> SOFI: Registrado. Van 3 ventas tuyas este mes. 🎉

Reglas de estilo transversales: respuestas cortas con el dato primero;
ofrecer el siguiente paso, no menús; nunca inventar un número (si la función
no lo devuelve, se dice); enlazar la vista del CRM cuando la respuesta es más
cómoda en tabla (kanban, inbox).

---

## 7. Red de Colegas — la Memoria de Mercado

### 7.1 Concepto

Las propiedades de colegas de otras inmobiliarias **no son inventario**. Son
conocimiento de mercado con nivel de confianza variable y fecha de
vencimiento. El sistema ya tiene la base construida (tabla `ally_properties`,
estados `pendiente / confirmada / no_disponible / expirada`, dedup por
`org + teléfono del colega + ref`, tool de registro en Sofi-Cliente, vista de
gestión en el CRM). Este diseño la formaliza como subsistema con nombre
propio — **Memoria de Mercado** — y le agrega el segundo canal de registro y
el flujo de sugerencia al cliente.

### 7.2 Registro (dos orígenes, mismo destino)

| Origen | Cómo ocurre | Existe hoy |
|---|---|---|
| **Sofi-Cliente** | Un colega escribe al WhatsApp de la inmobiliaria ofreciendo una propiedad; Sofi la detecta y la registra (reglas 37–40 del prompt actual) | Sí |
| **Sofi-Comando** | El asesor se la dicta a SOFI ("un colega de Su Casa Inmobiliaria me pasó un apto en Envigado, 3 habitaciones, 480 millones, el contacto es Pedro 300…") | Nuevo |

Flujo de registro por Sofi-Comando: el asesor dicta en lenguaje natural →
SOFI extrae los campos (título/tipo, operación, precio, zona, inmobiliaria de
origen, nombre y teléfono del colega, ref si la hay) → muestra el resumen →
el asesor confirma → se guarda con estado **`pendiente` siempre**, más dos
campos nuevos: `registered_by` (quién la registró) y `origen`
(`cliente | asesor`). Si el dedup detecta que ya existe, SOFI lo dice y
ofrece actualizar la existente en lugar de duplicar.

**Toda propiedad de colega nace `pendiente de validación`, sin excepción.**
Ni el asesor que la registra puede marcarla `confirmada` en el mismo acto:
confirmar exige haber verificado disponibilidad con el colega (acción
posterior, §7.5).

### 7.3 Reglas duras (mismo rango que las reglas 1–40 de Sofi-Cliente)

1. **Nunca prometer disponibilidad** de una propiedad de la Memoria de
   Mercado, en ningún estado — ni siquiera `confirmada` (la confirmación
   caduca).
2. **Nunca presentarla como inventario propio.** No se envía ficha, ni
   precio, ni fotos, ni dirección al cliente.
3. **Al cliente jamás se le dan datos del colega ni de la propiedad.** Solo
   la frase estándar (§7.4).
4. `confirmada` **no la convierte en inventario**: sigue siendo memoria, con
   vigencia (`expires_at`); vencida → `expirada` y sale de los matches.
5. La Memoria de Mercado nunca alimenta la landing, el DMAP ni ninguna
   publicación.

### 7.4 Coincidencia — el momento de valor

Disparador: un cliente conversa con Sofi-Cliente, `buscar_propiedades` no
encuentra inventario propio que satisfaga la búsqueda, y la búsqueda de
respaldo en la Memoria de Mercado (`cmd_memoria_mercado_match`) sí encuentra
una coincidencia activa.

Comportamiento hoy: el match es 100 % silencioso — viaja solo en la alerta al
asesor y el cliente no se entera. **Este diseño introduce el único cambio de
comportamiento de Sofi-Cliente:** con coincidencia activa, el cliente recibe
exactamente este nivel de información y nada más:

> **"Hemos encontrado una posible opción. Un asesor verificará disponibilidad
> y se comunicará contigo."**

Diseño del guardarraíl (aprendido del fix documentado de `ctx.allyMatch`): el
detalle de la coincidencia **no se serializa al modelo de Sofi-Cliente** — el
motor solo le informa "existe una posible coincidencia" como bandera, de modo
que es imposible que el modelo filtre precio, zona exacta o datos del colega
por error de prompt. La frase al cliente es fija, no generada.

Simultáneamente, el **asesor responsable** (el owner del lead, o el asesor de
la especialidad si no hay owner — misma resolución que `transferir_a_asesor`)
recibe el paquete de coincidencia completo:

- 👤 **Cliente interesado**: nombre, teléfono, qué busca, score.
- 🏠 **Propiedad sugerida**: título, zona, precio, operación.
- 🤝 **Datos del colega**: nombre, teléfono, inmobiliaria de origen.
- 🏷️ **Estado**: *Pendiente de validación* (o *Confirmada* + fecha de la
  última confirmación).
- ▶️ **Acción recomendada: Contactar colega** para verificar disponibilidad
  antes de cualquier ofrecimiento al cliente.

El paquete llega por los mismos medios que la alerta de transferencia actual
(WhatsApp al asesor) y queda disponible en Sofi-Comando ("¿qué coincidencias
tengo pendientes?").

### 7.5 Validación y ciclo de vida

```
pendiente ──(asesor verifica con el colega)──► confirmada ──(vence expires_at)──► expirada
    │                                              │
    └──────────(no disponible / descartada)──► no_disponible
```

El asesor cierra el ciclo conversando con Sofi-Comando ("el apto de Envigado
del colega Pedro sí está disponible" → `confirmada`, con `confirmada_por` y
fecha) o desde la vista de aliados existente en el CRM — ambos caminos
escriben el mismo estado. Solo tras confirmar disponibilidad el asesor puede
ofrecer la propiedad al cliente, y lo hace él (humano), no SOFI.

### 7.6 Gobernanza (H/A/S)

| Decisión | Nivel | Justificación |
|---|---|---|
| Registrar una propiedad de colega | **S** con confirmación del asesor | Captura de datos, sin riesgo |
| Decirle al cliente "hay una posible opción" | **A** | El sistema sugiere con lenguaje fijo y acotado; el humano valida antes de cualquier ofrecimiento real |
| Confirmar disponibilidad / ofrecer al cliente | **H** | Compromiso comercial con información de terceros — responsabilidad del asesor (P8) |

---

## 8. Integración con Diamond OS

- **Motor Conversacional (Blueprint §6.4).** Este diseño lo eleva de "canal de
  atención a interesados" a **superficie de operación interna** — la primera
  vez que el motor se somete a una disciplina de diseño formal, respondiendo
  directamente la debilidad señalada en la
  [auditoría](auditoria-blueprint-v1.md) (el Motor Conversacional no había
  pasado por el mismo criterio que los demás motores).
- **Objetos del Blueprint.** Las sesiones internas son instancias del objeto
  **Conversación** (subtipo interno); cada comando ejecutado es una
  **Actividad**; cada cierre registrado y cada confirmación de la Memoria de
  Mercado es una **Decisión** con su evidencia; la auditoría alimenta el
  **Registro de Eventos** (P6). La Memoria de Mercado es una especialización
  del objeto **Propiedad**: propiedad no propia, con confianza y vigencia.
- **Principios.** P1/P2: el asesor deja de navegar módulos para las preguntas
  de rutina y concentra su juicio en cerrar. P4/P5: ninguna cifra nueva se
  almacena — todo se calcula de las tablas que ya son fuente de verdad. P7:
  la matriz de permisos es la traducción literal de "cada actor conoce solo
  lo necesario". P8: todo contacto con el cliente y todo compromiso comercial
  quedan en manos humanas.
- **Prioridades.** El alcance comercial V1 vigente
  ([diamond-os-v1-alcance-comercial.md](diamond-os-v1-alcance-comercial.md))
  está enfocado en recaudo/liquidación. Este diseño es una **ampliación de
  alcance decidida explícitamente por el dueño del producto** (2026-07-10);
  no invalida aquel documento, pero compite por el mismo recurso (1 dev). La
  secuencia entre ambos se decide al aprobar este expediente.

---

## 9. Cambios de datos requeridos (especificación, no implementación)

| Cambio | Detalle |
|---|---|
| `leads.estado` | + `cerrado_ganado`, `cerrado_perdido` (tras `transferido`). Nuevos campos: `closed_at`, `valor_cierre`. Al implementarse, actualizar el arreglo canónico `ESTADOS` de `crm/lib/types.ts` (kanban y validación lo absorben). |
| `ally_properties` | + `registered_by` (→ `auth.users`), + `origen` (`cliente \| asesor`). |
| Tablas nuevas | `command_sessions`, `command_messages` (sesiones internas, §5.1) y auditoría de comandos (§5.4). Todas con `org_id`. |
| Funciones de consulta | Las 7 del inventario inicial (§4), todas con el contrato `(org_id, viewer_uid, viewer_role, …)`. |
| RLS | Sin cambios en esta fase (patrón actual de enforcement de aplicación). Endurecimiento por `owner_id` anotado como mejora futura. |

Nada de esto se implementa hasta aprobar este documento (regla 4 del
CLAUDE.md del repo).

---

## 10. Riesgos y decisiones diferidas

- **Identidad por número en WhatsApp.** Aceptada como supuesto (§2.1). Si a
  futuro se manejan datos más sensibles por ese canal, el mitigante natural
  es limitar el canal WhatsApp al alcance de asesor aunque el número sea de
  un admin, dejando la vista completa solo en el CRM. Diferida.
- **RLS real por asesor.** Hoy cualquier autenticado puede leer todo por SQL
  directo; el riesgo es interno y bajo (equipo pequeño), pero existe.
  Endurecer policies por `owner_id`/rol es la mejora estructural correcta y
  no bloquea este diseño. Diferida.
- **Similitud semántica.** La heurística operación>zona>ciudad+precio es
  suficiente para V1 (ya probada en la landing). Embeddings quedan en la
  misma lista de decisiones diferidas donde ya estaban en ARCHITECTURE.md.
- **Frecuencia de la frase al cliente (§7.4).** Si la Memoria de Mercado
  crece, avisar "posible opción" en cada búsqueda sin inventario podría
  generar expectativas incumplibles. Mitigante de diseño: solo se dispara con
  coincidencias en estado activo y no vencidas; medir tasa de cumplimiento
  (asesor contactó al colega en < 48 h) antes de ampliar.
- **Costo por conversación interna.** El diseño ya lo minimiza (agregación en
  SQL, límites duros, prompt caching del bloque estable, contexto activo).
  Si aún así el costo preocupa, la palanca siguiente es un modelo más
  económico para la selección de herramientas — decisión de implementación,
  no de diseño.

---

## Trazabilidad contra el encargo

| Pedido | Dónde se resuelve |
|---|---|
| "¿Cuántos leads llegaron hoy?" | Herramienta 1 → `cmd_metricas_leads` |
| "¿Cuántas ventas hice este mes?" | Herramienta 2 → `cmd_metricas_ventas` (+ estados de cierre §9) |
| "¿Qué clientes necesitan seguimiento?" | Herramienta 3 → `cmd_seguimientos` |
| "¿Qué propiedades tengo disponibles?" | Herramienta 4 (reutiliza `properties.search`) |
| "Muéstrame la propiedad REF X" / "Resume esta propiedad" | Herramienta 5 + contexto activo §5.2 |
| "Genera un mensaje para el cliente" | Herramienta 7 (nivel A, aprueba el asesor) |
| "Comparte la ficha por WhatsApp" | Herramienta 8 (links de landing + canal existente) |
| "¿Qué propiedades similares tengo?" | Herramienta 6 → `cmd_similares` |
| Perfiles ADMIN / ASESOR | §2 (Resolutor de Alcance + matriz) |
| Red de Colegas / Memoria de Mercado | §7 completo |
| "Pendiente de validación" obligatorio | §7.2 |
| Frase exacta al cliente / paquete al asesor | §7.4 |
| Nunca prometer disponibilidad ni tratar como inventario | §7.3 (reglas duras 1–5) |
| Consultas dentro de la base (eficiencia de tokens) | Principio 1 (§1) + §4 completo |
| Integración con Diamond OS | §8 |
| No reemplazar, extender | §0, Principio 3, §9 (reutilización explícita) |
