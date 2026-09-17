# CLAUDE.md — Diamond (bot inmobiliario + CRM)

Punto de entrada único de este repo para Claude Code. Este archivo se mantiene
liviano a propósito: da orientación general y dice qué documento leer según
la tarea. No dupliques aquí contenido que ya vive en esos documentos —
actualízalo ahí y, si cambia el enrutamiento, actualiza el mapa de abajo.

## 1. Qué es este proyecto

**Diamond**: ecosistema de captación y conversión inmobiliaria para Diamond
Inmobiliaria (Medellín), multi-tenant desde el modelo de datos.
Repo: https://github.com/Jpelaezcolibri/diamond

Cuatro piezas, una sola Supabase como fuente de verdad:

- **Bot** (raíz, `src/`): agente de WhatsApp "Sofi" (Node.js + Express +
  Claude SDK). Atiende clicks en ads, arma fichas, califica leads, transfiere
  al asesor humano.
- **CRM** (`crm/`): Next.js — inbox en vivo de las conversaciones de Sofi,
  gestión de leads, módulo Marketing (consume DMAP).
- **DMAP** (`dmap/`): "Diamond Growth Engine" — microservicio Node/TS/Fastify
  que sincroniza el inventario de Wasi, genera copy y creativos con IA
  (Diamond Cognitive Engine) y publica en Facebook/Instagram.
- **Web** (`web/`): landing pública "REF" (Next.js), multi-tenant por config,
  catálogo + ficha de propiedad + captación de leads.

Equipo: 1 dev (Juan) + Claude Code. Idioma de la app: español (Colombia).
Código: inglés. Commits: español, prefijos convencionales (`feat:`, `fix:`,
`docs:`, `config:`).

## 2. Estado actual (2026-09-17)

- **A la asesora solo le llegan visitas (2026-09-17).**
  - **La regla de Juan:** nada de seguimientos ni alertas. El radar solo le
    responde por DM al colega, y a la asesora se le escribe solo para una cita
    o su recordatorio.
  - **Interruptor:** `ASESORA_SOLO_VISITAS=true` (`src/lib/solo-visitas.js`).
    Apaga el aviso de pedido, el post-DM, el candidato cercano, el pedido
    directo de un colega, la bandeja, el escalado por silencio, el
    recordatorio, el cierre del día, el digest, los mandatos y
    las alertas técnicas a `RADAR_WATCHDOG_TO` (hoy son los dos números de
    Daiana).
  - **Sigue saliendo:** citas (aviso, recordatorio, cancelación), clientes
    directos (transferencia, captador, aliado), el colega que pide hablar con
    una persona o solo llamada (decisión de Juan), el cruce visitas→ventas
    (Juan lo quiso dejar) y lo manual.
  - **Lo que no sale queda en `/grupos`** con su motivo. Un pedido que no
    califica para DM ya no lo atiende nadie por WhatsApp.
  - **Pendiente:** con esto el vigilante calla. Si se quiere de vuelta,
    `RADAR_WATCHDOG_TO` tiene que apuntar a un número que no sea de una
    asesora.

- **Costo de la API: el clasificador cacheado (2026-09-14).**
  - **Hallazgo:** el clasificador de grupos (`src/groups/classify.js`, Haiku)
    era ~85 % del gasto. Clasifica 820 a 1.300 mensajes por día porque el
    prefiltro léxico descarta el 0,6 % en grupos gremiales, no el 85 %.
  - **Cambio:** su prompt pasó el mínimo cacheable de Haiku (4.096 tokens)
    con 12 ejemplos reales y dos reglas nuevas (precio sin unidad según la
    operación; barrio y municipio van los dos). Costo por mensaje de
    $0,0041 a $0,0015.
  - **Validado** con la clave de producción sobre 60 mensajes congelados:
    60/60 en clase contra las etiquetas guardadas (el prompt viejo, 59/60).
  - **Verificar:** en Railway, `[uso] classify ... cache_read=4xxx`; y
    `railway run --service diamond node scripts/smoke-cache.js classify`.
  - **`buscar_propiedades` liviano, aplicado:** JSON compacto y sin columnas
    internas, −19 % de tokens por búsqueda (4.799 → 3.887 en 5 propiedades).
  - **Compuerta de intención de demanda, descartada:** deja pasar el 93 % de
    las ofertas reales, así que no recortaría casi nada.
  - **Pendiente de leer (24–48 h):** la mezcla del clasificador en
    `/webhook/grupos/estado` (`clasificados_ruido/oferta/demanda`). Si el
    ruido es ≥ 40 %, planear una salida corta para el ruido. Detalle en
    `docs/costo-api-claude.md`.

