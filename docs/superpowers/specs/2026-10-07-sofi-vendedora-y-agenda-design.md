# Sofi vendedora senior, puente colega→Sofi y agenda con confirmación — diseño

Fecha: 2026-10-07 · Estado: **aprobado en conversación, pendiente de revisión escrita de Juan**

## 0. Por qué

Juan pidió (2026-10-06):

- que la respuesta al colega siga saliendo desde la línea de grupos pero lleve
  un link para **agendar visita** y otro para **más opciones / dudas**, que
  caigan directo en Sofi, y que Sofi lo atienda **como un colega con perfil ya
  creado**;
- que Sofi **agende sola**, con un margen de **24 h** para que la asesora
  confirme, y que el aviso de confirmación sea **efectivo en WhatsApp**, no
  solo en el CRM;
- **90 minutos de desplazamiento** entre citas;
- que los asesores ya no se identifiquen por nombre sino como **Asesor 1,
  Asesor 2…**, y que todo mensaje hacia afuera vaya firmado por **Sofi,
  asistente virtual**;
- que Sofi actúe como **vendedora senior**: envío, seguimiento, ofrecer
  similares, preguntar si tiene dudas;
- que Sofi **atienda y recuerde**.

Hoy (verificado en el código, 2026-10-06):

| Pieza | Estado |
|---|---|
| DM al colega por la línea de grupos (WAHA) con link `wa.me` a Sofi y "N opciones más" | Existe — `src/groups/redactar.js:357` (`lineasCierre`), `:496-505` |
| Link de agendar visita en el DM | No existe |
| Sofi reconoce al colega que le escribe | Solo si `colegas_grupos.telefono` está resuelto — `src/agent/engine.js:64-85`, `src/data/colegas.js:149`. El 98 % de los colegas solo tiene lid → cae como cliente |
| Cita propuesta + confirmación "OK CONFIRMADA" | Existe — `src/agent/tools.js:685-769` y `:910+`; estado en `leads.cita` (jsonb) |
| Anticipación mínima | No existe en `agendar_cita` (`AVISO_MINIMO_MIN=120` solo vive en `proximoDisponible`, que ya no se usa) |
| Margen entre citas | Solo choque con `DURACION_MIN=60` (`src/data/appointments.js:13`) |
| Aviso a la asesora | Texto libre: **no llega si la ventana de 24 h está cerrada**; por eso existe `entregarConRespaldo` (`src/lib/entrega-asesor.js:42`) |
| Nombre y celular de la asesora hacia afuera | Se filtran en 5 sitios (§2) |
| Memoria | Últimos 12 mensajes de la conversación activa; nada de largo plazo |

## 1. Alcance

**Entra:** §2 identidad pública · §3 puente colega→Sofi · §4 agenda y
confirmación · §5 Sofi vendedora senior, memoria y seguimiento.

**Fuera (cada uno con su propio diseño, después):**
- Condiciones de visita por propiedad (franjas, inquilino, llave). Por ahora
  rigen las reglas generales de §4.
- Publicar ofertas propias en los grupos (riesgo de baneo + cuota de ~300/mes;
  ver memoria `sofi-grupos-whatsapp`).
- Prospección de clientes.

**Supuesto de Juan:** el inventario de Wasi está depurado; lo que está
disponible en Wasi se puede ofrecer.

**Reemplaza** la regla del 2026-09-11 "toda cita va a Daiana, respaldo 8024"
(`regla-visitas-daiana`): ahora las citas rotan entre 2–3 asesores marcados y
el respaldo es el siguiente asesor de la rotación (§4.3).

## 2. Identidad pública

### 2.1 Modelo

Migración `2026-10-07_asesor_alias_y_citas.sql`:

```sql
alter table advisors add column if not exists alias_publico text;   -- "Asesor 1"
alter table advisors add column if not exists recibe_citas boolean not null default false;
alter table advisors add column if not exists orden_citas int;      -- orden de rotación
```

Editable en el CRM (ficha del asesor). Si `alias_publico` es null, el texto
usa "un asesor de Diamond", **nunca** el nombre.

### 2.2 Regla

