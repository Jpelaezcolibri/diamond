# Captador de propiedades — Design

**Fecha:** 2026-07-24 · **Estado:** aprobado en conversación con Juan (pendiente review de este doc)

## Problema

Hoy una propiedad del inventario no tiene asesor "dueño". Cuando un cliente de
WhatsApp se interesa por una propiedad que captó Natalia, nadie le avisa a
Natalia, y la transferencia va al asesor genérico de la especialidad. Juan
quiere poder decirle a Sofi en el CRM: *"márcame la propiedad 10207832 a
nombre de la asesora Natalia"*, y que a partir de ahí el negocio de esa
propiedad sea de ella.

## Decisiones tomadas (con Juan, 2026-07-24)

1. **Aviso inmediato + transferencia al captador.** Apenas un cliente muestra
   interés en una propiedad marcada, el captador recibe un WhatsApp. Si el
   lead se transfiere, se transfiere al captador, no al asesor de la
   especialidad.
2. **Cualquiera marca.** (Corregido por Juan 2026-07-24: antes era solo
   admin.) Cualquier usuario de Sofi-Comando puede marcar y reasignar con
   "sofi, marca la propiedad 10207832 a nombre de Natalia". Si el asesor no
   existe o el nombre es ambiguo, Sofi vuelve a preguntar — nunca adivina.
3. **Manda la última propiedad de interés.** Al transferir, si la propiedad
   que el cliente está mirando (`ctx.propertyInteres`) tiene captador → va al
   captador; si no → flujo actual por especialidad. La intención "vender"
   sigue mandando por encima de todo (un vendedor nunca se enruta por
   captador).

## Arquitectura

Calca el patrón ya desplegado de **propiedades de aliados** (`registrado_por`
+ `ally_property_alerts` + aviso inmediato `buildAllyClientMatchAlert`), que
resuelve exactamente este problema para inventario ajeno.

### 1. Datos (migración `2026-07-24_property_captador.sql`)

- `properties.captador_id uuid references advisors(id) on delete set null` —
  columna nueva, nullable. El sync de Wasi/DMAP solo actualiza sus propios
  campos, así que la asignación sobrevive a cada sync.
- Tabla `property_owner_alerts` (dedup + auditoría, espejo de
  `ally_property_alerts`): `id, property_id → properties, lead_id → leads,
  org_id, created_at, unique(property_id, lead_id)`. RLS "team read", escrituras
  vía service_role.
- Se referencia `advisors.id` (no `auth.users`): el aviso viaja por WhatsApp a
  `advisors.phone`, y no todos los asesores tienen login del CRM.

### 2. Sofi-Comando (CRM) — `src/agent/sofi-comando-tools.js`

- **Tool nueva `marcar_propiedad`** `{ ref, asesor }` (cualquier rol):
  - Busca la propiedad por ref en el inventario propio; si no existe, lo dice.
  - Busca el asesor por nombre en `advisors` (nueva función
    `advisors.searchByName(orgId, q)` con `ilike`): 0 matches → lo dice y
    vuelve a preguntar el nombre; >1 → lista los candidatos y pide precisar.
  - Guarda `captador_id` y confirma. Si la propiedad ya tenía otro captador,
    lo menciona ("reemplaza a X").
- **Tool nueva `consultar_captador`** `{ ref?, asesor? }` (todos los roles):
  con `ref` responde quién es el captador; con `asesor` lista las propiedades
  marcadas a su nombre.
- Prompt (`sofi-comando-prompts.js`): bloque nuevo CAPTADOR DE PROPIEDADES con
  las reglas de arriba.

### 3. Sofi-Cliente (WhatsApp) — aviso inmediato

- `src/notifications/advisor.js`: `buildCaptadorInterestAlert(property, lead)`
  — espejo de `buildAllyClientMatchAlert`: "¡Cliente interesado en tu
  propiedad! {nombre} (+{phone}) pregunta por la ref {ref} — {titulo}, {zona}.
  Sofi lo está atendiendo; si califica te lo transfiere."
