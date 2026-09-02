# Grupos: dashboard de matches en vivo + reorganización de la página

**Fecha:** 2026-09-02
**Estado:** diseño aprobado (Juan, 2026-09-02, con mockup visual)
**Pedido por:** Juan

## 1. Qué se quiere y por qué

La página `/grupos` del CRM mezclaba, sin orden claro, paneles sueltos para
demandas, ofertas, mandatos y matches. Juan pidió reorganizarla en tres
tablas claras (Grupos, entrada, salida) más un dashboard arriba — y, sobre
la marcha, agregó dos pedidos más: métricas de cuánto resuelve el bot solo
contra cuánto tiene que reenviar cada asesora a mano ("de esto depende la
viabilidad del sistema"), y que las tarjetas de pedidos traigan los links de
las propuestas directo, sin tener que hacer clic para verlos.

Terminología nueva de esta página:

- **Entrada** = pedidos que colegas publican en un grupo y calzan con
  nuestro inventario propio (carril venta, `group_signals` clase=`demanda`).
  Les respondemos a ellos.
- **Salida** = propiedades que colegas publican y calzan con un mandato de
  compra nuestro (carril compra, `mandato_match_alerts` /
  `ally_properties`). Se lo mostramos a nuestro cliente.

## 2. Diseño — Dashboard de matches (arriba de todo)

Reemplaza la fila de tarjetas de estadísticas actual. Cinco números (cuatro
para un asesor no-admin, sin "sin entregar"):

| Card | Fuente | Query |
|---|---|---|
| Mandatos activos | `mandatos_compra` | ya existe (`mandatosRes`) |
| Entrada con match | `group_signals` clase=demanda, matches≠`[]` | ya existe (`conMatch`) |
| Salida con match | `mandato_match_alerts` entregado=true | ya existe (`matchesEncontrados.length`) |
| **Bot resolvió solo (DM auto)** — NUEVO | `group_signals.respuesta_modo = 'auto'` | count, con el mismo filtro `mias` (por `advisor_id`, quien observó la señal) que el resto de la página |
| **Asesora reenvió a mano** — NUEVO | `group_signals` donde `politica_motivo = 'sin_telefono'` AND `aviso_advisor_id` no es null | count, mismo `mias` |
| Sin entregar (solo admin) | `mandato_match_alerts` entregado=false | ya existe (`matchesPendientes.length`) |

Debajo del grid, una línea de contexto (solo si hay datos suficientes):
`"{autoDm} de {autoDm + reenvioManual} pedidos con teléfono ubicable los
resolvió el bot solo, sin que nadie tuviera que escribirle a un colega."`

Con el badge "🔴/🟢 en vivo" arriba a la derecha (ver §6).

## 3. Diseño — Mensajes por asesora (solo admin)

Nueva sección, tabla simple, **solo visible para admin** (mismo criterio que
"Matches sin entregar": es información comparativa entre asesoras, no algo
que cada una necesite ver de sí misma en esta pantalla — su propio trabajo
ya lo ve en el resto de la página).

Columnas: **Asesora · Entrada · ↳ reenvió a mano · Salida**

- **Entrada**: `group_signals` agrupado por `aviso_advisor_id` (no confundir
  con `advisor_id`, que es quien *observó* la señal — este es quien
  *recibió* el aviso).
- **↳ reenvió a mano**: mismo agrupado, filtrado a `politica_motivo =
  'sin_telefono'`.
- **Salida**: `mandato_match_alerts` agrupado por `advisor_id`, filtrado
  `entregado = true`.

Filas: solo asesores con `activo = true` que aparezcan en al menos uno de
los tres conteos (evita ruido de asesores de prueba/inactivos que nunca
reciben nada). Nombres via `advisors.name`.

## 4. Diseño — Grupos como acordeón horizontal

Reemplaza la lista vertical actual de `GruposPanel` por un componente
plegable:

- Colapsado por defecto: una sola fila `"▸ Grupos — N cargados"`, clic para
  abrir/cerrar (estado local, sin persistir).
- Abierto: una fila de tarjetas chicas (nombre + origen: export/reenvío/en
  vivo) en un contenedor `overflow-x-auto` — se desliza horizontal, no
  crece hacia abajo. Mismo dato que `GruposPanel` ya recibe, solo cambia la
  presentación.

## 5. Diseño — Entrada: pedidos de colegas (con links visibles)

`SenalesGrupos` (usado para `clase="demanda"`) ya renderiza el link de cada
match (`m.link`) — pero detrás de un toggle "▸ N matches" que arranca
cerrado (`useState(false)` en la línea 223 de
`senales-grupos.tsx`). Cambio: cuando `clase === "demanda"` el bloque de
matches arranca **abierto por defecto** (mismo criterio que ya existe para
`soloMatch` — "una demanda sin match no es accionable, verla cerrada
tampoco"). No se toca el contenido de esa sección, solo el estado inicial.

## 6. Diseño — Salida: propiedades de colegas (con link cuando existe)

`MatchesEncontradosPanel` hoy solo muestra `mandato_match_alerts.texto`, que
**no** incluye un link a la publicación original — esa URL, cuando existe,
solo vive dentro de `ally_properties.mensaje_original` (el texto crudo que
pegó el colega, ej.: `"...Más información y fotos:
https://info.wasi.co/apartamento-venta-envigado/10353330?shared=whatsapp"`).

Cambio: la consulta de `matchesEncontrados` en `page.tsx` pasa a incluir
join a `ally_properties` (por `ally_property_id`) trayendo
`mensaje_original`. `MatchesEncontradosPanel` extrae la primera URL con una
regex simple (`/https?:\/\/\S+/`) y:

- si encuentra una, la muestra como `🔗 Ver publicación original` (link
  clickeable, `target="_blank"`);
- si no, muestra `"Sin link — contactá al colega"` (no se inventa nada).

## 7. Diseño — Actualización en vivo

Mismo patrón que ya usa `InboxList` (Supabase Realtime, sin librerías
nuevas): un componente cliente nuevo, `GruposLiveWatcher`, sin props,
montado una vez cerca del encabezado del dashboard:

```
useEffect(() => {
  const supabase = createClient();
  const channel = supabase.channel("grupos-live")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "group_signals" }, () => {
      setToast("🔔 Nuevo pedido de un colega"); router.refresh(); ...
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "mandato_match_alerts" }, () => {
      setToast("🔔 Nueva propiedad con match"); router.refresh(); ...
    })
    .subscribe();
  return () => supabase.removeChannel(channel);
}, [router]);
```

`router.refresh()` vuelve a correr el server component completo (la página
ya es `force-dynamic`), así que el dashboard, la tabla de mensajes por
asesora, y las dos tablas de entrada/salida se actualizan solas — no hace
falta lógica de "en vivo" separada en cada tabla. El badge del dashboard
(§2) muestra "en vivo" mientras el canal está `subscribed`, y algo como
"reconectando…" si se cae (mismo tipo de estado que ya maneja `InboxList`
internamente, aunque hoy no lo expone visualmente — acá sí, en el badge).

## 8. Qué NO cambia

- Las secciones "Mis mandatos de compra" y "Matches sin entregar" (admin)
  siguen donde están, después de las tres tablas — no son parte de las
  "tres tablas" pedidas, son contexto de apoyo.
- El filtro `mias` (un asesor ve solo lo suyo) se respeta en cada query
  nueva exactamente igual que en las existentes.
- No se cambia nada del lado del bot (`src/`) — todo esto es capa de
  presentación del CRM sobre datos que ya se generan hoy.

## 9. Testing

Este es un cambio de CRM (Next.js/React), sin suite de tests automatizados
existente para estos componentes (el proyecto no tiene Jest/Testing Library
configurado para `crm/`). Verificación:

- `npx tsc --noEmit` y `npm run build` limpios (mismo criterio ya usado en
  los cambios anteriores de esta sesión).
- Verificación manual en navegador contra la base real (login de un admin)
  antes de dar el cambio por terminado — pendiente porque esta sesión no
  tiene credenciales del CRM; Juan debe confirmar visualmente tras el
  deploy.

## 10. Fuera de alcance de este documento

- Persistir el estado abierto/cerrado del acordeón de Grupos entre sesiones
  (hoy es puramente local, se resetea al recargar).
- Filtros o búsqueda dentro de "Mensajes por asesora".
- Cualquier cambio a qué se guarda o no se guarda (ya definido: solo lo que
  hace match con un mandato se guarda en `ally_properties`).
