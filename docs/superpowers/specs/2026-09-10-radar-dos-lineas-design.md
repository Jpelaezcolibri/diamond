# El radar con dos líneas: la de la asesora principal primero, la otra de respaldo

**Decisión de Juan, 2026-09-10.** Diseño aprobado en conversación.

> **2026-09-11: NO SE IMPLEMENTA (decisión de Juan).** *"no vamos a
> implementar el programa para que aguante dos lineas, dejemos como esta con
> una sola y la otra con posibilidad de conectar"*.
>
> - Queda una sola línea activa: DaianaDiamond.
> - RADA-NATALIA (el 573001878024) no se borra: queda `pendiente`, con la
>   posibilidad de conectarla.
>
> **Ojo:** si alguien escanea el QR y hay dos líneas activas, siguen vigentes
> las fallas silenciosas del §1. La peor es la de `ventana-asesora`: deja de
> mantener abierta la ventana de Daiana y los avisos dejan de llegarle al día
> siguiente. Conectar la segunda línea exige retomar esta spec antes.

Juan: *"no quiero que canceles del todo la línea de Natalia, se pueden dejar
las dos sin problema; el mensaje de salida tratar de que se haga desde el
número de Daiana; si en ese grupo solo está el número de Natalia, lo enviamos
desde ese sin problema. Tienen que aprender a convivir los dos."*

## 1. Contexto verificado (2026-09-10)

- Líneas WAHA: `DaianaDiamond` (301 188 0668, vinculada ese día, activa) y
  `RADA-NATALIA` (300 187 8024, desvinculada ese día con `revincular` —
  queda esperando QR). Asesora principal del radar = Daiana Zea
  (`RADAR_REVISOR_PHONE`).
- Tres grupos de mucho volumen no registran señales desde el cambio de línea
  ("PEDIDOS - BUSCANDO", "Pedidos Poblado/Envigado", "PEDIDOS -Buscando
  PEDIDOS"): lo más probable es que el número de Daiana no esté en ellos.
- WhatsApp entrega un DM a un `<lid>@lid` solo si la línea que escribe
  comparte un grupo con el destinatario (probado 2026-09-04). Por eso la línea
  de salida tiene que ser una que esté en el grupo del pedido.
- **Lugares que hoy asumen UNA sola línea activa** (con dos, fallan en
  silencio):
  - `src/groups/vivo.js#aprobarManual` → `sesion_ambigua` si `activas.length !== 1`.
  - `src/api/crm.js` `POST /api/grupos/senal/responder-dm` → 409 si no hay
    exactamente una.
  - `src/scheduler/ventana-asesora.js#sesionActiva` → `sin_sesion`.
  - `src/channels/whatsapp-group.js` `GET /webhook/grupos/estado` → sin cuota.
  - Toman "la primera activa" sin criterio: `src/api/crm.js` (probar-dm,
    ~531, ~614, citas cancelar/reprogramar ~817/~839),
    `src/scheduler/avisos-salida.js:~205`, `src/scheduler/radar-directorio.js:~64`.
- El DM automático (`asistir`) usa la línea que recibió el mensaje
  (`ev.sesion`); con dos líneas en el mismo grupo, el mensaje se procesa una
  sola vez (`yaVisto`) y sale por la línea que llegó primero — al azar.

## 2. El diseño

1. **Qué línea está en qué grupo.** Tabla nueva `grupo_lineas`
   (`org_id, group_id, sesion, ultimo_visto`, PK `(org_id, group_id,
   sesion)`). Cada mensaje de grupo que llega por el webhook hace upsert de
   `(grupo, sesión)` **antes** del descarte por repetido (`yaVisto`), para que
   las dos líneas queden registradas aunque el mensaje se procese una vez.
2. **Línea preferida, desde el dato:** la sesión activa cuyo `advisor_id` es
   la asesora principal del radar (`advisors.findAsesorPrincipalRadar`). Nada
   hardcodeado.
3. **Resolver de la línea de salida** (una sola función, p. ej.
   `whatsappGroups.lineaDeSalida(orgId, groupId, { sesionQueRecibio })`):
   la preferida si está activa y registrada en ese grupo; si no, la que
   recibió el mensaje; si no, cualquier sesión activa registrada en el grupo;
   si no hay ninguna, `null` (el pedido cae al aviso de la asesora, falla
   cerrado).
4. **La usan todos los envíos al colega:** DM automático (`asistir`),
   `aprobarManual`, `responderPorDmManual` (el endpoint del CRM deja de exigir
   una sola sesión), `prepararAviso`, y el respaldo por WAHA de
   `cancelar-cita.js`.
5. **Se quita la exigencia de "una sola línea":**
   - `ventana-asesora`: la ventana de 24 h se abre desde la sesión activa cuyo
     número es el de la asesora (`lineaEsDeLaAsesora` sobre cada activa).
   - `/webhook/grupos/estado`: cuota de WhatsApp por línea.
   - `avisos-salida`, `radar-directorio`, probar-dm: la línea preferida.
6. **Qué línea mandó cada DM:** columna nueva `group_signals.respuesta_sesion`
   (la escribe `marcarRespondida`). La usan el recordatorio de 2 h (sale por
   la misma línea) y la trazabilidad; `linea_dm` ya guarda `sesion` para las
   respuestas.
7. **Los avisos siguen yendo solo a la asesora principal** (Daiana). Los topes
   de volumen (150/día) siguen siendo de la org; la cuota de WhatsApp se lee
   de la línea que envía.

## 3. Migración (la corre Juan antes del deploy)

```sql
create table if not exists grupo_lineas (
  org_id uuid not null references organizations(id) on delete cascade,
  group_id uuid not null references whatsapp_groups(id) on delete cascade,
  sesion text not null,
  ultimo_visto timestamptz not null default now(),
  primary key (org_id, group_id, sesion)
);
alter table group_signals add column if not exists respuesta_sesion text;
```

## 4. Orden operativo

1. Juan despliega `colega-solo-llamada` (pendiente de su push).
2. Se implementa y despliega este cambio (migración antes).
3. Recién entonces Natalia escanea el QR de `RADA-NATALIA` desde el CRM.
4. Después: confirmación de visitas y DM separados (specs ya aprobadas).

## 5. Pruebas

Resolver con: preferida en el grupo → preferida; preferida fuera del grupo →
la que recibió; ninguna registrada → `null`; preferida inactiva → la otra.
Webhook: dos sesiones con el mismo mensaje → dos filas en `grupo_lineas`, un
solo procesamiento. `aprobarManual` / `responderPorDmManual` con dos sesiones
activas → no más `sesion_ambigua`/409; salen por la línea resuelta.
`ventana-asesora` con dos activas → usa la de la asesora. `marcarRespondida`
guarda `respuesta_sesion`.