Todo mensaje que sale hacia un **colega o cliente** (Cloud API o WAHA):
- firma `— Sofi, asistente virtual de Diamond`;
- no lleva nombre real ni celular de ninguna asesora;
- si nombra a una persona, usa `alias_publico`.

Hacia **adentro** (avisos a la asesora, CRM, Sofi-Comando) no cambia nada.

### 2.3 Sitios a cambiar

| Sitio | Hoy | Después |
|---|---|---|
| `src/agent/tools.js:972` confirmación al cliente/colega | "Te recibe {nombre}" | "Te recibe Asesor N" |
| `src/agent/tools.js:850` transferencia | nombre + link `wa.me` al asesor | "Asesor N te va a contactar"; sin link |
| `src/agent/tools.js:1647-1698` `pedir_contacto_asesora` | nombre + celular | "Asesor N te va a escribir/llamar"; sin celular |
| `src/agent/prompts.js:183` bloque COORDINA LAS VISITAS | nombre + celular | se elimina; Sofi solo sabe "Asesor N coordina" |
| `src/groups/redactar.js` firma del DM | "— Sofi, asistente virtual" | igual + "de Diamond" |

Cuando alguien pide hablar con una persona: Sofi le avisa a la asesora dueña
(por el mismo canal de §4.4) y le dice al colega/cliente que Asesor N lo
contactará. **Quien inicia el contacto es la asesora.**

### 2.4 Test

Test de guarda: recorre los generadores de texto hacia afuera con un asesor
de nombre `"ZZNombreReal"` y teléfono `"573000000000"` y falla si cualquiera
de los dos aparece en el texto.

## 3. Puente colega → Sofi

### 3.1 Código

Migración (mismo archivo):

```sql
alter table group_signals add column if not exists codigo_colega text;
alter table group_signals add column if not exists colega_escribio_at timestamptz;
alter table group_signals add column if not exists seguimiento_dm_at timestamptz;
alter table group_signals add column if not exists seguimiento_dm_canal text; -- 'plantilla' | 'linea_grupos'
create unique index if not exists uq_group_signals_codigo
  on group_signals (org_id, codigo_colega) where codigo_colega is not null;
```

Al armar el DM, cada señal recibe un código de 4 caracteres
(`[A-HJ-NP-Z2-9]`, sin 0/O/1/I), único por org.

### 3.2 Links

`linkContactoOficial` (`src/lib/contacto.js:142`) gana un parámetro de texto
prellenado (`?text=` urlencoded):

- **Presentación:** 🔎 *Más opciones o dudas* →
  `Hola Sofi, quiero más opciones para mi PEDIDO (cód. D7K2)`
- **Cada ficha:** 📅 *Agendar visita a esta* →
  `Hola Sofi, quiero agendar visita a la ref 10012722 (cód. D7K2)`

Reemplaza el renglón actual "Para que la conversación quede en nuestro
sistema…".

### 3.3 Reconocimiento

En `engine.js`, antes de la detección actual:

1. Si el texto trae `cód. XXXX` y existe una señal con ese código en la org →
   tomar su `colegas_grupos` (por `respuesta_destino_lid` / autor).
2. Si esa fila no tiene `telefono`, **escribir el teléfono real** del
   remitente (y la fila en `directorio_lids`). Desde ahí el colega se
   reconoce por teléfono siempre.
3. Contexto de Sofi: `source="colega"`, `ultimoPedido` = esa señal, la ref
   pedida si vino en el texto, y la intención (`agendar` | `mas_opciones`).
4. Marcar `group_signals.colega_escribio_at = now()` (lo usa §5.3).

Si el código no existe o fue borrado: flujo actual sin cambios.

Riesgo aceptado: alguien que reenvíe el link a un tercero hace que ese tercero
quede amarrado como el colega. Mitigación: solo se amarra si la fila no tenía
teléfono; si ya tenía uno distinto, se registra en log y no se pisa.

## 4. Agenda y confirmación

### 4.1 Horas que Sofi puede ofrecer

`appointments.checkAvailability` y un nuevo `horasDisponibles(asesor, desde, n)`:

