# Calendario grupal + validación de agenda del asesor

**Fecha:** 2026-07-23
**Estado:** Aprobado por Juan, listo para plan

## Contexto

Hoy el bot (`agendar_cita` en `src/agent/tools.js`) guarda la cita como texto
libre en `leads.cita` (jsonb, migración `2026-07-05_agenda.sql`) sin validar
nada: no sabe de qué asesor es la agenda, no evita choques de horario, y el
asesor se entera solo cuando el lead se transfiere (alerta de WhatsApp). El
CRM no tiene un calendario. El equipo ya es de varios asesores (feature
`/usuarios` con login por asesor, `advisors.auth_user_id`).

## Decisiones (de la sesión)

1. El calendario grupal muestra **solo citas con clientes** (dato del negocio,
   todo el equipo lo ve). Los recordatorios personales (`advisor_reminders`)
   siguen privados y NO entran.
2. Bloqueo de agenda = **evitar choques entre clientes del mismo asesor** +
   **horario laboral fijo por asesor** (días y franja horaria).
3. La validación es contra la agenda del **asesor de la especialidad** (mismo
   criterio de resolución que la transferencia actual).
4. Duración de visita por defecto: **1 hora**. Dos citas del mismo asesor a
   menos de 1h se consideran choque.

## Diseño

### 1. Modelo de datos (migración `2026-07-23_agenda_horarios.sql`)

- `advisors.horario jsonb` — horario laboral. Forma:
  `{ "dias": [1,2,3,4,5], "desde": "08:00", "hasta": "18:00" }`
  (`dias`: 0=domingo … 6=sábado, hora local Colombia). Nullable: si es null,
  se usa el default L–V 08:00–18:00 en código.
- Las citas siguen en `leads.cita`. Se le agrega al objeto `cita` un campo
  `advisor_id` (uuid del `auth.users` del asesor dueño de esa agenda),
  estampado al agendar. No cambia el schema (es jsonb libre), pero se
  documenta el nuevo campo.

### 2. Capa de datos del bot (`src/data/appointments.js`, nuevo)

- `DEFAULT_HORARIO = { dias: [1,2,3,4,5], desde: "08:00", hasta: "18:00" }`.
- `DURACION_MIN = 60`.
- `dentroDeHorario(horario, fechaHoraIso) → boolean`: valida día de semana y
  franja horaria en zona `America/Bogota`. Usa `DEFAULT_HORARIO` si `horario`
  es null.
- `checkAvailability(orgId, advisor, fechaHoraIso) → { disponible, motivo }`:
  1. `motivo: "fuera_de_horario"` si `!dentroDeHorario(advisor.horario, iso)`.
  2. `motivo: "choque"` si existe otra cita del MISMO asesor
     (`cita.advisor_id === advisor.auth_user_id`) a < 60 min de distancia.
  3. Si no, `{ disponible: true }`.
  - La consulta de choques trae los leads de la org con `cita` no nula
    (`supabase ... .not("cita","is",null)`, límite 500) y filtra en JS por
    `advisor_id` + ventana de ±60 min. Volumen bajo (decenas/día), no
    necesita índice jsonb. En modo memoria, filtra `memory.leads`.
- Sin `auth_user_id` en el asesor (asesor sin login del CRM), no se puede
  atribuir la agenda: se omite la validación de choque (solo se valida
  horario) y se agenda igual — comportamiento no peor que hoy.

### 3. Bot — `agendar_cita` valida y notifica

En `src/agent/tools.js`, dentro de `agendar_cita`, cuando hay `fecha_hora_iso`:
1. Resolver el asesor de la especialidad con la MISMA lógica que
   `transferir_a_asesor` pero sin el `input.especialidad` (que aquí no
   existe): `ESP_POR_INTENCION[ctx.lead.intencion]` →
   `ctx.propertyInteres.operacion` → `"venta"`; luego
   `advisors.findForTransfer(ctx.org, especialidad)`.
2. `checkAvailability(...)`:
   - `disponible: false` → NO persiste la cita. Devuelve al modelo un aviso:
     dile al cliente que ese horario no está disponible (por
     `fuera_de_horario` o `choque`) y ofrécele proponer otro; no inventes
     horarios libres, pregúntale qué otro día/hora le sirve.
   - `disponible: true` → estampa `cita.advisor_id = advisor.auth_user_id`,
     persiste (best-effort, como hoy) y setea
     `ctx.appointmentAlert = { advisorPhone, advisorAlert }` para el aviso
     inmediato.
3. Si NO hay `fecha_hora_iso` (cliente vago), comportamiento actual sin
   cambios: guarda la cita como texto, sin validar ni notificar (no hay hora
   que validar).

### 4. Notificación inmediata al asesor

- `buildAppointmentAlert(advisor, lead, cita)` en `src/notifications/advisor.js`:
  mensaje con nombre/teléfono del cliente, tipo de cita, día y hora legibles
  (reutiliza `formatCitaFechaHora`), y el inmueble de interés si hay. Sigue el
  patrón de `buildAllyClientMatchAlert`.
- `engine.js` devuelve `appointmentAlert` (además de `transfer`/`allyAlert`),
  independiente: se dispara apenas se confirma la cita, no espera transferencia.
- `whatsapp.js` / `telegram.js` lo envían igual que `allyAlert` (bloque `if`
  separado; en Telegram con su propio marcador de demo).

### 5. CRM — calendario grupal (`/calendario`, nuevo)

- Página server-side visible para TODO el equipo (link nuevo en el nav de
  `app/(dashboard)/layout.tsx`, sin guard de admin).
- Lee `leads` con `cita` no nula de la org; agrupa por día (patrón de
  `marketing/calendario/page.tsx`), muestra hora, cliente, tipo, propiedad de
  origen y el nombre del asesor (vía `getTeamRoster()` + `cita.advisor_id`),
  con un color por asesor.
- Solo lectura (no se editan citas desde aquí en esta fase).

### 6. CRM — editor de horario laboral

- En `/usuarios`, por cada usuario, un editor de horario (días + franja) que
  escribe `advisors.horario`. Reutiliza `PATCH /api/users` (agregar campo
  `horario` opcional al payload) o un endpoint dedicado
  `PATCH /api/users/horario`. Cada asesor puede fijar el suyo; el admin, el de
  cualquiera. Default visible: L–V 08:00–18:00.

## Fuera de alcance

- Sincronización con Google Calendar externo (el link "agregar a Google
  Calendar" del asesor ya existe y no se toca).
- Reprogramar/cancelar citas desde el calendario del CRM (solo lectura).
- Los recordatorios personales no entran al calendario grupal.
- Elegir "cualquier asesor libre" — se valida contra el asesor de la
  especialidad, no se busca el primer libre.

## Seguridad / multi-tenant

- Toda consulta lleva `org_id`. `checkAvailability` filtra por org.
- `cita.advisor_id` se estampa server-side desde el asesor resuelto, nunca
  desde input del modelo.
- El editor de horario exige sesión; escribir el horario de otro solo lo
  permite un admin (mismo `requireAdmin` que ya usa `/api/users`).
