# App Diamond para asesores — diseño

Fecha: 2026-10-07 · Estado: **aprobado en conversación, pendiente de revisión escrita de Juan**
Depende de: `2026-10-07-sofi-vendedora-y-agenda-design.md` (citas, rotación, alias público).

## 0. Por qué

Juan pidió (2026-10-07) "algo así como la app de Innoarte" para los asesores de
Diamond: que vean a Sofi, sus leads, el calendario con sus agendas, marketing
para publicar, que puedan **publicar entre todos**, un **sistema de alertas**
(piden un asesor, se agenda una visita, se confirma una visita) y que el super
admin **configure los estados del kanban**.

Innoarte (`C:\Users\JuanPelaez\INNOARTE`) es un sistema de pedidos/taller de
una marquetería, no un CRM. Lo que se toma de ahí:
- panel **"Para atender"** por rol, calculado de los datos (desaparece solo al
  resolverse) — `INNOARTE/src/lib/panel/para-atender.ts`;
- app **instalable** (manifest + service worker) — `INNOARTE/src/app/manifest.ts`, `public/sw.js`;
- **configuración por organización** editada por el admin.

## 1. Decisión: se extiende el CRM, no se crea otra app

El CRM (`crm/`, `crm.diamondinmobiliaria.com`) ya tiene: Sofi, inbox, leads,
kanban, calendario, marketing (publicaciones, cola, calendario, plantillas),
grupos, equipo, usuarios con roles `admin | asesor_*` (`crm/lib/auth`). Falta:
vista personal, notificaciones, PWA, kanban configurable, publicación por
asesor. Comparte la Supabase con el bot y se despliega solo con el push.

## 2. Roles y visibilidad (decisión: "solo lo mío")

- Cada usuario asesor se liga a su fila en `advisors` por
  `advisors.auth_user_id` (existe).
- **Asesor ve:** sus leads (`owner_id` o `transferido_advisor_id` = su
  advisor), sus conversaciones de Sofi, sus notificaciones, sus
  publicaciones, y **el calendario de visitas completo del equipo** (sus citas
  resaltadas), porque con la rotación horaria cualquiera puede confirmar una
  cita de otro.
- **Admin ve todo** y configura.
- El filtro se aplica en el servidor (API/queries del CRM), no solo en la UI.

## 3. Pantallas del asesor

| Pantalla | Contenido |
|---|---|
| **Para atender** (inicio) | Citas por confirmar (con contador a la próxima rotación), pedidos de contacto, leads suyos sin respuesta > 2 h. Calculado de los datos |
| **Sofi** | Conversaciones de Sofi con sus leads; tomar la conversación a mano (modo humano existente en `conversations.modo`) |
| **Mis leads** | Kanban con los estados de §5 |
| **Calendario** | Visitas del equipo; las suyas resaltadas; confirmar desde la cita |
| **Publicar** | §6 |
| **Campana** | Historial de notificaciones, contador de no leídas |

Navegación móvil con barra inferior; escritorio con la barra lateral actual.

## 4. Notificaciones

### 4.1 Modelo

```sql
create table notificaciones (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  advisor_id uuid not null references advisors(id) on delete cascade,
  tipo text not null,          -- ver 4.2
  titulo text not null,
  cuerpo text,
  link text,                   -- ruta del CRM
  lead_id uuid,
  leida_at timestamptz,
  created_at timestamptz not null default now()
);
create table push_suscripciones (
  id uuid primary key default gen_random_uuid(),
  advisor_id uuid not null references advisors(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
```

Realtime sobre `notificaciones` para la campana.

### 4.2 Eventos y canales

| Evento (`tipo`) | Campana | Push | WhatsApp |
|---|---|---|---|
| `cita_por_confirmar` (incluye la que llega por rotación) | ✔ | ✔ | ✔ plantilla `cita_por_confirmar` |
| `asesor_solicitado` (colega/cliente pide hablar con un asesor) | ✔ | ✔ | ✔ plantilla nueva `asesor_solicitado` |
| `cita_reasignada` ("ya la tiene Asesor N") | ✔ | ✔ | — |
| `cita_confirmada` | ✔ | ✔ | — |
| `cita_cancelada` | ✔ | ✔ | — |
| `publicacion_hecha` / `publicacion_fallida` | ✔ | — | — |

Un único módulo en el bot, `src/notifications/notificar.js`, escribe la fila,
manda el push (web-push con claves VAPID en env) y, si el tipo lo lleva, la
plantilla. Todo camino nuevo hacia el asesor pasa por él. Respeta
`ASESORA_SOLO_VISITAS` (los tipos de cita y `asesor_solicitado` siguen
saliendo, como hoy).

### 4.3 PWA

`crm/app/manifest.ts` + `crm/public/sw.js` (cachea estáticos, nunca `/api`,
maneja `push` y `notificationclick`). Pantalla "Activar notificaciones" en el
primer ingreso; en iPhone explica que hay que agregarla a la pantalla de inicio.

