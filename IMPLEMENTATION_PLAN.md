# IMPLEMENTATION_PLAN.md

Plan de implementación de SOFI — Centro de Comando Conversacional, ejecutado por
**experiencias completas** (ver [diamond-os/sofi-experiencias-demo.md](diamond-os/sofi-experiencias-demo.md)),
no por historias sueltas. Este archivo se actualiza al cerrar cada sprint.

---

# Sprint 1

## Experiencia: **El Día Resuelto**

Historias del backlog: **EXP-001** (briefing de inicio de jornada) + **EXP-006**
(cierre + siembra del día siguiente) + **EXP-013** (siguiente mejor acción).
Referencia: [diamond-os/sofi-experience-backlog.md](diamond-os/sofi-experience-backlog.md).

### Nota de realismo (leer antes de estimar)
Es el **primer slice**: además de la experiencia, este sprint **levanta el
esqueleto de Sofi-Comando** que todos los sprints siguientes reutilizarán (router
interno, motor tool-use desacoplado, resolutor de alcance, sesiones de comando,
superficie de chat en el CRM y las dos primeras funciones de consulta en base).
Por eso pesa más que un sprint de feature. Decisión que lo desriesga: **el
briefing y el cierre se arman de forma determinista** (ensamblan la salida de las
funciones SQL, sin pasar por el modelo); el LLM solo se usa para la conversación
de seguimiento y la "siguiente mejor acción" (EXP-013). Así el valor central de
la demo no depende de la fiabilidad del loop de IA.

### Canal en alcance
Solo el **chat en el CRM** (identidad fuerte = sesión Supabase). El canal
WhatsApp para asesores queda **fuera** de este sprint.

---

## Archivos afectados

### Bot (`src/`, Express 5, `node --test`)

| Path | Acción | Propósito |
|---|---|---|
| `src/api/assistant.js` | **crear** | Router Express nuevo. `POST /api/assistant/session` (abre sesión → devuelve briefing), `POST /api/assistant/message` (turno de chat), `POST /api/assistant/close` (cierre + siembra). Guard `x-api-key === config.botApiKey` replicando el middleware de `src/api/crm.js:13`. |
| `src/server.js` | **editar** | Montar el router: `app.use(require("./api/assistant"))` tras la línea 15 (junto a whatsapp/telegram/crm). Único cambio en este archivo. |
| `src/agent/sofi-comando.js` | **crear** | Motor interno. Reutiliza el patrón `client.messages.create` + loop tool-use de `src/agent/engine.js` (mismas constantes `MAX_TOOL_ITERATIONS`, `HISTORY_LIMIT`), **desacoplado de `procesarMensaje`** (que está atado al flujo de lead). Recibe el `scope` inmutable y lo inyecta en cada tool. |
| `src/agent/sofi-comando-prompts.js` | **crear** | `buildCommandSystemPrompt({ scope, now })`. Persona Sofi-Comando (copiloto interno, no las 40 reglas de cara al cliente). Bloque estable con `cache_control: ephemeral` (mismo patrón de `prompts.js`) + bloque volátil (fecha Colombia, nombre del asesor). |
| `src/agent/sofi-comando-tools.js` | **crear** | `COMMAND_TOOL_DEFINITIONS` + `executeCommandTool(name, input, scope)`. Tools de este sprint: `consultar_seguimientos`, `metricas_leads`, `sugerir_siguiente_accion` (lee el contexto activo de la sesión). Cada tool llama a `src/data/command.js`; **ninguna recibe el alcance del modelo** (viene del `scope`). |
| `src/data/command.js` | **crear** | Capa de datos del comando. (a) Wrappers de RPC: `metricasLeads(scope, desde, hasta)`, `seguimientos(scope, dias)` → `supabase.rpc("cmd_...")`. (b) Sesiones: `openSession(scope)`, `appendCommandMessage(sessionId, role, content)`, `getRecentCommandMessages(sessionId, limit)`, `setActiveContext(sessionId, foco)`, `saveTomorrowQueue(sessionId, queue)`. |
| `src/agent/scope.js` | **crear** | `resolveScope({ org_id, viewer_uid, role })` — normaliza y congela el alcance; resuelve `org_id` desde la fila `advisors` del `viewer_uid` (por `auth_user_id`), fallback a la org por defecto (coherente con el CRM actual). Punto único donde vive la regla admin/asesor. |
| `src/config.js` | **sin cambio** | Reutiliza `config.botApiKey`, `config.anthropicApiKey`, `config.claudeModel`. |

### CRM (`crm/`, Next.js 15, sin runner de tests)