- `src/agent/tools.js`: helper `maybeCaptadorAlert(ctx, property)` que se
  dispara en los DOS puntos donde se fija `ctx.propertyInteres`:
  1. `buscar_propiedades` cuando el cliente pide una propiedad (línea ~154).
  2. `engine.js` cuando el lead entra por un ad con `property_ref_origen`
     (línea ~104).
  Lógica: si `property.captador_id` → `registerOwnerAlert(orgId, propertyId,
  leadId)` (dedup por unique, mismo patrón `error.code 23505` → false) → si es
  nuevo, `advisors.findById` → `ctx.captadorAlert = { advisorPhone,
  advisorAlert }`. Best-effort con try/catch: si la migración no corrió, el
  bot no se cae.
- `engine.js` devuelve `captadorAlert`; `channels/whatsapp.js` lo envía igual
  que `allyAlert`/`appointmentAlert`.

### 4. Sofi-Cliente — transferencia al captador

En `transferir_a_asesor` (`src/agent/tools.js:321`):

```
si intencion NO es "vender" ni "vehiculos"
y ctx.propertyInteres?.captador_id existe:
    advisor = advisors.findById(orgId, captador_id)   // solo si activo
    si advisor → usarlo (especialidad etiquetada "captador")
fallback (sin captador, asesor inactivo o no encontrado): findForTransfer por especialidad, como hoy
```

El resto del flujo (owner_id, categoría, link al cliente, alerta de
transferencia) no cambia.

### 5. Capa de datos

- `src/data/advisors.js`: `findById(orgId, id)` y `searchByName(orgId, q)`.
- `src/data/properties.js`: `setCaptador(orgId, propertyId, advisorId)` y
  `listByCaptador(orgId, advisorId)`.
- `src/data/property-owner-alerts.js` (o dentro de properties.js):
  `registerOwnerAlert(orgId, propertyId, leadId)` — espejo de
  `allyProperties.registerAlert`.
- Modo demo (sin Supabase): degradar a memoria como el resto de `src/data/*`.

## Errores y bordes

- Migración pendiente → todos los caminos nuevos son best-effort (try/catch +
  warn), el bot sigue funcionando como hoy.
- Asesor captador inactivo (`activo=false`) → se ignora: aviso no se manda,
  transferencia cae al flujo por especialidad.
- Dos asesores con el mismo nombre → Sofi-Comando pregunta, nunca adivina.
- El mismo cliente insiste con la misma propiedad → un solo aviso (dedup).
- Cliente vendedor que entra por la propiedad de Natalia → NO se enruta a
  Natalia por captador (intención vender manda), pero el aviso de interés no
  aplica porque el vendedor no "se interesa" en comprar — el aviso solo se
  dispara desde buscar_propiedades/property_ref_origen igual que hoy; se
  acepta el falso positivo del primer mensaje si entró por el ad (es un aviso
  informativo, no una transferencia).

## Testing

- `test/command-marcar-propiedad.test.js`: marca OK (cualquier rol); ref
  inexistente; asesor ambiguo pide precisar; asesor inexistente vuelve a
  preguntar; reasignación menciona al anterior; consultar_captador por ref y
  por asesor.
- `test/captador-alert.test.js`: interés dispara alerta una sola vez (dedup);
  sin captador no hay alerta; captador inactivo no recibe.
- `test/captador-transfer.test.js`: transferencia va al captador con propiedad
  marcada; intención vender ignora captador; sin captador usa especialidad;
  captador inactivo cae a especialidad.
- Suite completa `npm test` en verde.

## Fuera de alcance (YAGNI)

- Historial de asignaciones (tabla aparte) — la columna basta.
- Sincronizar el captador desde Wasi — asignación manual vía Sofi.
- UI del CRM para marcar propiedades — el canal es Sofi-Comando.
- Comisiones / reparto de negocio entre captador y vendedor.
