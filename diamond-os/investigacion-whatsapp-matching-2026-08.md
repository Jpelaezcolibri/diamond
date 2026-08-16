# Investigación profunda — Sistema de matching inmobiliario sobre WhatsApp con mínimo riesgo de bloqueo

**Fecha:** 2026-08-16 · **Autor:** Claude Code (investigación dirigida por Juan Pelaez) ·
**Audiencia:** interna técnica (Diamond / Vértice Studio)

**Método.** Seis líneas de investigación web en paralelo (doc oficial de Meta verificada
al 11-ago-2026, programas partner, 15 BSPs, 15+ productos "group inbox", librerías no
oficiales, Ley 1581/SIC), cruzadas con la evidencia interna del repo: el log de decisiones
[epe/DECISIONES.md](../epe/DECISIONES.md) (D1–D9), la forense del baneo del 2026-07-30
([auditoria-ecosistema-2026-08-01.md](auditoria-ecosistema-2026-08-01.md) §4 y
[el spec de la extensión](../docs/superpowers/specs/2026-08-01-extension-chrome-radar-design.md)),
y el código en producción (`src/groups/*`, `src/channels/whatsapp.js`).

**Etiquetas de fuente.** Cada afirmación importante lleva una de estas marcas:
**[OFICIAL]** doc de Meta o texto legal · **[PROVEEDOR]** doc técnica del proveedor ·
**[SECUNDARIA]** análisis de terceros · **[COMUNIDAD]** issues/foros ·
**[INTERNA]** evidencia medida en este proyecto · **[INFERENCIA]** deducción técnica propia.

---

## 1. Executive Summary

1. **No existe, a agosto de 2026, ninguna vía oficial para leer o escribir en grupos de
   WhatsApp existentes de 50–80 participantes.** Ni Cloud API, ni la nueva Groups API, ni
   Coexistence, ni ningún BSP, tier de partner o beta de Meta. [OFICIAL] — demostrado en §2 y §3.
2. **La Groups API (GA feb-2026) es lo contrario de lo que necesitamos:** solo grupos creados
   por el negocio vía API, máximo **8 participantes**, invite-only, requiere Official Business
   Account. No puede unirse a grupos preexistentes. [OFICIAL]
3. **Coexistence tampoco es puente:** la doc de Meta lo dice textual — *"Group chats will not
   be synchronized"* — y un número en Coexistence ni siquiera califica para la Groups API. [OFICIAL]
4. **Todo producto comercial que sí lee grupos existentes (Whapi, Periskope, TimelinesAI,
   Unipile, 2Chat, Wassenger…) opera por sesión vinculada QR — protocolo no oficial**, la misma
   familia técnica que baneó la línea de una asesora nuestra el 2026-07-30. [PROVEEDOR][INTERNA]
5. **El baneo de julio no fue por conducta sino por cliente:** los logs muestran `stream:error
   503` *antes* del loop de reintentos, con fingerprint de Baileys desde IP de datacenter.
   Meta endureció términos en oct-2025 (vigentes 15-ene-2026) y hay reportes 2026 de cuentas
   de bajo volumen y solo-respuesta recibiendo advertencias. Ninguna configuración "prudente"
   de un cliente no oficial es segura. [INTERNA][COMUNIDAD]
6. **La arquitectura segura ya existe y está en producción en este repo:** captura mediada por
   humanos (reenvío a Sofi por Cloud API + export nativo `.txt`) → prefiltro léxico local (~85%
   de descarte, 0 tokens) → clasificación Haiku con schema forzado → matching determinístico →
   digest diario → aprobación humana en el CRM. Riesgo de baneo: cero, porque ningún cliente no
   oficial toca el protocolo. [INTERNA]
7. **El lado oferta no necesita los grupos:** la búsqueda en la red pública de sitios Wasi
   (PoC validada: 58 sitios en 11,5 s, 162 propiedades) da datos estructurados, frescos y con
   contacto marcable — mejor que el 1,6% de mensajes accionables que produjo la captura en vivo. [INTERNA]
8. **La respuesta automática en el mismo grupo queda descartada por partida doble:** no hay vía
   oficial para enviarla, y la regla del proyecto ("Fase C — nunca") la prohíbe incluso si la
   hubiera por vía gris. La respuesta viaja 1:1 desde la línea Cloud API o la envía un humano. [INTERNA]
9. **Cumplimiento colombiano es viable pero exige controles:** la Ley 1581 aplica en pleno
   (publicar en un grupo no vuelve público el dato, dice la SIC), EE.UU. es país adecuado para
   la transmisión a Supabase/Anthropic con DPA, y hay precedente directo de multa ($670M COP a
   Movistar, oct-2025, por contacto comercial por WhatsApp sin autorización). El riesgo nº1 son
   los datos del cliente final mencionado en el grupo. [OFICIAL][SIC]
10. **Recomendación (una sola):** consolidar la arquitectura "Radar sobre Cloud API" que ya
    está desplegada — reenvío + export + red Wasi como fuentes, motor determinístico existente,
    respuesta 1:1 con humano en el circuito — y evaluar la extensión Chrome de solo lectura
    únicamente cuando el piloto pruebe el valor de la demanda en tiempo real. Detalle en §7.

---

## 2. What is actually possible in WhatsApp in August 2026?

Verificado contra la documentación de Meta entre el 11 y el 16 de agosto de 2026 (la doc migró
a `developers.facebook.com/documentation/business-messaging/whatsapp/...`; changelog oficial
actualizado al 11-ago-2026).

### 2.1 Cloud API

- **Qué es:** la API oficial de mensajería empresarial, hosteada por Meta. Es la que ya usa el
  bot Sofi ([src/channels/whatsapp.js](../src/channels/whatsapp.js)). [OFICIAL]
- **Recibe:** mensajes 1:1 por webhook (`messages`), con firma `x-hub-signature-256`. Los
  únicos mensajes "de grupo" que emite son los de grupos creados por la Groups API, marcados
  con `group_id`. **No existe payload de grupos de consumidores.** [OFICIAL]
- **Envía:** texto/media libre dentro de la ventana de servicio de 24h (se abre cuando el
  usuario escribe; gratis); fuera de ella, solo plantillas aprobadas. Ventana de free entry
  point de 72h para ads click-to-WhatsApp. [OFICIAL]
- **Pricing (Colombia, rate card oficial vigente 1-jul-2026):** por mensaje entregado —
  Marketing **USD 0.0125**, Utility **USD 0.0008**, Authentication **USD 0.0008**; mensajes de
  servicio (dentro de ventana) **gratis**. Facturación en COP disponible desde abr-2026. [OFICIAL]