- **Mensajes repetidos a la asesora, cerrados (2026-09-14).**
  - **La queja:** "llegan muchos mensajes para el mismo colega". Se midieron
    13 casos del 07 al 14-sep y salieron cinco causas.
  - **Bandeja:** `avisos-salida.js` solo toma señales con más de
    `AVISOS_GRACIA_MIN` (3). Antes pisaba a `asistir` mientras avisaba o
    mientras el DM iba en camino.
  - **Envíos simultáneos:** `enviarYRegistrar` junta dos envíos idénticos
    simultáneos en uno.
  - **Post-DM:** cuenta para el freno de ritmo. Si el freno está cerrado,
    espera en `src/groups/cola-post-dm.js`, una cola en memoria, y sale en el
    digest.
  - **`ya_se_le_mando`:** ya no avisa. Esto revierte la regla de la spec de DM
    separados §3.3.
  - **"Pedido directo de un colega":** uno por colega cada 15 min.
  - **Regla:** todo camino nuevo que le escriba a la asesora pasa por
    `ritmo.puedeEnviar` y `ritmo.registrarEnvio`.
- **Barrios de Envigado (2026-09-14).**
  - **Qué entró:** 27 barrios en `SUBZONA_DE` (`src/lib/zonas.js`) y un grado
    nuevo, `zona_general`. Con él, un pedido de "Barrio Mesa" encuentra una
    propiedad registrada solo como "Envigado". La ficha dice "el barrio exacto
    no lo tengo registrado".
  - **Golden set:** corrido con la frase nueva del prompt, 6/6.
  - **Caso:** Juanita Monsalve contra la 10077063.

- **DM al colega partido (2026-09-13, merge de la rama `dm-separados`).**
  - **Qué cambió:** el DM sale como un mensaje para el colega (saludo,
    salvedad, comisión, firma) y después una ficha por propiedad, hasta 3,
    cada una con su link de Wasi, para que la reenvíe tal cual. Hay 4 s entre
    mensajes. Spec: `docs/superpowers/specs/2026-09-10-dm-separados-y-recordatorio-design.md`.
  - **El caso:** un colega respondió "Enviame de a una propiedad Link Que se
    pueda pasar al posible cliente" y preguntó la administración.
  - **No reenviar:** ninguna ref se le repite a un colega que la recibió en
    los últimos 7 días. Si no queda nada, el pedido va a la asesora con el
    motivo `ya_se_le_mando`.
  - **Envío único:** `src/groups/envio-colega.js` sirve a los tres caminos.
    Si WhatsApp corta a la mitad, se registra solo lo que salió
    (`dm_parcial`) y la asesora recibe lo que faltó.
  - **Administración:** DMAP guarda `maintenance_fee` de Wasi en
    `properties.administracion` (41 de 124 propiedades la tienen) y la ficha
    la muestra.
  - **Riesgo a vigilar:** un DM pasa de 1 mensaje a entre 2 y 4. La cuota de
    WhatsApp no cuenta los DM por lid (el 98 %), así que el cortacircuitos no
    ve casi nada de este volumen. Hay que mirar la línea la primera semana.
  - **Borrador para humanos también partido (2026-09-14):** la página del
    aviso (`/aviso/<token>`, `crm/components/aviso-celular.tsx`) muestra la
    presentación y cada ficha en su propio recuadro con botón Copiar; el botón
    verde manda o copia la presentación. `vivo.prepararAviso` devuelve
    `mensajes` además de `mensaje`. El aviso por WhatsApp le sugiere a la
    asesora mandarlas desde el link.
  - **Pendiente:** el recordatorio único a las 2 h (§3.4 de la spec) no está
    hecho. Necesita migración.
  - **Auditoría del motor de match:** sus pendientes quedaron cerrados en el
    mismo merge (lista única de exigencias, freno de edificio en el DM). Ver
    el cierre en `auditoria-motor-match-2026-09-05.md`.

- **El radar escucha muchos menos pedidos desde el 11-sep (medido
  2026-09-14).** Del 7 al 10-sep entraban 120 a 139 pedidos por día; el 11
  entraron 55, el 12 27 y el 13 solo 13. Coincide con el cambio de línea a
  Daiana (10-sep). La base tiene 141 grupos: 53 en escucha y 88 en
  "ignorar". No es el motor: los 7 pedidos que entraron después del
  despliegue del 13-sep dan el mismo resultado con el motor anterior. Falta
  revisar en cuántos de los 53 grupos está de verdad la línea nueva.
