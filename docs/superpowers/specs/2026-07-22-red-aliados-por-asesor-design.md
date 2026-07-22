# Red de aliados por asesor — asistente personalizado + aviso inmediato

**Fecha:** 2026-07-22
**Estado:** Aprobado por Juan, pendiente de plan de implementación

## Contexto

Diamond ya tiene:
- Login por asesor con contraseña (`/usuarios` en el CRM, Supabase Auth, `advisors.auth_user_id`).
- Sofi-Comando: asistente interno personalizado por asesor (cada uno ve sus propios leads vía `owner_id`; el admin ve toda la org).
- `ally_properties`: tabla + tool `registrar_propiedad_aliado` para guardar propiedades que colegas de otras inmobiliarias comparten — hoy SOLO se dispara cuando el colega mismo le escribe al bot público de WhatsApp (como si fuera un lead).
- Fallback silencioso: si `buscar_propiedades` no encuentra nada en inventario propio, se busca en `ally_properties` y se guarda el match en `ctx.allyMatch`, pero nunca se le revela al cliente (precio/ref/zona exacta). Hoy ese match solo llega al asesor como nota dentro de la alerta de transferencia (y va al asesor de la especialidad, no al dueño del contacto).

Lo que falta: que sea el **asesor** (no el colega) quien registre la propiedad ajena desde Sofi-Comando, que quede trazado qué asesor + qué colega, y que cuando un cliente pregunte por algo que hace match, se avise **de inmediato por WhatsApp al asesor dueño de ese contacto** (no al de la especialidad), para que valide disponibilidad antes de comprometerse con el cliente.

## Decisiones (de la sesión de brainstorming)

1. **Punto de entrada:** el asesor registra la propiedad del colega chateando con Sofi-Comando (lenguaje natural), no un formulario nuevo.
2. **Canal de aviso:** WhatsApp directo al asesor, igual mecanismo que ya existe para alertas de transferencia.
3. **Visibilidad:** cualquier asesor puede ver/consultar cualquier propiedad de colega registrada por otro (red de equipo compartida) vía `buscar_red_aliados` (ya existe, no cambia). El aviso de disponibilidad, en cambio, siempre va al asesor que la registró.
4. **Momento del aviso:** inmediato al detectar el match con un cliente — no se espera a que el cliente califique o se transfiera.
5. **Seguridad:**
   - El cliente nunca ve datos del colega (nombre, teléfono, inmobiliaria) ni precio/ref/zona exacta de su propiedad — solo se le puede reflejar la zona que **él mismo** pidió, para mantenerlo enganchado, y decirle que un asesor lo contactará pronto.
   - Solo un asesor autenticado (sesión de Sofi-Comando, login con contraseña) puede registrar una propiedad de colega — el bot público de WhatsApp no tiene esa tool, así que nadie externo puede inyectar una propiedad falsa por ese canal.
   - Trazabilidad: cada propiedad de colega guarda qué asesor la registró; cada aviso de match queda registrado (para auditoría y para no duplicar avisos).

## Diseño

### 1. Modelo de datos

Migración `db/migrations/2026-07-22_ally_properties_asesor.sql`:

```sql
alter table ally_properties add column if not exists registrado_por uuid references auth.users(id) on delete set null;

create table if not exists ally_property_alerts (
  id uuid primary key default gen_random_uuid(),
  ally_property_id uuid not null references ally_properties(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (ally_property_id, lead_id)
);
```

- `registrado_por` nullable: las filas del flujo viejo (colega escribiéndole al bot) quedan sin dueño; sin dueño, el aviso sigue el comportamiento actual (nota en la alerta de transferencia, al asesor de la especialidad).
- `ally_property_alerts` es la fuente de verdad del dedup: si ya existe la fila `(ally_property_id, lead_id)`, no se manda un WhatsApp nuevo aunque el cliente insista.
- RLS: mismo patrón que `ally_properties` (solo lectura para `authenticated`; escrituras vía `service_role`).