- **Límites:** los límites de mensajería son ahora por *portafolio* (cambio oct-2025): 250
  conversaciones iniciadas/día al inicio, escalando a 2.000 → 10.000 → 100.000 → ilimitado
  según calidad. Throughput por número: 80 msg/s por defecto (20 msg/s fijos si el número está
  en Coexistence). Existe pair rate limit por saturar a un mismo usuario. [OFICIAL]
- **Calidad:** quality rating por número/plantilla; degradarlo restringe volumen y puede
  pausar plantillas. [OFICIAL]
- **Novedades 2025-2026 del changelog:** pricing por mensaje (jul-2025), Business Calling API
  (jul-2025), **Groups API** (oct-2025), límites por portafolio (oct-2025), Marketing Messages
  API GA (nov-2025), **Groups API abierta a todo OBA** (feb-2026), webhooks de Coexistence
  `account_offboarded`/`account_reconnected` (feb-2026), **Meta Business Agent** — agentes IA
  operados sobre WhatsApp (jun-2026), Direct Send para utility/auth sin plantilla (jun/jul-2026),
  BSUID y usernames de empresa (jun-2026). Ninguna de estas novedades toca grupos existentes. [OFICIAL]

### 2.2 Groups API

- Anunciada el **6-oct-2025**; desde el **3-feb-2026**: *"Cloud API Groups are now available to
  all businesses with an Official Business Account."* [OFICIAL — changelog]
- **Solo grupos creados por el negocio vía API.** El flujo entero lo presupone: la empresa crea
  el grupo → recibe `invite_link` → lo distribuye 1:1 → el usuario decide unirse. *"Since you
  cannot manually add participants to the group, simply send a message with your invite link to
  WhatsApp users who you would like to join."* No existe endpoint para unirse a un grupo ajeno. [OFICIAL]
- **Máximo 8 participantes** por grupo (*"Max group participants: 8"*), hasta 10.000 grupos por
  número, **1 empresa Cloud API por grupo**. [OFICIAL]
- Dentro de sus grupos propios sí hay ciclo completo: webhooks de mensajes con `group_id`,
  respuesta con `recipient_type: "group"`, 4 webhooks de ciclo de vida, fijar mensajes,
  aprobar solicitudes de ingreso. La ventana de servicio del grupo se abre cuando *cualquier*
  miembro escribe. Pricing por destinatario (`group_marketing`, `group_utility`; no-plantilla
  gratis). [OFICIAL]
- **Requisitos:** número en Cloud API + **OBA** + webhooks suscritos. Excluidos: números de la
  app WhatsApp Business y números en Coexistence/Multi-solution. Disponible en todos los países
  de Cloud API. [OFICIAL]
- **Veredicto para nuestro caso:** es la respuesta A de la disyuntiva del prompt — una API para
  grupos nuevos controlados por la empresa, NO una API para leer grupos existentes. El límite
  de 8 es diseño deliberado, no un tope provisional. [OFICIAL][SECUNDARIA]

### 2.3 Coexistence

- Permite que un número de la app WhatsApp Business opere a la vez en la app y en Cloud API
  (onboarding por Embedded Signup; requiere ser Solution Partner o Tech Provider; app
  v2.24.17+; Embedded Signup v2 queda obsoleto el 15-oct-2026 → migrar a v4). [OFICIAL]
- **Sincroniza:** historial 1:1 de los últimos 6 meses (opt-in, una sola vez, en 3 fases),
  espejo bidireccional en tiempo real vía `smb_message_echoes`, contactos. La operación manual
  en el teléfono continúa. [OFICIAL]
- **NO sincroniza grupos.** Textual, tabla de comparación de features: *"Group chats will not
  be synchronized."* Y en el webhook de historial: *"messages that are part of a group chat
  will not be included."* Los grupos siguen viviendo solo en el teléfono. Además el número en
  Coexistence queda vetado de la Groups API y limitado a 20 msg/s. [OFICIAL]
- Confirmación práctica de un BSP: con Coexistence *"group chats will only be visible and
  accessible on the WhatsApp Business App and cannot be viewed or managed from SleekFlow."* [PROVEEDOR]
- **Veredicto:** Coexistence resuelve otro problema real (meter las conversaciones 1:1 de un
  asesor al CRM sin que cambie de herramienta — anotado como POST-MVP en D9), pero **no da
  acceso a grupos por API, ni de lectura ni de escritura**. [OFICIAL][INTERNA]

### 2.4 Official Business Account (OBA)

- Requisitos: cumplir la Business Messaging Policy, ≥30 días en la plataforma, verificación de
  empresa, 2FA, display name aprobado. Se solicita por WhatsApp Manager o API; si la niegan,
  reintento a los 30 días. Una inmobiliaria verificada puede obtenerlo. [OFICIAL]
- Habilita: check azul, mejor descubribilidad y — novedad 2026 — **acceso a la Groups API**
  (grupos propios de ≤8). [OFICIAL]
- NO habilita: unirse a grupos de consumidores, leer grupos existentes, ni inmunidad alguna
  ante enforcement — la política de mensajería aplica igual. OBA ≠ acceso ilimitado. [OFICIAL][INFERENCIA]

### 2.5 BSPs (Solution Partners)

Auditados 15: 360dialog, Twilio, Infobip, Vonage, Sinch, Gupshup, Bird, WATI, respond.io,
Interakt, Zoko, SleekFlow, Trengo, Rasayel, Kapso. **Todos están detrás de la misma Cloud API;
ninguno lee grupos existentes.** [PROVEEDOR] Detalles notables:

- 360dialog, Zoko y Kapso ya exponen la Groups API de Meta (con sus límites: 8, OBA, grupos
  propios). Kapso tiene waitlist pública de "WhatsApp Groups API". [PROVEEDOR]
- El "group messaging" de Twilio es un relay 1:1 con fan-out a nivel de aplicación — no es un
  grupo real de WhatsApp. [PROVEEDOR]
- WATI y Trengo dicen explícitamente en sus FAQ que la API no soporta grupos. [PROVEEDOR]
- El roadmap público de respond.io (feb-2026): Meta lanzó grupos nativos por Cloud API *"though
  there are significant restrictions at this time and it is not available for Coexistence users
  yet"*. [PROVEEDOR]
- La doc Latam de Sinch con endpoints de grupos es herencia de la On-Premises API de Wavy, ya
  en sunset — capacidad muerta. [PROVEEDOR][INFERENCIA]

### 2.6 Tech Providers y programas de Meta

- Tech Provider vs Solution Partner: la diferencia es comercial (línea de crédito, facturación,
  soporte directo), **no técnica** — misma Cloud API para ambos. [OFICIAL]
- Los partners Premier obtienen acceso *anticipado* a betas del roadmap público (Calling API,
  tipos de plantilla), no APIs paralelas. No existe evidencia de ninguna "enterprise API" de
  grupos. La beta de la Groups API ya cerró: hoy es GA condicionada a OBA. [OFICIAL][SECUNDARIA]