- **Hueco del motor (visto 2026-09-14):** un pedido que nombra barrios de
  Envigado ("Barrio Mesa", "El Trianón") no trae las propiedades cuya zona
  dice solo "Envigado": el motor no sabe que esos barrios están dentro del
  municipio. Caso Juanita Monsalve; la 10077063 dice "Barrio Mesa" en el
  título. Mismo patrón que `zona-huerfana-mata-el-match` en la memoria.

- **Amoblados, antes de publicarlos (2026-09-12).**
  - **Carril encendido:** `RADAR_AMOBLADO_ACTIVO=true`, decisión de Juan.
    Antes estaba en `false` y ningún pedido de arriendo salía solo.
  - **Arreglo de guardado:** `persistir.js` ahora guarda `amoblado` y
    `periodo`. Nunca lo hacía: 92 de 92 pedidos de arriendo quedaron en null.
    El cruce en vivo no se afectaba porque usa el pedido en memoria.
  - **Verificado contra producción:**
    - Los 8 arriendos de la web pública de Wasi son los 8 que hay en
      `properties`.
    - `findForTransfer` para arriendo, venta y vehículos devuelve a Daiana.
  - **Pendiente en Wasi (lo hace Juan):**
    - Marcar la característica Amoblado donde falta.
    - Aclarar si cada precio es por mes o por noche. La finca 10389800
      sobre todo.
    - Corregir la zona de la 10390204: dice Robledo, pero la descripción
      dice Loma del Esmeraldal, que queda en Envigado.
  - **Panel `/amoblados` en el CRM (2026-09-12).** Muestra solo los pedidos
    de arriendo con match y lo que salió para cada uno: aviso a la asesora,
    DM al colega o descarte de Sofi. También el inventario en arriendo con
    sus alertas de Wasi. `/grupos` ya no muestra los pedidos de arriendo.
    Spec, maqueta y plan en `docs/superpowers/`.
  - **Carril apagado otra vez:** `RADAR_AMOBLADO_ACTIVO=false`, decisión de
    Juan el 2026-09-12. Por ahora todo lo de arriendo va a Daiana, mientras
    se corrige Wasi. Los cambios pendientes están en el Excel que se le
    envió a Juan.

- **Visitas: toda cita va a Daiana (2026-09-11).** Rama
  `confirmacion-de-visitas`, **sin desplegar**.
  - **La regla de Juan:** Sofi solo arma la previa. La cita va a quien
    coordina las visitas: primero al 573011880668, que es el de la ventana
    abierta, y si no se puede entregar, al 573001878024. La confirma la
    asesora por WhatsApp respondiendo "OK CONFIRMADA".
  - **Qué hace la rama:**
    - `agendar_cita` ya no usa la rotación de asesores.
    - El aviso de cita sale con `entregarConRespaldo`.
    - Se quitó `proximo_disponible`.
    - Se quitaron del prompt las instrucciones de "confirmá" y "agendado".
  - **Ya aplicado en producción el 2026-09-11, sin deploy:**
    - Daiana tiene `recibe_transferencias=true` y Catherine `false`.
    - Hay una fila nueva, "Daiana Zea (línea 2)", con el 8024.
    - `RADAR_ESCALADO_PHONE=573001878024`.
  - **El backfill `scripts/backfill-citas-propuesta.js` NO se corrió, a
    propósito.** Las 5 citas que existen ya pasaron. `citas-recordatorio` no
    filtra por fecha, así que pasarlas a `propuesta` le mandaría a Daiana (y
    a Catherine) recordatorios de "confirma" por visitas viejas.
  - **Una sola línea (Juan, 2026-09-11):** no se implementa "dos líneas".
    RADA-NATALIA queda `pendiente`, con posibilidad de conectarla. Si se
    conecta, `ventana-asesora` deja de mandar sin avisar y la ventana de
    Daiana se cierra. Ver la spec `2026-09-10-radar-dos-lineas-design.md`.
  - **El caso que lo disparó:** la visita de Sebastián Velásquez (11-sep,
    3 p. m.) le llegó a Catherine, que tenía la ventana cerrada hacía 142 h,
    y se perdió. Sofi ya le había dicho "queda confirmada". Detalle en
    `docs/superpowers/specs/2026-09-10-confirmacion-de-visitas-design.md` §4.