| Path | Acción | Propósito |
|---|---|---|
| `crm/app/(dashboard)/sofi/page.tsx` | **crear** | Server component contenedor (espeja `inbox/[id]/page.tsx`). Valida sesión con `createClient()` server, obtiene `user` + `admin`/`role`, pide al bot la sesión del día (briefing + historial) y renderiza el chat. Hereda header/nav/gating del layout. |
| `crm/components/sofi-command-chat.tsx` | **crear** | Client component que espeja `crm/components/chat-view.tsx` (estado `messages`, composer → POST). **Sin** toggle bot/humano ni media. **Sin Realtime** (respuesta síncrona en el POST). Renderiza el briefing como primer mensaje `assistant`. |
| `crm/app/api/assistant/route.ts` | **crear** | Route handler. Valida sesión (`createClient()`), extrae `viewer_uid = user.id`, `role = userRole(user)`, y hace `fetch` a `${BOT_API_URL}/api/assistant/...` con `x-api-key` (patrón idéntico a `crm/app/api/send/route.ts:24`). Acciones: `session` (abrir/briefing), `message`, `close`. |
| `crm/lib/bot.ts` | **crear** | Helper `callBot(path, body)` que centraliza `fetch(${BOT_API_URL}${path}, { headers: { "x-api-key": BOT_API_KEY } })`. Hoy ese fetch está inline y duplicado en send/modo/media; SOFI lo usa y queda disponible para refactor futuro (no se refactoriza send/modo/media en este sprint). |
| `crm/app/(dashboard)/layout.tsx` | **editar** | Añadir `<NavLink href="/sofi">SOFI</NavLink>` en el `<nav>` (líneas 30-37). **Sin gating admin**: la usan asesor y admin. |

---

## Componentes (bloques lógicos del slice)

1. **Resolutor de Alcance** (`src/agent/scope.js`) — convierte `(org_id, uid,
   role)` de la sesión del CRM en un `scope` inmutable. Es la barrera de
   permisos: el asesor solo ve lo suyo (`owner_id = uid`), el admin ve la org.
2. **Motor Sofi-Comando** (`src/agent/sofi-comando.js` + prompts + tools) — loop
   tool-use paralelo al de cliente, con persona y tools propias.
3. **Capa de Consulta en Base** (migraciones `cmd_*` + `src/data/command.js`) —
   "la base calcula, la IA conversa": las métricas se agregan en Postgres y
   devuelven JSON compacto; el motor nunca recibe filas crudas.
4. **Ensamblador determinista** (dentro de `src/api/assistant.js`) — arma el
   briefing (EXP-001) y el cierre (EXP-006) llamando directo a las funciones de
   consulta, **sin LLM**. El texto se plantilla; los números vienen de la base.
5. **Store de Sesión de Comando** (tablas + `src/data/command.js`) — persiste la
   conversación, el **contexto activo** (foco de propiedad/lead para EXP-013) y
   la **cola de mañana** (siembra de EXP-006 que alimenta el briefing siguiente).
6. **Superficie de Chat** (`sofi/page.tsx` + `sofi-command-chat.tsx`) — la única
   UI nueva; espeja el chat existente para consistencia visual.

---

## Tests

**Bot (`test/`, `node --test`) — donde vive la lógica testeable:**
- `test/scope.test.js` — el asesor recibe `owner_id = uid`; el admin no filtra por
  owner; la resolución de `org_id` por `advisors.auth_user_id` con fallback.
- `test/command-briefing.test.js` — el ensamblador determinista produce el parte
  correcto a partir de salidas mock de `cmd_seguimientos`/`cmd_metricas_leads`
  (orden por urgencia: cita → caliente frío → nuevos).
- `test/command-close.test.js` — el cierre resume lo del día y persiste la cola de
  mañana; esa cola reaparece al abrir la siguiente sesión.
- `test/command-tools.test.js` — `executeCommandTool` inyecta el `scope` y nunca
  acepta alcance desde el `input` del modelo.

**Verificación de las funciones SQL** (no hay runner de SQL en el repo): script
manual de smoke sobre Supabase que llama a `cmd_metricas_leads` y `cmd_seguimientos`
con un uid de asesor y con un admin, verificando que el filtro de alcance se
aplica dentro de la función. Se documenta en el PR.

**CRM (sin runner):** verificación por `next build` + `next lint`, y prueba manual
en preview (abrir `/sofi`, ver briefing, conversar, cerrar → reabrir y comprobar
la siembra). No se introduce framework de tests en este sprint.

---

## Migraciones

Se aplican **manualmente en Supabase** (convención del repo — las migraciones no
corren solas). Ambas nuevas, bajo `db/migrations/`:

| Archivo | Contenido |
|---|---|
| `db/migrations/2026-07-10_command_sessions.sql` | Tablas `command_sessions` (`id, org_id, user_id → auth.users, active_context jsonb, tomorrow_queue jsonb, opened_at, closed_at`) y `command_messages` (`id, session_id, role, content, created_at`). RLS: escrituras por `service_role` (el bot); lectura del propio usuario (`user_id = auth.uid()`) por si el CRM lee historial vía sesión. |
| `db/migrations/2026-07-10_cmd_functions.sql` | Funciones `cmd_metricas_leads(p_org, p_uid, p_role, p_desde, p_hasta)` y `cmd_seguimientos(p_org, p_uid, p_role, p_dias)`. `SECURITY DEFINER`; aplican el filtro de alcance **dentro** (si `p_role <> 'admin'` → `owner_id = p_uid`); devuelven JSON agregado; fechas resueltas con `America/Bogota`. |