### 2. Registro desde Sofi-Comando

Nueva tool `registrar_propiedad_colega` en `src/agent/sofi-comando-tools.js` y su handler en `executeCommandTool`, mismo patrón que las 8 tools existentes ahí (`scope` viene del servidor, nunca del modelo). Campos: los mismos que ya acepta `registrar_propiedad_aliado` (ref, título, tipo, operación, precio, zona, ciudad, descripción, inmobiliaria_origen, contacto_nombre) más, opcionalmente, el teléfono del colega si el asesor lo da.

Handler llama `allyProperties.create(scope.orgId, { ...campos, registrado_por: scope.viewerUid })`. Se reutiliza `src/data/ally-properties.js` tal cual — solo se agrega el campo nuevo al objeto que se inserta/actualiza.

`buscar_red_aliados` (ya existe) no cambia: ya muestra todo el detalle al asesor.

### 3. Match con cliente + aviso inmediato

En `src/agent/tools.js`, dentro de `buscar_propiedades`, cuando no hay inventario propio y sí hay `posibleMatch` de la red de aliados:

1. Se intenta insertar `(ally_property_id, lead_id)` en `ally_property_alerts`. Si ya existía (conflicto), no se genera aviso nuevo — el resto del comportamiento (mensaje al cliente) sigue igual.
2. Si es la primera vez y `posibleMatch[0].registrado_por` no es null: se resuelve el asesor dueño (`advisors.findByAuthUserId(orgId, registrado_por)`, función nueva en `src/data/advisors.js`) y se guarda en `ctx.allyAlert = { advisor, allyMatch }` para que `engine.js` lo recoja.
3. `engine.js` (`procesarMensaje`), además del `transfer` actual, devuelve un `allyAlert: { advisorPhone, advisorAlert }` independiente cuando `ctx.allyAlert` está presente — no depende de que el lead se transfiera o califique.
4. `src/channels/whatsapp.js` y `telegram.js`: si la respuesta trae `allyAlert`, se envía ese WhatsApp al asesor igual que hoy se envía `transfer.advisorAlert` (mismo `sendWhatsApp`/`sendTelegram`).
5. Si `registrado_por` es null (match del flujo viejo, sin dueño), se mantiene el comportamiento actual sin cambios: nota dentro de `buildAdvisorAlert` cuando el lead se transfiere, al asesor de la especialidad.

Texto del aviso (nuevo, en `src/notifications/advisor.js`): incluye nombre/inmobiliaria del colega, breve descripción de su propiedad (tipo, zona, precio, ref), y quién preguntó (nombre/teléfono del cliente) — para que el asesor valide disponibilidad con su colega y decida si contactar al cliente.

Mensaje al cliente (ajuste en `tools.js`, línea ~185): deja de ocultar la zona que el cliente mismo pidió. Nuevo AVISO INTERNO: *"no reveles precio, ref, ni ningún dato del colega — puedes decirle al cliente que tienes una opción por esa zona (la que él pidió) y que un asesor lo contactará pronto para confirmar"*.

### 4. Seguridad (resumen)

- `registrar_propiedad_colega` vive únicamente en las tools de Sofi-Comando (autenticado); el bot público de WhatsApp no la expone.
- RLS existente en `ally_properties` no se relaja; `ally_property_alerts` nace con el mismo patrón (solo lectura para el equipo, escritura por `service_role`).
- Trazabilidad: `registrado_por` (quién registró) + `ally_property_alerts` (qué avisos salieron, cuándo, para qué lead).

## Fuera de alcance

- El flujo viejo (colega escribiéndole directo al bot público) no se toca — sigue funcionando igual.
- No se construye formulario nuevo en `/aliados` — solo el chat de Sofi-Comando.
- No se agregan roles/permisos nuevos: el control de acceso ya existente (login + RLS) es suficiente para esta feature.