- **Rama `colega-solo-llamada` (2026-09-10), lista y SIN desplegar.** Caso
  Ángela Moscoso: pidió contacto solo por llamada, Sofi dijo "anotado" sin
  herramienta y el radar le mandó un DM dos horas después. Ahora
  `colegas_grupos.solo_llamada` (migración `2026-09-10_colega_solo_llamada.sql`,
  **corrida y verificada por REST el 2026-09-10**; Ángela ya marcada) frena
  todos los DM: `decidirDm`, los dos caminos manuales, citas y un candado en
  `waha.enviarDm` (que ahora exige `orgId`). La marca se reconoce por lid,
  teléfono (con `directorio_lids`) y el celular escrito en el pedido. Sofi
  tiene `marcar_colega_solo_llamada` y `pedir_contacto_asesora` (el colega
  que pide hablar con una persona le llega a la asesora en el momento, con
  copia al escalado). Todo DM dice "te respondo tu PEDIDO N" o describe el
  pedido (solo el 3,8 % trae número). Specs y plan en `docs/superpowers/`.
- **La línea del radar es DaianaDiamond (301 188 0668) desde el 2026-09-10.**
  Asesora principal = Daiana Zea (`RADAR_REVISOR_PHONE` y
  `RADAR_VISITAS_ALERTA_TO` en Railway); `RADA-NATALIA` desvinculada;
  Natalia Velez inactiva. El sistema asume UNA sola línea activa: con dos,
  el DM manual, aprobar desde Sofi y la ventana de 24 h fallan en silencio.

- **Línea de Natalia: código listo para que empiece a recibir respuestas,
  aún sin desplegar (2026-09-08, rama `linea-dm-lid`, sin mergear a `main`).**
  Los DM del radar salen a `<lid>@lid` y el webhook solo aceptaba `@c.us`:
  toda respuesta de un colega moría en la primera línea, en silencio, desde
  el 2026-08-21 — `linea_dm` tenía 0 filas en toda su historia. Ahora entra
  `@lid`, se guarda con `remitente_lid`, se liga al pedido de grupo por
  `respuesta_destino_lid` y se ve en `/grupos` del CRM para todo el equipo.
  El clasificador de citas (`RADAR_DM_CLASIFICAR`) queda **apagado** — fase 1
  es solo leer. **No hay backfill:** lo que llegó antes de este cambio no
  quedó ni en log, el panel arranca vacío. Suite completa en verde
  (1730/1730, `npm test` 2026-09-08, después de la revisión final y dos olas
  de arreglos). **Desplegado el 2026-09-08** (merge a `main` + push, commit
  `1b15c5f`), con la migración `2026-09-08_linea_dm_lid.sql` **corrida por
  Juan y verificada por REST el mismo día**: `select remitente_lid` responde,
  y el filtro `.eq("remitente_lid", …)` también — o sea que el índice y el
  camino real de `historialDe` funcionan, no solo que la columna existe.
  **Supuesto no probado:** que la respuesta del colega llegue etiquetada
  `@lid`; si a las 48 h no entra ninguna fila en `linea_dm`, hay que mirar
  los eventos crudos de WAHA antes de concluir cualquier otra cosa.
  Al desplegar: `linea_dm` en 0 filas y 88 señales con destino de DM
  registrado — ese es el denominador contra el que se mide si esto funcionó.
  **Hallazgo de la revisión, pendiente de decisión de Juan:**
  `group_signals.respuesta_destino_lid` se escribe hoy con DOS formatos según
  el camino — `src/groups/vivo.js:657` (automático) guarda el lid crudo CON
  sufijo `@lid`, pero `vivo.js:1144` y `:1343` (aprobación manual y DM manual
  desde el CRM) guardan dígitos pelados SIN sufijo. Como `buscarPorLid`
  compara por igualdad exacta, una señal resuelta a mano nunca se va a ligar.
  Verificado contra producción el 2026-09-08: 84 de 84 filas tienen el
  sufijo, todas automáticas — el bug es **latente, no activo** — pero
  producción está en `GRUPOS_RESPUESTA_MODO=asistido`, que es justo el modo
  de los caminos manuales. Spec y plan en `docs/superpowers/`.