- Señal fuerte por ausencia: los vendors que venden acceso a grupos existentes (p.ej. Unipile)
  se declaran *"not affiliated with, endorsed by, or sponsored by WhatsApp or Meta"* — si
  existiera un canal oficial, lo usarían y lo publicitarían. [PROVEEDOR][INFERENCIA]

---

## 3. Can we safely read the existing 50–80 person groups?

### Respuesta: **NO por vía automática — PARTIALLY por captura mediada por humanos.**

**NO automático, demostrado por agotamiento de vías:**

| Vía | ¿Lee grupos existentes? | Evidencia |
|---|---|---|
| Cloud API | No — solo 1:1 y grupos propios de la Groups API | [OFICIAL] §2.1 |
| Groups API | No — solo grupos creados por API, máx. 8, invite-only | [OFICIAL] §2.2 |
| Coexistence | No — *"Group chats will not be synchronized"* | [OFICIAL] §2.3 |
| OBA | No cambia nada de lo anterior | [OFICIAL] §2.4 |
| 15 BSPs | Ninguno — mismos límites de la Cloud API | [PROVEEDOR] §2.5 |
| Partners/betas/enterprise | No existe programa que lo dé | [OFICIAL][SECUNDARIA] §2.6 |
| Productos "group inbox" | Sí, pero todos por sesión QR no oficial | [PROVEEDOR] §16 |
| Librerías no oficiales | Sí, pero es la categoría que ya nos baneó una línea | [INTERNA][COMUNIDAD] §4 |

**PARTIALLY, por las dos vías que no tocan el protocolo** (ambas ya en producción en este repo):

1. **Reenvío a Sofi:** un asesor reenvía el mensaje relevante del grupo a la línea Cloud API
   oficial. Cobertura: lo que el humano decide (que es un filtro mejor que la IA — el humano no
   reenvía los 1.604 mensajes de ruido de cada 1.630). Tiempo real: sí. Riesgo: cero. [INTERNA]
2. **Export nativo `.txt`:** función nativa de WhatsApp, el asesor sube el archivo al CRM.
   Cobertura: el grupo completo, en lote. Tiempo real: no. Riesgo: cero. Límite práctico
   honesto: el export es por chat — 80 grupos = 80 exports manuales; sirve para pilotos de 5–10
   grupos, no para operación diaria total. [INTERNA]

Existe una tercera vía en evaluación (extensión Chrome de solo lectura sobre WhatsApp Web
oficial) y una cuarta diferida (teléfono Android dedicado + lector de notificaciones del SO).
Ninguna toca el protocolo; ambas tienen zonas grises de ToS y límites propios — ver §5 y §7.

---

## 4. Why was the previous architecture risky?

El prototipo anterior usaba WAHA (gateway sobre Baileys): un cliente que **habla el protocolo
de WhatsApp reverse-engineered**, emparejado como dispositivo vinculado de la línea de una
asesora real.

**La forense del baneo (2026-07-30), medida en nuestros logs** [INTERNA]:

- Secuencia: 11 h de operación normal → `stream:error 503` → 60 reintentos en 5 min → sesión
  trabada → baneo. **El 503 llegó primero: la cuenta ya estaba marcada** antes del loop de
  reintentos.
- Huella dejada en logs: `["Ubuntu","Chrome","22.04.4"]` desde IP de datacenter — la firma de
  Baileys.
- Conclusión interna, hoy regla del proyecto: *"WhatsApp no sancionó una conducta. Sancionó un
  cliente no autorizado. Da igual leer, escribir o no hacer nada."*

**La investigación externa lo confirma como mecanismo general** [SECUNDARIA][COMUNIDAD]:

- El fingerprinting de protocolo (handshake, orden de negociación de claves, timing) es el
  mecanismo primario de detección; los delays y el backoff no lo evitan.
