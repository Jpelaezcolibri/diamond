# Diseño — Fecha y hora estilo WhatsApp en CRM (leads y mensajes)

## Contexto

El equipo de Diamond necesita ver, dentro del CRM, la fecha y hora exactas de
ingreso de un lead y de cada mensaje/respuesta, con una presentación tipo
WhatsApp. La base de datos ya persiste estos timestamps en cada insert/update
(`leads.created_at`, `leads.updated_at`, `messages.created_at`,
`conversations.last_activity_at`, todos `timestamptz`) — el problema es que
la interfaz de `crm/` no los muestra de forma consistente hoy:

- **Chat** ([crm/components/chat-view.tsx](../../../crm/components/chat-view.tsx)):
  cada burbuja muestra solo la hora (`HH:MM`), sin fecha ni separadores de día.
- **Lista de conversaciones** ([crm/components/inbox-list.tsx](../../../crm/components/inbox-list.tsx)):
  solo tiempo relativo ("hace 5 min"), nunca fecha/hora exacta.
- **Kanban** ([crm/components/kanban-board.tsx](../../../crm/components/kanban-board.tsx)):
  las tarjetas de lead no muestran ninguna fecha.
- **Tabla de Leads** ([crm/components/leads-table.tsx](../../../crm/components/leads-table.tsx)):
  no tiene columnas de fecha de ingreso ni de última actividad.

No se requiere ningún cambio de schema ni migración: es exclusivamente trabajo
de lectura adicional (un join liviano a `conversations` donde falta) y de
presentación.

## Alcance

Las 4 vistas del CRM: chat del inbox, lista de conversaciones, kanban y tabla
de leads. Sin cambios en el bot (`src/`), sin cambios en `db/schema.sql`.

## Definición de "última actividad" de un lead

Se usa `conversations.last_activity_at` (se actualiza en cada mensaje entrante
o saliente, ver `src/api/crm.js:61,118` y `src/data/conversations.js:25`) —
**no** `leads.updated_at`, que solo cambia cuando se editan campos del lead
(score, estado, etc. via `src/data/leads.js:37`) y por tanto no refleja
actividad de conversación real.

Si un lead tuviera más de una fila en `conversations` (el schema no lo impide,
aunque en la práctica hay una activa por lead), se toma el `last_activity_at`
más reciente.

## Diseño

### 1. Helpers de formato (`crm/lib/types.ts`)

Junto a la función existente `relativeTime(iso)`, se agregan dos funciones
puras, sin nuevas dependencias (mismo estilo `Intl`/`Date` nativo que ya usa
el archivo):

- `absoluteDateTime(iso: string): string` — fecha y hora completas en
  `es-CO`, para usar como `title` (tooltip nativo del navegador). Ejemplo:
  `"14 jul 2026, 3:45 p. m."`.
- `dayLabel(iso: string): string` — para separadores de día en el chat.
  Devuelve `"Hoy"` si es el día calendario actual, `"Ayer"` si es el
  anterior, o la fecha larga (`"14 de julio"`, agregando el año solo si no
  es el año en curso) en cualquier otro caso.

### 2. Datos: última actividad por lead

En las dos páginas server-component que listan leads sin pasar por
`conversations` hoy, se agrega una consulta paralela y un mapeo:

- [crm/app/(dashboard)/leads/page.tsx](../../../crm/app/(dashboard)/leads/page.tsx):
  agregar `supabase.from("conversations").select("lead_id, last_activity_at")`
  al `Promise.all` existente, reducir a `Record<leadId, iso>` tomando el máximo,
  pasar como prop nueva `lastActivityByLead` a `LeadsTable`.
- [crm/app/(dashboard)/kanban/page.tsx](../../../crm/app/(dashboard)/kanban/page.tsx):
  la consulta a `conversations` ya existe (`estado, activa`) — se le agrega la
  columna `last_activity_at` al `select` y se construye el mismo tipo de mapa,
  pasado a `KanbanBoard` como `lastActivityByLead`.

### 3. Chat (`crm/components/chat-view.tsx`)

Al iterar `messages` para renderizar las burbujas, se compara el día
calendario de `m.created_at` contra el del mensaje anterior (el primer
mensaje del arreglo siempre dispara separador). Cuando cambia, se inserta un
elemento centrado tipo WhatsApp (`dayLabel(m.created_at)`) antes de la
burbuja. La hora que ya se muestra (`hora()`, `HH:MM`) no cambia; se le agrega
`title={absoluteDateTime(m.created_at)}` al `<span>` de la hora para ver la
fecha completa al pasar el mouse.

### 4. Lista de conversaciones (`crm/components/inbox-list.tsx`)

El `<span>` que ya muestra `relativeTime(c.last_activity_at)` (línea 95) se
mantiene igual; se le agrega `title={absoluteDateTime(c.last_activity_at)}`.

### 5. Kanban (`crm/components/kanban-board.tsx`)

`LeadCard` recibe una prop nueva `lastActivity?: string` (viene del mapa
armado en la página). Se agrega una línea pequeña de metadata bajo la fila de
`OwnerBadge`/"Ver chat", con dos textos separados por `·`:

- `Ingreso: {relativeTime(lead.created_at)}` (siempre disponible, es un campo
  propio de `leads`)
- `Act.: {relativeTime(lastActivity)}` (solo si existe una conversación
  asociada)

Ambos con `title={absoluteDateTime(...)}` para la fecha completa. `KanbanBoard`
propaga `lastActivityByLead` desde sus props hasta `LeadCard`/`DraggableCard`.

### 6. Tabla de leads (`crm/components/leads-table.tsx`)

Se agregan dos columnas nuevas, ocultas en mobile igual que "Tablero" y
"Propiedad" (`hidden md:table-cell`):

- **Ingreso** — `relativeTime(l.created_at)` con tooltip de fecha completa.
- **Última actividad** — `relativeTime(lastActivityByLead[l.id])` con tooltip;
  si no hay conversación asociada, se muestra `—`.

`LeadsTable` recibe la prop nueva `lastActivityByLead: Record<string, string>`
desde `leads/page.tsx`.

## Errores y casos borde

- Lead sin conversación asociada (no debería ocurrir en el flujo normal, pero
  el mapa puede no tener la clave): se muestra `—` en vez de fallar.
- Timestamp inválido o vacío: los helpers ya siguen el patrón de `hora()`
  actual (try/catch que devuelve cadena vacía) para no romper el render.
- No hay escritura nueva a la base de datos, por lo que no hay riesgo de
  pérdida de datos ni de migración.

## Testing / verificación

Sin suite de tests automatizados para `crm/` en este momento (proyecto sin
`npm run test` configurado en `crm/package.json`); la verificación es manual
en el dev server:

1. Abrir `/inbox/[id]` con una conversación de varios días → confirmar
   separadores de día y tooltip de hora en burbujas.
2. Abrir `/inbox` → confirmar tooltip de fecha completa en la lista.
3. Abrir `/kanban` → confirmar líneas de ingreso/actividad en tarjetas.
4. Abrir `/leads` → confirmar columnas nuevas y su comportamiento en mobile
   (ocultas) vs desktop.

## Decisiones diferidas

- Métricas de tiempo de respuesta (SLA, tiempo entre mensaje del cliente y
  respuesta del asesor/Sofi) — fuera de alcance, esto es solo visualización.
- Exportar o filtrar leads por rango de fechas — no solicitado.
