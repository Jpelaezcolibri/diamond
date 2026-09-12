# Panel de amoblados en el CRM (`/amoblados`)

**Decisión de Juan, 2026-09-12.** Maqueta aprobada:
`docs/superpowers/mockups/2026-09-12-panel-amoblados.html` ("Aprobado,
constrúyelo y despliégalo").

## 1. Por qué

Juan va a publicar los amoblados y quiere controlar lo que entra. Pidió que
el panel funcione como el de venta: *"que no procese todo sino solo lo que
tiene match, y se muestre con el mensaje enviado al DM del colega, con la
información de qué pedido se está respondiendo, y lo mismo si la respuesta va
a Daiana"*. Va en una página aparte *"para que no se sature"* `/grupos`.

Estado verificado en producción el 12-sep:
- 92 pedidos de arriendo en 7 días; 2 con match.
- Uno de esos dos terminó en aviso a Daiana. El otro lo descartó Sofi porque
  el colega pedía un edificio específico.
- El carril de amoblados está apagado (`RADAR_AMOBLADO_ACTIVO=false`), así
  que hoy todo sale como aviso a Daiana.

## 2. Qué muestra

1. **Una entrada nueva en el menú:** "Amoblados", a continuación de "Grupos".
2. **Cabecera:** el título y el estado del carril (encendido o apagado,
   según `RADAR_AMOBLADO_ACTIVO`, que se consulta al bot).
3. **Franja oscura de KPIs (últimos 7 días):** pedidos de arriendo · con
   match · aviso a Daiana · DM al colega · descartó Sofi. Si hay alguno
   **Sin dueño**, se muestra en rojo.
4. **Pedidos con match:** la misma tarjeta de `/grupos` (`Ficha` de
   `senales-grupos.tsx`), filtrada a `operacion = arriendo` y con match.
   Trae el mismo seguimiento y el mismo DM manual; este último respeta el
   interruptor del carril. A la tarjeta se le agregan dos bloques
   opcionales:
   - **Lo que salió · aviso a Daiana:** el texto del aviso, leído de
     `messages.content` por `group_signals.aviso_wamid`.
   - **Descartó Sofi:** `revalidacion.por_que`, cuando
     `revalidacion.sirve_alguna === false`.
   - El DM al colega ya se ve con `respuesta_texto`.
5. **Inventario amoblado:** las propiedades con `operacion = Arriendo`. Cada
   una muestra:
   - cuántos pedidos con match la trajeron;
   - una alerta si el motor no la ve amoblada (título y características sin
     "amoblado", la misma regla de `src/groups/amoblado.js`);
   - una alerta si la descripción no dice el periodo del precio (mes o
     noche).

## 3. Cómo se clasifica cada pedido

Función pura `salidaDelPedido(s)` en `crm/lib/amoblados.ts`:

| Salida | Condición |
|---|---|
| `dm` | `respondida_at` y `respuesta_modo = 'auto'` |
| `aviso` | `aviso_advisor_id` o `aviso_wamid` |
| `descartado` | `revalidacion.sirve_alguna === false` |
| `sin_dueno` | ninguna de las anteriores |

Un pedido puede tener DM **y** aviso (el aviso posterior al DM). Para el KPI
cuenta como DM, y la tarjeta muestra los dos.

## 4. Cambios en `/grupos`

Los pedidos de arriendo **dejan de aparecer** en `/grupos`: se filtran la
lista de pedidos y el conteo "Pedidos con match". Las ofertas y el resto de
los KPIs no cambian.

## 5. Reglas que se respetan

- **Aislamiento por asesora:** toda consulta a `group_signals` de la página
  nueva pasa por `mias()`. La prueba de aislamiento se extiende a
  `/amoblados`.
- **Un cero no se inventa:** cada consulta pasa por `fetchSafe` y
  `countSafe`, y si falla se muestra `ErrorBanner` o "—", nunca un cero.
- **Multi-tenant:** nada hardcodeado de Diamond. La asesora sale del aviso,
  no del código.
- **Sin migraciones:** `amoblado`, `periodo`, `aviso_wamid` y `revalidacion`
  ya existen.

## 6. Qué queda fuera

- **Detectar una zona equivocada en Wasi**, como el caso de "Robledo" contra
  Loma del Esmeraldal. No hay una regla general para eso; queda en el Excel
  de cambios para Wasi.
- **Leads de clientes finales que preguntan por amoblados.** Hoy no hay
  ninguno. Cuando llegue la pauta, será otra iteración.

## 7. Pruebas

- **Lógica pura:** `test/crm-amoblados.test.js`, que importa
  `crm/lib/amoblados.ts` con Node 24. Cubre `salidaDelPedido`, `esAmoblada`
  (el espejo de la regla del bot), `periodoDePropiedad` y `pedidosPorRef`.
- **Aislamiento:** `test/crm-grupos-aislamiento.test.js` también revisa
  `crm/app/(dashboard)/amoblados/page.tsx`.
- **Cierre:** `tsc --noEmit` y `next build` del CRM, la suite completa del
  bot y una revisión en producción después del despliegue.