- Meta actualizó términos en oct-2025 (vigentes desde el 15-ene-2026) endureciendo el
  enforcement contra integraciones no autorizadas. Desde entonces hay una ola documentada:
  issues 2026 en Baileys (#2309, #2658), WAHA (#2068: cuentas baneadas al poco de crear la
  sesión) y Evolution API (#2298, #2353…: bots con 3+ años de operación caídos).
- Lo más revelador: en whatsmeow — la librería mejor mantenida — hay reportes 2026 (#807, #810)
  de advertencias *"your account may be at risk"* en clientes de **bajo volumen que solo
  respondían mensajes entrantes**. La detección apunta al cliente, no a la conducta.
- Los ToS de WhatsApp prohíben textualmente *"reverse engineer, alter, modify, create
  derivative works from, decompile, or extract code from our Services"* y crear software que
  funcione *"substantially the same as our Services"* — la definición literal de estas
  librerías. [OFICIAL]
- Precedentes de escalada legal: política declarada de acción legal contra automatización no
  autorizada (dic-2019), cease & desist al autor original de Baileys (abr-2023, repo
  eliminado), demanda Meta v. Rockey Tech (2022). [OFICIAL][SECUNDARIA]

**En síntesis:** el prototipo era riesgoso porque su superficie de conexión era en sí misma la
violación, con independencia de cuán prudente fuera su comportamiento. Por eso "portarse bien"
sobre WAHA no era una mitigación, y por eso cambiar de orquestador (n8n/Make/Zapier con nodos
no oficiales) no mueve la restricción.

---

## 5. Architecture options

Las tres comparten el mismo motor (ya construido): prefiltro léxico → clasificación Haiku →
matching determinístico → CRM. Difieren solo en **cómo entran las señales** y **cuánto humano
hay en la salida**.

### Arquitectura 1 — Máxima seguridad (solo vías con riesgo estructural cero)

```
Grupos gremiales ──(humano reenvía)──► Línea Cloud API (Sofi) ─┐
Grupos gremiales ──(humano exporta .txt)──► CRM upload ────────┤
Red pública de sitios Wasi ──(scraper de sitios propios)───────┤
                                                               ▼
                        prefiltro → Haiku → matching → señal en CRM
                                                               │
                              asesor ve match + borrador ──────┤
                                                               ▼
                        respuesta MANUAL (asesor copia/pega en el grupo
                        o Sofi responde 1:1 al colega que ya escribió)
```

- **Componentes:** todo existe hoy (`src/groups/*`, `crm/.../grupos`, digest 7am).
- **Ventajas:** riesgo de línea cero; cero dependencia de zonas grises; ya desplegado.
- **Desventajas:** cobertura limitada a lo que los humanos alimentan; latencia del export;
  disciplina de hábito de los asesores como punto débil.
- **Riesgo residual:** solo el de privacidad (mitigable, §12). Baneo: ninguno identificado.

### Arquitectura 2 — Máxima automatización compatible con lo oficial

Todo lo de la Arquitectura 1, más las piezas oficiales que sí se pueden automatizar a fondo:

- **OBA + Groups API para micro-grupos propios** (≤8): un grupo por negocio (asesor + cliente +
  cónyuge + captador) con webhooks completos y respuesta automática de Sofi *dentro de grupos
  nuestros* — único lugar donde la respuesta automática en grupo es oficial y permitida. [OFICIAL]
- **Click-to-Sofi:** enlaces `wa.me/<número>?text=<pedido prellenado>` que los asesores pegan
  en los grupos gremiales; el colega interesado hace click y cae 1:1 con Sofi, que ya hace
  interpretación + matching + respuesta hoy. Abre ventana de 24h y convierte al colega en
  contacto marcable (lo que los `@lid` de los grupos nunca fueron). [OFICIAL][INTERNA]
- **Automatización 1:1 completa** (ya existe): calificación, ficha, agenda, transferencia.
- **Digest diario por plantilla utility** (corregir la plantilla actual, hoy clasificada
  MARKETING: 15× más cara — §13).
- **Ventajas:** máximo nivel de automatización sin tocar una sola zona gris; escalable
  multi-tenant.
- **Desventajas:** los grupos gremiales siguen entrando por humanos; requiere tramitar OBA;
  el click-to-Sofi depende de adopción social.

### Arquitectura 3 — Máximo cumplimiento del flujo actual (80 empresas → grupos → IA → respuesta)

Lo anterior, más captura ampliada de los grupos gremiales **sin hablar el protocolo**:

- **Extensión Chrome de solo lectura** sobre WhatsApp Web oficial del asesor: lee el DOM que el
  navegador ya renderizó, prefiltra localmente (~85% nunca sale del computador), sube solo
  señales. Sin vector de protocolo (no hay cliente propio). Límites reales: post-D7 solo puede
  leer la conversación abierta (la IndexedDB está cifrada en reposo [INTERNA]); ToS en zona
  gris (leer tu propia pantalla no está bendecido, aunque no hay ningún caso documentado de
  baneo por extensión de solo lectura — todos los casos conocidos son de envío); Chrome 149
  obliga MV3 + publicación en Web Store (semanas de calendario). [INTERNA][INFERENCIA]
- **Ruta D (diferida):** teléfono Android de la empresa con app oficial + lector de
  notificaciones del SO. No habla el protocolo (Meta ve un teléfono normal). Límites:
  notificaciones truncadas, **los grupos silenciados no notifican** (y los gremiales suelen
  estarlo), permisos de accesibilidad como fricción de venta. Solo si A/B/C se quedan cortas y
  con canario de 3 semanas, línea y equipo de la empresa, watchdog y kill switch verificado. [INTERNA]
- La **salida sigue siendo humana o 1:1**: ni esta arquitectura publica automáticamente en el
  grupo (§15).
- **Ventajas:** es la única que se acerca a "leer los 80 grupos" con riesgo acotado.
- **Desventajas:** zona gris de ToS en la extensión; fragilidad de DOM; calendario de Web
  Store; la Ruta D es cara y frágil. Riesgo de línea: bajo pero no cero — y recae en decisiones
  aún no tomadas.

---

## 6. Risk matrix

Factores de riesgo del sistema (independientes de la arquitectura elegida donde no se indique):

| Factor | Riesgo | Evidencia | Mitigación |
|---|---|---|---|
| Cliente no oficial hablando el protocolo (Baileys/WAHA/gateways QR) | 🔴 | Baneo propio 2026-07-30; ola de enforcement 2026; ToS explícitos [INTERNA][COMUNIDAD][OFICIAL] | Prohibido por regla del proyecto. No se mitiga: no se usa |
| Enviar mensajes salientes automatizados a números sin opt-in | 🔴 | Caso Movistar: $670M COP, oct-2025 [SIC]; política de calidad de Meta [OFICIAL] | Solo responder a quien escribió (ventana 24h) o plantillas a opt-in registrados |
| Publicar automáticamente en grupos gremiales | 🔴 | Sin vía oficial [OFICIAL]; percepción de spam por 80 colegas → reportes; regla interna "Fase C — nunca" [INTERNA] | No se construye. Respuesta 1:1 o manual |
| Extensión de solo lectura sobre WhatsApp Web | 🟡 | ToS prohíben "uso automatizado" (zona gris para lectura); ningún caso documentado de baneo por leer; precedente favorable GistGem en Web Store [INFERENCIA][SECUNDARIA] | Solo lectura estricta (P6, protegido por test); prefiltro local; canario en cuenta de Juan antes que asesores |
| Volumen/frecuencia de envío 1:1 | 🟡 | Límites por portafolio (250 iniciales) y pair rate limit [OFICIAL] | Rate limit propio; digest 1/día por org (`digest_enviado_at`); crecimiento del tier con calidad |
| Calidad de plantillas (quality rating) | 🟡 | Pausas de plantilla documentadas [OFICIAL] | Plantillas utility bien clasificadas; contenido corto; opt-out fácil |
| Bloqueos/reportes de destinatarios | 🟡 | El rating cae con reportes [OFICIAL] | Responder solo a interesados; identificarse; tono del playbook |
| Datos del cliente final mencionados en grupos | 🟡 | Ley 1581 sin excepción B2B; doctrina SIC "publicado ≠ público" [OFICIAL][SIC] | Seudonimizar hasta opt-in; TTL de texto crudo; §12 |
| Sesiones simultáneas / dispositivos vinculados no oficiales | 🔴 | Es el vector del factor 1 | Ninguno: prohibido |
| Dependencia de proveedor (BSP/gateway) | 🟢 | Integración directa a Cloud API sin intermediario [INTERNA] | Mantener integración directa; sin lock-in |
| Antigüedad/reputación de la línea | 🟢 | Línea Cloud API dedicada, sin historial de infracciones | No mezclar la línea del bot con experimentos |
| Consentimiento de miembros del grupo | 🟡 | Ley 1581 art. 9 [OFICIAL] | Autorización documentada de asesores; aviso de privacidad; §12 |

No se asignan probabilidades numéricas de baneo: Meta no publica esas cifras y cualquier número
sería inventado.

---

## 7. Recommended architecture

**Recomendación única: Arquitectura 2 ("Radar sobre Cloud API, máxima automatización
oficial"), con la Arquitectura 3 como evolución condicionada a evidencia — no como punto de
partida.**

Por qué esta y no otra:

1. **El 90% ya está construido y en producción.** El motor (prefiltro → Haiku → matching →
   CRM → digest) es independiente del canal de entrada y sobrevivió intacto al desmantelamiento
   de WAHA. Lo único que murió fue el transporte prohibido. [INTERNA]
2. **Los datos propios dicen que la captura total automática vale menos de lo que parece:** de
   1.630 mensajes capturados en vivo, 26 accionables (1,6%). El humano que reenvía es un
   prefiltro mejor que cualquier clasificador, y gratis. [INTERNA]
3. **El lado de mayor valor (oferta) no necesita los grupos:** la red de sitios Wasi da
   inventario estructurado, fresco y con contacto marcable, con PoC validada (58 sitios/11,5 s/
   162 propiedades). [INTERNA]
4. **Todo lo automatizable oficialmente queda automatizado:** interpretación, matching,
   borradores, digest, respuesta 1:1 de Sofi, micro-grupos propios por negocio vía Groups API.
   Lo único manual es el paso que hoy no tiene vía oficial: sacar el mensaje del grupo y meter
   la respuesta al grupo.
5. **La extensión Chrome no se descarta — se condiciona.** Si tras 4–6 semanas de piloto los
   pedidos en tiempo real demuestran ser negocio (umbrales ya definidos en el spec de grupos:
   ≥5 demandas/día, ≥30% con match, precisión ≥80%), se construye la extensión de solo lectura
   con sus 8 invariantes protegidos por test y canario en cuenta propia. Decidirla hoy, sin ese
   dato, sería repetir el error de proceso del intento anterior: ir directo al activo más
   valioso sin canario. [INTERNA]

Qué se sacrifica: la fantasía del bot que lee 80 grupos y responde solo. Qué se gana: una línea
que no se puede perder por diseño, un sistema defendible ante Meta y ante la SIC, y la mayor
parte del valor de negocio por vías que nadie puede apagar.

---

## 8. Migration strategy

La migración del prototipo (WAHA) a la arquitectura segura **ya ocurrió** (jul–ago 2026):
WAHA fuera del repo, regla escrita, captura por export/reenvío desplegada. Lo que queda es
consolidación, no migración:

1. **Cerrar el legado:** confirmar que ningún proceso zombie local sigue escribiendo en
   producción (gotcha conocido del proyecto); mantener las credenciales WAHA revocadas.
2. **Tramitar OBA** para la línea de Sofi (requisitos ya alcanzables: verificación de empresa
   en Meta está en pendientes de negocio; 30 días de antigüedad ya cumplidos). Sin OBA no hay
   Groups API para micro-grupos.
3. **Corregir la plantilla del digest** a categoría utility (hoy MARKETING: 15× el costo).
4. **Piloto de captura (4–6 semanas):** 2–3 asesores, 5–10 grupos clave, reenvío + export
   semanal; medir contra los umbrales del spec. El CRM ya registra outcomes (`signal_events`,
   append-only) — esa es la vara.
5. **Activar click-to-Sofi:** generar los enlaces y el hábito en asesores (pieza social, no
   técnica).
6. **Decisión de la extensión** con los datos del piloto (gate explícito, no default).
7. **Compliance en paralelo:** los 12 controles de §12 (aviso de privacidad, DPAs, TTL,
   seudonimización del cliente final).

En ningún punto de la secuencia la línea queda expuesta: cada paso es aditivo sobre vías
oficiales.

---

## 9. Technical architecture

```
                      FUENTES DE SEÑAL
  ┌───────────────────────┬──────────────────────┬─────────────────────┐
  │ Reenvío del asesor    │ Export .txt subido   │ Red de sitios Wasi  │
  │ (Cloud API, webhook)  │ al CRM (16MB cap)    │ (HTTP público)      │
  └──────────┬────────────┴──────────┬───────────┴──────────┬──────────┘
             ▼                       ▼                      ▼
   src/channels/whatsapp.js   /api/grupos/importar-export   sync oferta
   (verificación firma,       (parse → corte → dedup)       (ally_properties)
    cola por usuario)                │
             └───────────┬──────────┘
                         ▼
              ETAPA 0 — prefiltro léxico (src/groups/prefilter.js)
              puro, 0 tokens, ~85% descarte, corre también en browser
                         ▼
              ETAPA 1 — clasificación (src/groups/classify.js)
              Claude Haiku 4.5, lotes de 20, schema JSON forzado por API
                         ▼
              ETAPA 2 — matching (src/groups/match.js)
              determinístico: gates + scoring 55–100, top 6,
              inventario propio > aliados verificados > vistos en grupo
                         ▼
        ┌────────────────┴───────────────────┐
        ▼                                    ▼
  group_signals (Supabase,          signal_events (append-only,
  solo demanda/oferta; el           7 outcomes; Learning Domain)
  ruido muere en memoria)
        ▼
  ┌─────────────────────────────────────────────────────┐
  │ SALIDAS (todas con humano o 1:1 oficial)            │
  │ · CRM: señal + matches + borrador (copiar/pegar)    │
  │ · Digest 7am por plantilla (claim antes de enviar)  │
  │ · Sofi 1:1 con el colega que escribió (ventana 24h) │
  │ · [OBA] micro-grupos propios ≤8 vía Groups API      │
  └─────────────────────────────────────────────────────┘
```

Seguridad del perímetro: webhook con `x-hub-signature-256`, multi-tenant por
`phone_number_id → org`, RLS pendiente de endurecer antes del segundo cliente (deuda
registrada), kill switch por org (`radar_activo`) que apaga clasificación y digest.

---

## 10. AI architecture

Principio rector: **el LLM solo donde el lenguaje natural lo exige; todo lo demás,
determinístico y testeado.** El pipeline actual ya lo cumple:

### Message Parser (Etapa 0 + Etapa 1)

- **Determinístico (0 tokens):** prefiltro léxico por familias de términos + tokens de zona
  (`src/groups/lexico.js`, `src/lib/zonas.js`). Descarta ~85% antes de cualquier llamada.
  Deliberadamente permisivo: el falso negativo es el fallo más caro (un negocio perdido e
  invisible).
- **LLM (Haiku, barato):** clasificación y extracción con schema forzado por API (no por
  prompt): `clase` (demanda|oferta|ruido), `confianza`, `operacion`, `tipo`, `zona`, `ciudad`,
  `precio_min/max`, `habitaciones`, `area_min`, `banos`, `garajes`, `estrato`, `contacto`,
  `notas`. Lotes de 20, pool de 4, retry con jitter, contabilidad de costo. Equivale al JSON
  del prompt de esta investigación, ya en producción.
- El bot 1:1 tiene además un **piso determinístico** de NLU (`src/agent/intent.js`: regex de
  intención vendedor, detección de idioma) bajo el modelo.

### Matching Engine (Etapa 2 — 100% determinístico)

`src/groups/match.js`, validado contra datos reales de producción (2026-07-29: 656 de ~731
matches eliminados eran falsos positivos de zona):

- **Gates duros:** operación igual; tipo por substring; **zona por token exacto** (ciudad solo
  si no se pidió barrio, con castigo −15); precio como **banda** (piso 0.6 del presupuesto),
  no solo techo; habitaciones exactas o +1; área/baños/garajes/estrato solo si se pidieron.
- **Principio:** "lo desconocido no descalifica" — un campo vacío en nuestro inventario es
  culpa del sync, no de la propiedad.
- **Scoring:** base 55; +10 usar ≥75% del presupuesto; +10/8/6/6/5 por atributos; cap 100;
  `razones[]` legibles por match. Orden: inventario propio antes que aliados; top 6.
- **Reverso ya existente:** `matchLeadsConPropiedad` (propiedad → clientes a llamar).

### Ranking y confianza

- Probabilístico acotado: `confianza` de la clasificación (Haiku) × `puntaje` del match
  (determinístico). El umbral de acción vive en política, no en el modelo (§16 del deep dive).

### Response

- Borrador generado por plantilla determinística (`borrador()` en el CRM) — el LLM no redacta
  la respuesta comercial final; el humano la envía. Sofi 1:1 sí conversa (Sonnet, tool loop),
  con el guardrail estructural existente: los datos de propiedades de aliados jamás se
  serializan al modelo que habla con clientes.

### Brechas reales a cerrar (no rediseño)

1. Los matches se calculan una vez y quedan **congelados** en `group_signals.matches` — no hay
   re-match cuando entra inventario nuevo (`recalcular-matches-grupos.js` es manual).
2. **Demanda en dos formas:** la del cliente vive en columnas de `leads`, la del colega en
   `group_signals` — mismo concepto, dos esquemas.
3. `properties.precio` es TEXT → filtro de precio en código, no en SQL.
4. Pesos de scoring hardcodeados mientras `signal_events` ya colecciona los outcomes que
   permitirían ajustarlos con evidencia.

---

## 11. Security architecture

- **Perímetro WhatsApp:** firma `x-hub-signature-256` verificada en cada webhook; tokens en
  variables de entorno (nunca en repo); multi-tenant por `phone_number_id`.
- **Principio de frontera (P1):** el dispositivo del asesor es la frontera de confianza; el
  contenido no sale de él sin justificación (P3); lo que puede ser local, es local (P4). En
  cualquier captura futura tipo extensión: prohibido `fetch`/`chrome.*`/`document.*` en el
  núcleo, protegido por test; `signal-storage` (llaves E2E) intocable por diseño (D8).
- **Minimización estructural:** el ruido nunca se persiste (muere en memoria — invariante de
  privacidad del Radar); `procesar()` no devuelve lo descartado (D4).
- **Dedup por hash** (SHA-256 WebCrypto, semilla congelada — D2): idempotencia de imports sin
  guardar texto adicional.
- **Event store append-only** con trigger de inmutabilidad (la historia no se reescribe — P15).
- **Acceso:** aislamiento por asesor en señales (`advisor_id` en la señal, nunca en el grupo);
  kill switch admin por org. **Deuda conocida:** RLS permisivo (`using(true)`) en ~20 tablas —
  bloqueante explícito antes de vender a un segundo cliente.
- **Secretos y llaves:** jamás persistir material criptográfico de WhatsApp de nadie; los
  gateways SaaS que piden QR reciben las llaves de dispositivo de la cuenta — razón adicional
  para prohibirlos.
- **Operación:** watchdog y kill switch verificados en logs (lección del baneo: el flag
  `GROUPS_ENABLED=false` no paró WAHA; solo bajar el servicio lo hizo).

---

## 12. Colombian privacy considerations

Base: Ley 1581/2012 + Decreto 1377/2013 (compilado en D. 1074/2015), doctrina SIC, Circular
002/2024 (IA), Circulares 005/008 de 2017 (transferencias). Hechos clave:

- **Todo aplica en pleno.** Número, nombre y mensaje de un agente son datos personales; **no
  existe excepción B2B** en Colombia (solo se excluyen personas jurídicas como tales). La SIC
  ha dicho que **publicar un dato en un grupo/red no lo vuelve público**: tratarlo con fines
  propios exige el régimen completo. [OFICIAL][SIC]
- **El titular más expuesto es el cliente final mencionado en el grupo** — no autorizó a nadie.
  Precedente directo: multa de **$670M COP a Movistar** (Res. 78138, oct-2025) por contacto
  comercial vía WhatsApp sin autorización previa. Máximo legal: 2.000 SMMLV (~$3.500M COP). [SIC]
- **Transferencia internacional viable:** EE.UU. figura como país adecuado (Circulares 005 y
  008 de 2017); Supabase y Anthropic actúan como **encargados** vía DPA (art. 25 D.1377) — con
  contrato, la transmisión no exige consentimiento adicional. Verificar y archivar los DPA
  (incluido el compromiso de no-entrenamiento de Anthropic). [SIC][OFICIAL]
- **IA:** la Circular 002/2024 de la SIC exige idoneidad/necesidad/proporcionalidad y un
  **estudio de impacto de privacidad (PIA)** documentado; humano en el circuito para respuestas
  comerciales. La reforma de la 1581 radicada en ago-2025 (GDPR-like, perfilamiento) marca la
  dirección: diseñar hoy como si ya rigiera. [SIC][OFICIAL]

**Controles exigibles a la arquitectura** (los 12, con fundamento):

1. Autorización previa, expresa e informada de los asesores cuyos grupos se procesan (art. 9).
2. Aviso de privacidad en la captura + Política de Tratamiento publicada (D.1377 arts. 13–15).
3. No contactar comercialmente a ningún número sin autorización verificada de ese titular
   (caso Movistar; circular SIC de mensajería 2025). El cliente final solo vía su asesor o
   tras opt-in propio.
4. Minimización: seudonimizar nombre/teléfono del cliente final antes del LLM y de persistir;
   materializar el contacto solo con opt-in (Circular 002/2024).
5. Retención con TTL del texto crudo (30–90 días, justificado en la política) → conservar solo
   conocimiento estructurado. El principio del repo "olvidar el texto, conservar el
   conocimiento" es exactamente la práctica defendible (art. 11 D.1377).
6. Seguridad: cifrado en tránsito/reposo, roles en CRM, logs de acceso, RLS real (art. 4-g).
7. DPAs firmados y archivados con Supabase y Anthropic (art. 25 D.1377).
8. Transferencia a EE.UU. documentada bajo la lista de adecuación (art. 26; Circular Única).
9. Canal de derechos (consulta 10 días hábiles, reclamo 15) con capacidad real de suprimir a
   un titular de todas las tablas (arts. 8, 14, 15).
10. PIA del pipeline de IA antes de operar a escala (Circular 002/2024).
11. RNBD: verificar umbral de activos (100.000 UVT, Decreto 090/2018); documentar la exención
    si no aplica.
12. Responsabilidad demostrada: archivo de evidencias (consentimientos, DPAs, política, PIA,
    logs de supresión).

---

## 13. Estimated costs

Mensuales aproximados en operación (fase piloto → producción, un tenant):

| Rubro | Detalle | Costo estimado |
|---|---|---|
| Meta — conversaciones | Respuestas dentro de ventana de servicio: **gratis**. Digest 1/día/org como plantilla **utility** (USD 0.0008/msg): ~USD 0.02/mes por asesor. Hoy la plantilla está como MARKETING (USD 0.0125): 15× más — corregirla | ~USD 0–2 |
| Meta — Groups API | Mensajes no-plantilla en grupos propios: gratis; plantillas por destinatario | ~USD 0–5 |
| BSP | **Ninguno** — integración directa a Cloud API (sin markup ni fee de plataforma) | USD 0 |
| Infraestructura | Railway (bot) ~USD 5; Vercel (CRM + web) plan actual; Supabase plan actual | ~USD 5–25 |
| LLM — clasificación grupos | Haiku 4.5 en lotes; umbral de aceptación ya definido: **≤ USD 5/mes** | ≤ USD 5 |
| LLM — Sofi 1:1 | Sonnet, tool loop; escala con conversaciones (costo ya asumido por el bot hoy) | según volumen |
| Base de datos / storage | Incluido en Supabase; texto crudo con TTL reduce crecimiento | ~USD 0 marginal |
| Desarrollo | 1 dev + Claude Code (estructura actual del equipo); extensión Chrome si se aprueba: semanas de calendario extra por Web Store | interno |
| Mantenimiento | Vigilancia de changelog de Meta (mensual), plantillas, calidad | interno |
| Compliance (one-off) | Política de tratamiento, aviso, PIA, DPAs | interno/asesoría puntual |

Orden de magnitud total de infra+API+LLM para el piloto: **≤ USD 40/mes**, coherente con la
restricción de presupuesto mínimo del proyecto.

---

## 14. Implementation roadmap

**MVP (ya desplegado)** — captura por reenvío + export, motor completo, CRM, digest.
Estado real: 0 señales de producción aún; el MVP nunca ha sido alimentado en serio. [INTERNA]

**Pilot (4–6 semanas)** — 2–3 asesores, 5–10 grupos clave:
export semanal + hábito de reenvío + click-to-Sofi; tramitar OBA y verificación de empresa;
corregir plantilla del digest a utility; controles de privacidad 1–5.
**Gates de éxito** (del spec, ya definidos): ≥5 demandas/día, ≥30% con ≥1 match, precisión
≥80%, falsos negativos ≤10%, costo ≤USD 5/mes.

**Production** — si el piloto pasa: extender a todos los asesores y grupos; activar
micro-grupos propios vía Groups API (OBA); búsqueda en red Wasi como fuente de oferta
permanente; re-match automático al entrar inventario (cerrar brecha de matches congelados);
compliance completo (controles 6–12).

**Scale** — decisión de la extensión Chrome con los datos del piloto (gate explícito);
multi-tenant real (RLS endurecido — bloqueante de venta ya registrado); unificar el esquema de
demanda (leads + group_signals); pesos de matching ajustados con `signal_events`; evaluar
Coexistence para meter los 1:1 de asesores al CRM (POST-MVP, sin relación con grupos).

---

## 15. What NOT to build

Lista explícita, cada punto con su porqué:

1. **Ningún cliente no oficial del protocolo de WhatsApp** — Baileys, whatsapp-web.js,
   WPPConnect, Venom, whatsmeow, WAHA, Evolution API (modo Baileys) — ni directamente ni
   envuelto en un SaaS (Whapi, Periskope, TimelinesAI, Unipile, 2Chat, Wassenger, Green-API,
   Maytapi, UltraMsg…). Regla escrita del proyecto: *"Ninguna línea de WhatsApp de una persona
   —asesor, cliente o propia— se conecta jamás a un cliente no oficial. Si una función lo
   exige, la función no se construye."*
2. **Ningún nodo de WhatsApp no oficial en n8n/Make/Zapier** — son la misma categoría con otra
   marca (D9).
3. **Escritura automática en grupos por cualquier vía** — "Fase C — nunca": sin vía oficial, y
   aunque existiera vía gris, el costo social (spam ante 80 colegas) y de línea la prohíben.
4. **Extracción de la llave de cifrado de WhatsApp Web** para descifrar IndexedDB — descartado
   por diseño (D7/D8): leer material criptográfico convierte un lector pasivo en un compromiso
   de cuenta.
5. **Inyección en el mundo principal de WhatsApp Web / manipulación del DOM** — viola P6 y es
   lo que dispara detección.
6. **Otro agente, otro CRM, otro motor de matching, otro inventario** — ya existen; la regla
   del repo es reutilizar → integrar → extender → construir, en ese orden.
7. **Técnicas de evasión** (simular humanos, rotar números, calentar cuentas, ocultar
   automatización) — fuera del alcance por decisión: el objetivo es no necesitarlas.
8. **Contacto comercial saliente a números sin opt-in** — riesgo sancionatorio directo (caso
   Movistar) además del de calidad de línea.

---

## 16. Decision Matrix

| Solución | Lee grupos existentes | Oficial | Riesgo línea | Automatización | Escalabilidad | Recomendación |
|---|---|---|---|---|---|---|
| Cloud API 1:1 (actual) | No | ✅ | 🟢 | Alta (1:1 completo) | Alta | **Base del sistema** |
| Groups API (grupos propios ≤8) | No | ✅ | 🟢 | Alta en grupos propios | Media (8/grupo) | Usar para micro-grupos por negocio |
| Coexistence | No (excluye grupos) | ✅ | 🟢 | Media | Media | Solo para 1:1 de asesores al CRM (POST-MVP) |
| BSP (los 15 auditados) | No | ✅ | 🟢 | = Cloud API | Alta | Innecesario: integración directa ya hecha |
| Proveedor "group inbox" (Whapi, Periskope, etc.) | Sí | ❌ (QR/sesión vinculada) | 🔴 | Alta | Alta | **Prohibido** |
| WhatsApp Web automation (librerías) | Sí | ❌ | 🔴 | Alta | Alta | **Prohibido** (baneo demostrado) |
| Reenvío a Sofi (humano→Cloud API) | Parcial (curado) | ✅ | 🟢 | Media | Media | **Implementado — fuente principal** |
| Export .txt al CRM | Sí, en lote | ✅ (función nativa) | 🟢 | Media | Baja (manual/chat) | **Implementado — pilotos y lotes** |
| Click-to-Sofi (wa.me en el grupo) | No (atrae la demanda) | ✅ | 🟢 | Alta tras el click | Alta | Activar en piloto |
| Extensión Chrome solo-lectura | Sí (chat abierto) | ⚠️ zona gris ToS | 🟡 | Alta | Media | Evaluar tras piloto, con gates |
| Ruta D (Android + notificaciones) | Parcial (truncado; grupos silenciados no notifican) | ⚠️ | 🟡 | Alta | Baja | Diferida; solo con valor probado |
| Red de sitios Wasi (oferta) | n/a (reemplaza la necesidad) | ✅ (web pública) | 🟢 | Alta | Alta | **Implementar — lado oferta** |

---

## 17. Sources

### Oficiales — Meta (verificadas 11–16 ago 2026)

- Groups API: https://developers.facebook.com/documentation/business-messaging/whatsapp/groups
  · get-started · groups-messaging · webhooks · reference · pricing · faq (mismas rutas base)
- Coexistence: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/
- `smb_message_echoes`: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/smb_message_echoes/
- Changelog: https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog
- Pricing (rate card CSV con fila Colombia): https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/
- Messaging limits: https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits/
- Throughput: https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput/
- OBA: https://developers.facebook.com/documentation/business-messaging/whatsapp/official-business-accounts/
- Solution Providers: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview

### Oficiales — legales

- ToS WhatsApp: https://www.whatsapp.com/legal/terms-of-service · Meta Terms for WhatsApp
  Business: https://www.whatsapp.com/legal/meta-terms-whatsapp-business · FAQ enforcement:
  https://faq.whatsapp.com/5957850900902049
- Ley 1581/2012: https://www.alcaldiabogota.gov.co/sisjur/normas/Norma1.jsp?i=49981 · Decreto
  1377/2013: https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=53646
- SIC — Circular 008/2017 (países adecuados): https://normas.cra.gov.co/gestor/docs/circular_superindustria_0008_2017.htm
- SIC — Circular 002/2024 (IA): https://sedeelectronica.sic.gov.co/sites/default/files/normativa/Circular%20Externa%20No.%20002%20del%2021%20de%20agosto%20de%202024.pdf
- SIC — sanción Movistar: https://sedeelectronica.sic.gov.co/comunicado/la-sic-sanciona-movistar-por-tratamiento-indebido-de-datos-personales-con-fines-de-prospeccion-comercial
- SIC — "publicado ≠ público": https://www.sic.gov.co/node/34006 · RNBD: https://www.sic.gov.co/registro-nacional-de-bases-de-datos
- Reforma 1581 radicada: https://www.presidencia.gov.co/prensa/Paginas/Gobierno-radico-proyecto-de-ley-para-actualizar-normas-sobre-proteccion-250828.aspx

### Proveedores (doc técnica)

- 360dialog groups: https://docs.360dialog.com/docs/messaging/groups · Zoko:
  https://docs.zoko.io/messaging-api/groups-api/ · Kapso: https://docs.kapso.ai/api/meta/whatsapp/messages/send-a-message
- SleekFlow Coexistence: https://help.sleekflow.io/whatsapp/whatsapp-coexistence · respond.io
  roadmap: https://roadmap.respond.io/feature-request/p/whatsapp-support-group-chats · WATI FAQ:
  https://support.wati.io/en/articles/11462970-general-faqs-wati · Trengo:
  https://help.trengo.com/article/conditions-for-the-whatsapp-business-api
- Twilio "group messaging" (relay): https://github.com/TwilioDevEd/whatsapp-group-messaging
- No oficiales (identificación de método, no recomendación): https://whapi.cloud/docs ·
  https://docs.periskope.app/get-started/connect-whatsapp · https://timelines.ai/whatsapp-group-api/
  · https://www.unipile.com/whatsapp-group-api/ · https://developers.2chat.co/docs/category/groups

### Comunidad / secundarias

- Baileys: https://github.com/WhiskeySockets/Baileys (issues 1869, 2309, 2658) · whatsmeow:
  https://github.com/tulir/whatsmeow (issues 807, 810) · WAHA: https://github.com/devlikeapro/waha
  (issues 1362, 2068) · Evolution: https://github.com/EvolutionAPI/evolution-api
- Fingerprinting como mecanismo de detección: https://blog.kraya-ai.com/whatsapp-automation-ban-risk
  · https://sporesec.com/en/blog/whatsapp-unofficial-api-ban-risk
- Acción legal de WhatsApp (2019): https://www.securityweek.com/whatsapp-will-take-legal-action-against-automated-or-bulk-messaging/
  · Meta v. Rockey Tech: https://www.bleepingcomputer.com/news/security/meta-sues-app-dev-for-stealing-over-1-million-whatsapp-accounts/

### Internas (este repo)

- [epe/DECISIONES.md](../epe/DECISIONES.md) (D1–D9) · [auditoria-ecosistema-2026-08-01.md](auditoria-ecosistema-2026-08-01.md)
  (§4: forense y matriz de rutas) · [auditoria-radar-mvp-2026-08-02.md](auditoria-radar-mvp-2026-08-02.md)
- [Spec extensión Chrome](../docs/superpowers/specs/2026-08-01-extension-chrome-radar-design.md) ·
  [Spec Sofi grupos](../docs/superpowers/specs/2026-07-28-sofi-grupos-whatsapp-design.md)
- Código: `src/groups/*` · `src/channels/whatsapp.js` · `src/agent/*` ·
  `db/migrations/2026-08-01_radar_grupos.sql` · `db/migrations/2026-08-02_learning_domain.sql`

---

## 20 (pregunta final). ¿Qué implementaría yo hoy si esta fuera mi inmobiliaria?

Sin diplomacia: **implementaría la Arquitectura 2 tal como está definida en §7, empezando el
piloto el lunes.** La línea Cloud API dedicada como único punto de contacto automatizado;
reenvío + export + click-to-Sofi como boca de los grupos; la red de sitios Wasi como fuente de
oferta (es mejor dato que los grupos y nadie la puede apagar); el motor determinístico
existente haciendo el matching; y un humano apretando "enviar" en todo lo que salga hacia un
grupo. Tramitaría el OBA ya — es barato, desbloquea los micro-grupos oficiales y suma
legitimidad ante Meta.

No construiría la extensión hoy: no porque sea mala idea, sino porque todavía no tengo el dato
que justifica sus semanas de calendario y su zona gris — y este proyecto ya pagó una vez el
precio de saltarse el canario. Si el piloto demuestra que la demanda en tiempo real es negocio,
la construyo con sus invariantes protegidos por test, primero en mi propia cuenta.

Y no volvería a conectar la línea de nadie a un cliente no oficial ni aunque el proveedor jure
que es seguro: ya vimos, con logs, que la sanción es por el cliente, no por la conducta. El
número de WhatsApp es el activo; todo lo demás se puede reconstruir.