- inicio ≥ ahora + **24 h** (`CITAS_ANTICIPACION_MIN_H`, default 24);
- dentro de `advisor.horario`;
- cada cita bloquea **60 min de visita + 90 min de desplazamiento**
  (`CITAS_DURACION_MIN=60`, `CITAS_TRASLADO_MIN=90`) **por asesor**: dos
  inicios del mismo asesor quedan a ≥ 150 min.

`agendar_cita` rechaza una hora fuera de estas reglas y devuelve a Sofi 3
alternativas válidas para ofrecer.

### 4.2 Asignación

Rotación round-robin entre `advisors` con `activo && recibe_citas`, ordenados
por `orden_citas`, **saltando** a quien no tiene esa hora libre. Reemplaza a
`findAsesorPrincipalRadar` en `agendar_cita`. Si ninguno está configurado,
cae al comportamiento actual (no rompe producción antes de configurarlo).

`leads.cita` suma: `asesor_id`, `asignada_at`, `corte_at` (= inicio − 4 h),
`historial` (lista de `{asesor_id, desde, hasta, motivo}`).

### 4.3 Escalera

Nuevo worker `src/scheduler/citas-escalera.js` (reemplaza la lógica de
`citas-recordatorio.js`), cada 5 min, sobre citas `propuesta`:

| Momento | Acción |
|---|---|
| 0 h | Aviso a la dueña (§4.4) |
| +2 h sin confirmar | Recordatorio a la dueña |
| +6 h sin confirmar | Reasignar al siguiente asesor de la rotación con hora libre; aviso a él/ella; se reinicia el reloj de +2 h para el nuevo |
| `corte_at` (faltan 4 h) sin confirmar | `estado=cancelada`, `motivo=sin_confirmar`; Sofi le escribe al colega/cliente: "no pudimos confirmar tu visita de {cuándo}, ¿te sirve otro horario?" |

Horas de silencio 20:00–08:00: los pasos de +2 h y +6 h que caigan ahí salen
a las 08:00. El corte se ejecuta siempre (por la anticipación de 24 h casi
siempre cae de día).

### 4.4 Aviso efectivo

- **WhatsApp:** plantilla de Meta `cita_por_confirmar` (utilidad) con dos
  botones de respuesta rápida: **✅ Confirmar** y **🕐 Otro horario**. Llega
  aunque la ventana de 24 h esté cerrada. `sendWhatsAppTemplate`
  (`src/channels/whatsapp.js:135`) se extiende para mandar el componente
  `button` con el payload `cita:<lead_id>:confirmar|otro`.
- Si la plantilla falla (no aprobada aún), cae a `entregarConRespaldo` como
  hoy.
- **Respaldo de entrega (Juan, 2026-10-07):** el 8024 ("Daiana Zea (línea
  2)") es el respaldo de entrega de Asesor 1: si el aviso no llega al 0668,
  sale por el 8024. Tiene `alias_publico='Asesor 1'` y `recibe_citas=false`
  (no rota como asesor propio). Rotación: Asesor 1 Daiana, Asesor 2 Claudia
  Valencia, Asesor 3 Catherine Uribe.
- Ojo: Natalia Velez (inactiva) tiene el mismo teléfono 8024; toda búsqueda
  de asesor por teléfono en este flujo debe filtrar `activo=true`.
- **Respuesta:** el webhook reconoce el payload del botón y llama a la misma
  lógica de `confirmar_cita` (sigue funcionando "OK CONFIRMADA" escrito).
  "Otro horario" → Sofi le pregunta a la asesora qué hora propone y se la
  ofrece al colega.
- Solo puede confirmar la dueña actual; si confirma una anterior tras la
  reasignación, se acepta y se avisa a la actual que ya no es suya.
- **CRM:** la cita aparece en vivo (Realtime sobre `leads`), con sonido y
  contador hasta `corte_at`.

### 4.5 Confirmación

Confirmada → Sofi avisa al colega/cliente: "Tu visita {cuándo} a la ref X
quedó CONFIRMADA. Te recibe Asesor N." (sin celular, §2).

## 5. Sofi vendedora senior, memoria y seguimiento

### 5.1 Prompt de colega

`promptColega` reescrito con rol de **vendedora senior**:
- responde dudas solo con datos de la ficha (no inventa; lo que no está, lo
  dice y ofrece averiguarlo con el asesor);