## 5. Kanban configurable

```sql
create table lead_estados (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  clave text not null,              -- lo que se guarda en leads.estado
  nombre text not null,
  color text not null,
  orden integer not null,
  sistema boolean not null default false,
  oculto boolean not null default false,
  auto_evento text,                 -- visita_propuesta | visita_confirmada | visita_cancelada | null
  unique (org_id, clave)
);
```

- Semilla por org con los 7 actuales (`crm/lib/types.ts` `ESTADOS`), con
  `sistema=true` para `nuevo, en_conversacion, calificado, transferido,
  cerrado_ganado, cerrado_perdido` (los que escribe Sofi o cierran el ciclo).
  `descartado` queda como propio.
- **Sistema:** renombrar, color, orden; no borrar, no cambiar la clave.
- **Propios:** crear, editar, ocultar; borrar solo si no tiene leads.
- **Automatismos:** al ocurrir `visita_propuesta | visita_confirmada |
  visita_cancelada` en un lead, pasa al estado con ese `auto_evento` (si hay
  uno configurado). Nunca saca un lead de `cerrado_*`.
- `ESTADOS`/`ESTADO_LABELS` dejan de ser constantes y se leen de la tabla
  (kanban, filtros, ficha del lead). Pantalla en el super admin:
  "Estados del pipeline", con arrastrar para ordenar.

## 6. Publicar entre todos

Decisión de Juan: **todos publican, sin aprobación**; lo publicado queda
**marcado** para que nadie más lo repita.

### 6.1 Modelo

```sql
create table publicaciones_asesor (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  advisor_id uuid not null references advisors(id),
  property_ref text,                -- ref de Wasi, o null si es pieza libre
  canal text not null,              -- grupo | facebook | instagram
  destino text,                     -- id del grupo (canal=grupo)
  texto text,
  media jsonb not null default '[]',
  estado text not null,             -- programada | publicada | fallida
  programada_para timestamptz,
  publicada_at timestamptz,
  bloqueo_hasta timestamptz,        -- fin del candado
  created_at timestamptz not null default now()
);
```

### 6.2 Candado

- Por **propiedad + canal (+ grupo)**: si existe una publicación `publicada`
  o `programada` de esa ref, en ese canal y destino, con `bloqueo_hasta >
  now()`, nadie más puede publicarla ahí.
- Duración configurable en `organizations` (settings): grupos **7 días**,
  redes **15 días**.
- La app muestra la marca en la propiedad: "Publicada por Asesor 2 en Grupo X
  el 7-oct · libre desde el 14-oct". Otro canal u otro grupo sí se puede.

### 6.3 Grupos

- Sale por la línea del radar (WAHA) con `waha.enviarTexto`/media, pasando
  por un freno propio: **tope diario de publicaciones en grupos entre todos**
  (`GRUPOS_PUBLICAR_TOPE_DIA`, default 5) y la cuota de WhatsApp de
  `politica`. Si el cupo del día está lleno, queda `programada` para el día
  siguiente y la app lo dice.
- Solo grupos con `escuchar`/permitidos marcados por el admin como
  "acepta publicaciones".
- Firma: "— Sofi, asistente virtual de Diamond" + link de Sofi con código
  (spec de agenda §3), para que la respuesta caiga en Sofi.
- Interruptor `GRUPOS_PUBLICAR_ACTIVO`.

### 6.4 Facebook / Instagram

- Desde Marketing, el asesor elige la propiedad; DMAP genera el creativo (motor
  existente) y lo programa en la cola existente. Se registra en
  `publicaciones_asesor` para el candado.

## 7. Fases

Después del spec de agenda. Un spec → plan → implementación por fase:

1. **F1** — roles y "solo lo mío", Para atender, notificaciones (tabla, campana, push, `notificar.js`, plantilla `asesor_solicitado`), PWA.
2. **F2** — kanban configurable y automatismos.
3. **F3** — publicar en Facebook/Instagram por asesor con candado.
4. **F4** — publicar en grupos con candado y tope diario.

## 8. Riesgos

- **Grupos:** cuota de ~300/mes y riesgo de baneo de la línea; el tope diario
  es la protección real (la cuota no ve los envíos por lid).
- **Push en iPhone:** solo con la app agregada a la pantalla de inicio; por
  eso los dos eventos urgentes también van por WhatsApp.
- **Migrar `ESTADOS`:** el bot escribe claves de sistema; no pueden cambiar.

## 9. Pruebas

Unidad: filtro "solo lo mío" en cada API, candado (mismo canal/grupo vs
otro), tope diario, automatismos de kanban, no borrar estado con leads,
`notificar.js` por tipo. `npm test` del bot y `npm run build` del CRM en verde.
Prueba en celular real (Android e iPhone) de instalación y push.