**No** se toca `leads.estado` ni se agregan estados de cierre en este sprint (eso
llega con la experiencia de conversión). Por eso el cierre (EXP-006) resume
seguimientos/citas/leads movidos, **no** ventas cerradas — ver "Fuera de alcance".

---

## Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| **Sprint fundacional pesado** — levanta motor + sesiones + alcance + chat, no solo la feature. | Se subestima el tiempo. | Briefing/cierre deterministas (sin LLM) entregan el valor central temprano; el LLM es aditivo. Estimación honesta abajo. |
| **Confianza de identidad CRM→bot** — el `uid`/`role` viajan en el body del server-to-server. | Un actor que hablara directo al bot podría falsear alcance. | El bot solo se llama desde el route handler (nunca desde el browser); `x-api-key` obligatorio; el `org_id` se re-resuelve en el bot desde `advisors`, no se confía ciegamente. |
| **Zona horaria en `cmd_*`** — "hoy" mal calculado parte el briefing. | Números equivocados en la demo. | Calcular límites de fecha en SQL con `America/Bogota`; cubierto por `command-briefing.test.js` con fechas fijas. |
| **Costo/latencia del loop LLM.** | Chat lento o caro. | Briefing sin LLM; system prompt con cache efímero; `max_tokens` acotado; modelo de `config.claudeModel`. |
| **Sin runner de tests en el CRM.** | Regresiones de UI silenciosas. | Toda la lógica vive en el bot (testeable con `node --test`); el CRM queda como capa fina (fetch + render); verificación por `build`/`lint`/preview. |
| **Migraciones manuales** — olvidar correrlas en Supabase. | La feature falla en runtime. | Checklist en el PR; el wrapper de RPC falla ruidoso si la función no existe. |
| **Multi-tenant** — el CRM asume una sola org hoy (`getDefaultOrgId`). | Datos cruzados si algún día hay varias orgs. | `scope.js` resuelve `org_id` explícito por `advisors.auth_user_id`; fallback documentado a la org por defecto. |

---

## Tiempo

Estimación para **1 dev + Claude Code**, incluyendo el costo de esqueleto que
solo se paga una vez:

| Workstream | Estimado |
|---|---|
| Migraciones (`command_sessions` + `cmd_*` con zona horaria) | 1 día |
| `scope.js` + `src/data/command.js` (RPC wrappers + sesión) | 1 día |
| Motor `sofi-comando.js` + prompts + tools | 2 días |
| Router `src/api/assistant.js` + ensamblador determinista (briefing/cierre) | 1.5 días |
| CRM: `sofi/page.tsx` + `sofi-command-chat.tsx` + `api/assistant/route.ts` + `lib/bot.ts` + nav | 2 días |
| Tests del bot + smoke SQL + verificación en preview | 1.5 días |
| **Total** | **~9 días hábiles (≈ 2 semanas)** |

Los sprints siguientes de experiencia **no vuelven a pagar** el esqueleto (motor,
sesiones, alcance, chat): reutilizan todo esto y solo suman tools + funciones
`cmd_*`, por lo que caen a ~1 semana cada uno.

---

## Fuera de alcance de Sprint 1 (para evitar scope creep)
- Canal **WhatsApp para asesores** (identidad por `advisors.phone`) — sprint posterior.
- **Métrica de ventas** y estados `cerrado_ganado`/`cerrado_perdido` — llegan con
  la experiencia *Cero Leads Perdidos*; hasta entonces el cierre no cuenta ventas.
- **Realtime** en el chat de SOFI — no necesario (respuesta síncrona); nicety diferida.
- **Panorama del administrador** (EXP-007/008), tools de acción hacia el cliente
  (compartir ficha, generar mensaje, registrar cierre) y conocimiento compartido
  — otras experiencias, otros sprints.
- Refactor de `send/modo/media` para usar `crm/lib/bot.ts` — oportunista, no aquí.

## Criterios de aceptación de la experiencia (demo <5 min)
- Al abrir `/sofi`, aparece el **parte del día** sin escribir nada, ordenado por
  urgencia y compuesto solo con datos dentro del alcance del usuario.
- El asesor conversa el seguimiento ("arranquemos por ese") y SOFI sugiere el
  **siguiente paso** usando el contexto activo (EXP-013).
- Al cerrar, SOFI resume el día y **siembra la cola de mañana**; al reabrir, el
  briefing del día siguiente arranca de esa cola (EXP-006 → EXP-001).
- Cero navegación por menús para cualquiera de los tres momentos.
- Un asesor no ve datos de otro; el admin ve el negocio (verificado con dos
  usuarios de rol distinto).