- ofrece **similares** con `buscar_propiedades` aplicando las reglas literales
  vigentes del motor (zona, piso, parqueaderos literales; precio con margen);
- no repite refs ya enviadas a ese colega (regla de 7 días existente);
- cierra siempre con una pregunta de avance: ¿agendamos? / ¿te paso más? /
  ¿alguna duda?;
- toda cita pasa por §4 (24 h, propuesta, confirma el asesor).

### 5.2 Memoria del colega

Al atender a un colega reconocido, el contexto incluye un resumen compacto:
nombre, grupos, últimos 5 pedidos (fecha, qué pidió), refs enviadas por pedido
y su resultado, citas (estado), marca `solo_llamada`. Sale de
`colegas_grupos` + `group_signals` + `leads.cita`, sin tabla nueva.

### 5.3 Seguimiento

| Cuándo | Condición | Canal |
|---|---|---|
| DM + 4 h | el colega no escribió a Sofi (`colega_escribio_at` null) y no respondió el DM; una sola vez por pedido | **Con teléfono:** plantilla `seguimiento_colega` desde la línea oficial. **Solo lid:** texto por la línea de grupos, pasando por `politica.decidirDm` (tope diario y cuota) |
| Sofi + 3 h | el colega le escribió a Sofi y no respondió el último mensaje | texto libre, línea oficial |
| Sofi + 24 h | sigue sin responder | plantilla `seguimiento_colega`, línea oficial; último toque |

Interruptor: `RADAR_SEGUIMIENTO_DM=false` apaga el de +4 h entero;
`SOFI_SEGUIMIENTO_COLEGA=false` apaga los de la línea oficial. Respetan
`solo_llamada` y horas de silencio.

Ojo: la cuota de WhatsApp no cuenta los envíos por lid (memoria
`cuota-whatsapp-no-cuadra-con-la-base`); la protección real del +4 h por la
línea de grupos es `RADAR_DM_TOPE_DIA`. Mirar la línea la primera semana.

## 6. Plantillas de Meta

**Subidas a revisión el 2026-10-07** en la WABA "Diamond" (`1702397800906189`),
categoría UTILITY, idioma `es`, pie "Sofi · Diamond Inmobiliaria". Estado al
subir: PENDING.

1. `cita_por_confirmar` (id `1275860604664515`) — a la asesora.
   "Nueva visita por confirmar 📅 / Propiedad: ref {{1}} / Fecha y hora: {{2}}
   / Solicitada por: {{3}} / Si no se confirma antes de {{4}}, la visita se
   cancela automáticamente." + botones QUICK_REPLY *Confirmar* / *Otro horario*.
2. `seguimiento_colega` (id `1289669134239903`) — al colega.
   "Hola {{1}}, te escribe Sofi, asistente virtual de Diamond Inmobiliaria,
   sobre tu pedido de {{2}}. ¿Alguna de las opciones que te enviamos le sirve a
   tu cliente? Si necesitás más opciones o tenés alguna duda, respondé este
   mensaje."
3. `cita_no_confirmada` (id `1163858416438726`) — al colega/cliente.
   "Hola {{1}}, no pudimos confirmar tu visita del {{2}} a la propiedad ref
   {{3}}. ¿Te sirve otro horario? Respondé este mensaje y la reagendamos."

Nota: `recordatorio_cita` (ya aprobada) le llega al **asesor**, no al cliente,
así que no entra en la regla de identidad pública de §2.

Hasta que estén aprobadas, cada camino cae al envío actual (texto libre /
`entregarConRespaldo`) y se registra en log.

## 7. Pruebas

- Unidad: `horasDisponibles` (24 h, horario, 150 min por asesor, dos asesores
  independientes); escalera (cada paso, horas de silencio, reasignación,
  corte); parser de código; amarre de teléfono (sin teléfono / con otro
  teléfono); guarda de identidad (§2.4); seguimiento (cada condición de no
  salida).
- `npm test` completo en verde.
- Punta a punta con un colega de prueba en producción, interruptores
  encendidos solo para él, antes de activarlos para todos.

## 8. Orden de construcción

Un commit por bloque: **§2 → §3 → §4 → §5**. La migración va al inicio de §2
y la corre Juan; se verifica por REST antes de desplegar código que la use.