- **Radar en observación (desplegado 2026-09-04, commit `aec9fc8`).** Se aflojó
  la política de DM al colega: `match.js` ya no descarta por alcobas de más ni
  por baños/garajes cortos, y se quitó el tope de 2 DMs por colega. Decisión de
  Juan con el riesgo sobre la mesa — spec y plan en `docs/superpowers/`.
  **Hay que mirarlo, no dejarlo correr solo:** WhatsApp le impone a la línea
  ~300 mensajes por mes calendario (`messageCapping`), y hay un cortacircuitos
  que frena los DMs al 80% y deriva todo a la asesora.
  `GET /webhook/grupos/estado` devuelve `dmsUltimas24h` y `cuotaWhatsapp`.
  **Ojo al leerlos: no miden lo mismo.** `dmsUltimas24h` cuenta filas con
  `respuesta_modo='auto'`, que incluye publicaciones viejas en grupo, así que
  está inflado (al desplegar decía 18 contra 13 de WhatsApp en todo el mes).
  El número que manda es `cuotaWhatsapp.usados`.
- **El remote de git quedó en SSH** (2026-09-04). El 403 de HTTPS por la cuenta
  CAPELA127 es historia: `git push origin main` funciona sin rodeos.

- **Objetivo activo:** DMAP Fase 1 cerrada y desplegada (sync, IA de
  creativos, publicación, analytics); foco actual = cerrar los known issues
  antes de sumar features nuevas a DMAP.
- **En producción, las 4 piezas:** bot (Railway), CRM (Vercel,
  `crm.diamondinmobiliaria.com`), DMAP (Railway,
  `dmap-production.up.railway.app`), landing REF (Vercel,
  `diamondinmobiliaria.com`).
- **Restricciones del equipo:** 1 dev, sin admin en la máquina Windows de
  desarrollo, presupuesto de infra mínimo (~5 USD/mes por servicio Railway).
- **Known issue abierto (P2):** `metrics.worker` de DMAP falla el 100% de sus
  corridas (Graph API) — no bloquea ventas. Detalle en
  [dmap/README.md](dmap/README.md).
- **WIP sin pushear:** los motores "designer"/"hybrid" ya están en
  `origin/main` y desplegados. Confirmar igualmente con
  `git log origin/main..HEAD` antes de asumir que un commit local está en
  producción (Railway despliega desde GitHub).
- **Migraciones en Supabase (verificado 2026-09-03 contra producción por
  REST, proyecto `qwqmlmyyswpdypdfvmiv`):** TODAS las columnas y tablas de
  `db/migrations/` hasta `2026-09-03_aviso_link.sql` existen y tienen datos
  reales (10 señales con `aviso_token`, 81 con `aviso_advisor_id`,
  `organizations.mandatos_activos=false`, `directorio_lids` creada,
  `creative_engine='designer'` en la org Diamond). `CRM_PUBLIC_URL` ya está en
  Railway y el arranque lo confirma en el log ("Link de avisos: https://crm...").
  Publicación Realtime verificada 2026-09-03 con `pg_publication_tables`:
  leads, conversations, messages, publication_events, command_messages,
  group_signals y mandato_match_alerts — `2026-08-14_realtime_leads.sql` y
  `2026-09-02_realtime_grupos.sql` corridas. `2026-07-09_dmap_default_designer.sql`
  corrida el mismo día en el mismo bloque (solo el DEFAULT para orgs nuevas).
  `2026-09-04_dm_destinatario.sql` (columnas de auditoría del destinatario del
  DM) corrida y verificada por REST el 2026-09-04.
  `2026-09-07_amoblado.sql` (columnas `amoblado` y `periodo` en
  `group_signals`) corrida por Juan y **verificada por REST** el 2026-09-07:
  la consulta devuelve `{"amoblado":null,"periodo":null}`, no un 42703.
  `2026-09-08_linea_dm_lid.sql` (columna `remitente_lid` en `linea_dm`)
  corrida por Juan y **verificada por REST** el 2026-09-08: `select
  remitente_lid` responde y el filtro `.eq("remitente_lid", …)` también.
  **No hay migraciones pendientes.**
  Regla: antes de declarar una migración "pendiente" acá, verificarla con un
  `select` por REST — esta lista estuvo desactualizada del 2026-08-18 al
  2026-09-03.
- **Pendientes de negocio:** teléfonos reales de asesores de arriendo/
  vehículos en `advisors` · corregir precio de la ref `9921388` en Wasi ·
  verificación de empresa en Meta · confirmar las 3 propiedades exclusivas
  del negocio · **los amoblados que faltan en Wasi**: el sync trae el 100% de
  lo que expone la cuenta, pero esa cuenta es **PARAISO INMOBILIARIO**
  (`paraisoinmobiliario.inmo.co`) y sólo tiene 2 propiedades en alquiler.
  Verificado el 2026-09-07 con una corrida manual (`seen 112, created 0`)
  contrastada contra el conteo de la web pública de la cuenta, que da los
  mismos 112. Si se cargan en otra cuenta de Wasi, el sync no las ve y **no
  falla**.
- **Carril de amoblados (2026-09-07):** el radar ya entiende "amoblado" y
  saca las demandas de arriendo por dos carriles — DM al colega si el match
  llega a `RADAR_AMOBLADO_UMBRAL_DM` (85), y aviso diferenciado a la asesora
  si no. `RADAR_AMOBLADO_ACTIVO=false` apaga el carril entero.
  **Golden set corrido y en verde (2026-09-07, 6/6):**
  `railway run --service diamond node scripts/golden-revalidar.js` — se corre
  con la clave de PRODUCCIÓN, no con la local. Lo que prueba: la frase nueva
  sobre amoblado no degradó a D7. En los 6 casos las propiedades siguen
  saliendo en `refs_utiles` con el dato en `sin_confirmar` y `refs_dudosas`
  vacío — o sea, Sofi no empezó a tratar lo no registrado como "de segunda",
  que era el riesgo real y habría afectado al carril de VENTA sin que ningún
  test lo viera.

## 3. Mapa de módulos

Cargá solo el documento que corresponda a la tarea:

| Si la tarea toca... | Leer |
|---|---|
| Bot de WhatsApp (Sofi, prompts, tools, calificación, canales) | [ARCHITECTURE.md](ARCHITECTURE.md) — incluye reglas de dominio que NO se pueden romper |
| Setup, comandos y tests del bot | [README.md](README.md) |
| CRM (inbox, leads, auth, módulo Marketing) | [crm/ARCHITECTURE.md](crm/ARCHITECTURE.md) |
| DMAP (sync Wasi, IA de creativos, publicación en Meta, analytics) | [dmap/ARCHITECTURE.md](dmap/ARCHITECTURE.md) (diseño completo) + [dmap/README.md](dmap/README.md) (estado real desplegado, comandos, known issues) |
| Landing REF (`web/`) | [web/README.md](web/README.md) (setup, envs, arquitectura) + [web/DESIGN.md](web/DESIGN.md) (sistema visual) |
| Estrategia comercial / Meta Ads / buyer personas / SOPs de venta | [playbook/00-INDICE.md](playbook/00-INDICE.md) — índice de 8 documentos |
| Schema o migraciones de base de datos | [db/schema.sql](db/schema.sql) + `db/migrations/` — única fuente de verdad para las 4 apps |
| Variables de entorno | `.env.example` de cada módulo (raíz, `crm/`, `dmap/`, `web/`) — nunca commitear un `.env` real |

`CAMPAÑAS/` y `DIAMOND/` son carpetas sin versionar con assets de campañas
(PDFs, imágenes, xlsx) — material de referencia, no código.

## 4. Reglas de trabajo

Antes de escribir código nuevo, en este orden:

1. **Reutilizar** — ¿ya existe un módulo, función o tabla que resuelve esto?
   Revisá el módulo correspondiente en el mapa antes de asumir que hace
   falta algo nuevo.
2. **Integrar** — ¿se conecta con lo existente sin tocar su contrato? (ej.:
   el CRM lee de la misma Supabase; nunca duplica la lógica de envío de
   WhatsApp que ya vive en el bot).
3. **Extender** — ¿alcanza con agregar un caso, campo o tool a un módulo ya
   aprobado? (ej.: un canal nuevo en `src/channels/`, un documento nuevo en
   el playbook).
4. **Construir** — solo si ninguna de las anteriores aplica: módulo nuevo,
   con su propio `ARCHITECTURE.md` aprobado antes de escribir código de
   implementación (ver [dmap/ARCHITECTURE.md](dmap/ARCHITECTURE.md) como
   ejemplo del proceso).

Además:

- Nunca asumas qué está activo en producción solo por lo que dice un
  `ARCHITECTURE.md` — el diseño aprobado y lo desplegado pueden divergir
  (ver "WIP sin pushear" arriba). Confirmá con el README del módulo o con
  `git log`.
- Multi-tenant siempre: no hardcodear datos de Diamond donde debería
  resolverse por `org_id`/tenant.
