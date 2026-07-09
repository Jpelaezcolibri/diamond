# Arquitectura — Agente Inmobiliario WhatsApp (bot-inmobiliario)

## Contexto

- **Qué hace la app:** Agente conversacional con IA que atiende por WhatsApp a personas que hicieron click en una publicación de una propiedad (click-to-WhatsApp ad). Asesora, envía la ficha de la propiedad de interés, ofrece alternativas desde la base de datos, califica si el interés es genuino y, cuando el lead está calificado, lo transfiere al asesor humano con un resumen.
- **Usuarios objetivo:** Compradores/arrendatarios finales (por WhatsApp) + inmobiliarias clientes (dueñas del inventario y los asesores).
- **Alcance:** Producto **multi-tenant** — varias inmobiliarias, cada una con su número de WhatsApp, su inventario y sus asesores.
- **Escala esperada (12 meses):** Demo comercial en 2–3 semanas; luego decenas→cientos de conversaciones/día por tenant. Volumen bajo-medio; el cuello de botella es la API de WhatsApp y Claude, no el cómputo propio.
- **Equipo:** 1 desarrollador (Juan), stack dominado: Node.js, Supabase, Claude SDK, Next.js.
- **Restricciones clave:** Sin admin en la máquina de desarrollo; presupuesto de infra mínimo (~5 USD/mes); WhatsApp Cloud API exige webhook público con respuesta rápida.

## Reglas del dominio (NO romper)

1. **Sofi**: mujer, paisa suave SIN muletillas forzadas (el usuario pidió explícitamente no forzar "pues"). La calidez va en el trato.
2. **Fichas de propiedad**: formato completo estilo Wasi (precio, área, hab, baños, garaje, estrato, admon, ubicación, link) + cierre "¿Te gustaría hablar con un asesor...? Responde SI".
3. **Venta vs Arriendo**: nunca mezclarlas. Campo `operacion` en properties.
4. **Cierre no invasivo**: en venta preguntar forma de pago (crédito → ofrecer asesoría); si el cliente duda, NO insistir.
5. **Transferencias por especialidad**: venta / arriendo / vehiculos / otro → tabla `advisors`. La alerta y el link wa.me van al asesor de la especialidad.
6. **Nunca inventar** propiedades, precios ni disponibilidad. Solo lo que devuelve `buscar_propiedades`. Nunca prometer descuentos.
7. **Multi-tenant**: la org se resuelve por `phone_number_id` entrante; token y asesores por organización.
8. Estados del lead: `nuevo → en_conversacion → calificado → transferido` (o `descartado`). Score con piso 70 para calificados.

**Convenciones del bot:** sin TypeScript (JS plano con CommonJS); después de cambiar `prompts.js`/`tools.js`/`engine.js`, correr `npm test` y probar al menos un flujo completo por `/test` antes de commitear.

## Decisión

**Arquitectura elegida:** Monolito modular (3-tier: canal → lógica de agente → datos), con estado 100% en base de datos.

**Stack:**
- **Runtime:** Node.js 20 + Express 5 (proceso siempre activo)
- **BD:** Supabase (Postgres) vía `@supabase/supabase-js` — propiedades, leads, conversaciones, mensajes, organizaciones
- **IA:** Anthropic Claude SDK, modelo `claude-sonnet-4-5`, con **tool use** para búsqueda de propiedades, captura de datos del lead y transferencia a asesor
- **Canal principal:** WhatsApp Cloud API (Meta); Telegram se mantiene como canal de pruebas/demo
- **Hosting:** Railway o Render (web service persistente)
- **Admin de inventario (fase demo):** Supabase Studio (tabla editor) — sin dashboard propio todavía

## Justificación

- **Monolito modular gana a monolito simple** porque el demo actual ya sufrió el problema: `index.js` y `core.js` duplicaron la lógica del agente y divergieron. Separar canal / agente / datos en módulos con interfaces claras elimina esa duplicación y permite agregar canales (Instagram DM, web chat) sin tocar el agente.
- **Gana a serverless (Vercel)** porque un bot de WhatsApp es un webhook de latencia sensible con estado conversacional: un proceso persistente evita cold starts, permite responder `200` de inmediato y procesar el mensaje async sin colas externas, y cuesta ~5 USD/mes.
- **Gana a microservicios** obviamente: 1 dev, 1 dominio. Complejidad operativa injustificable.
- **Supabase Postgres como única fuente de verdad** encaja con el stack ya dominado, resuelve la persistencia del estado (hoy en memoria: se pierde en cada redeploy), y habilita el futuro dashboard Next.js sin migración.
- **Multi-tenant desde el modelo de datos** (`organization_id` en toda tabla): meterlo después es 10x más caro. El webhook de Meta ya trae `phone_number_id`, que es la llave natural para resolver el tenant.
- **Tool use en vez de regex para calificar:** el demo actual detecta intención con regex (`/asesor|humano|persona/`), frágil. Con tools, Claude decide cuándo buscar propiedades, qué dato del lead registrar y cuándo transferir — y el código valida y persiste.

## Alternativas consideradas y descartadas

- **Serverless en Vercel** — descartada: cold starts en webhooks, y todo el flujo (webhook → Claude → WhatsApp send) puede superar los límites cómodos de una función; el costo de un worker persistente es trivial.
- **Google Sheets como BD** — descartada como fuente de verdad: sin relaciones, sin validación, límites de cuota, imposible multi-tenant limpio. Queda en el roadmap como *conector de sincronización* opcional para clientes que ya viven en Sheets.
- **n8n / plataforma no-code para el flujo** — descartada: la lógica de calificación con tool use y el formato fino de mensajes se controlan mejor en código; ya existe base en Node.
- **Microservicios / event-driven** — descartada: escala y equipo no lo justifican ni de lejos.

## Estructura de carpetas

```
bot-inmobiliario/
├── ARCHITECTURE.md
├── README.md
├── .env.example
├── .gitignore
├── package.json
├── db/
│   └── schema.sql              # schema Supabase (tablas + índices + seed demo)
├── src/
│   ├── server.js               # entrypoint: Express, monta canales
│   ├── config.js               # lectura y validación de env vars
│   ├── channels/
│   │   ├── whatsapp.js         # webhook Meta (verify + receive) y envío de mensajes
│   │   └── telegram.js         # canal de pruebas (deep link /start REF)
│   ├── agent/
│   │   ├── engine.js           # orquesta: carga contexto → Claude → ejecuta tools → responde
│   │   ├── prompts.js          # system prompts (personalidad, formato ficha, reglas)
│   │   ├── tools.js            # definición y handlers: buscar_propiedades,
│   │   │                       #   registrar_dato_lead, transferir_a_asesor
│   │   └── qualification.js    # criterios de "interés genuino" (score del lead)
│   ├── data/
│   │   ├── supabase.js         # cliente único
│   │   ├── organizations.js    # resolver tenant por phone_number_id
│   │   ├── properties.js       # búsqueda/filtrado de propiedades
│   │   ├── leads.js            # CRUD lead + score + estado
│   │   └── conversations.js    # historial de mensajes persistente
│   └── notifications/
│       └── advisor.js          # alerta al asesor: resumen del lead + link wa.me
└── test/
    └── agent.test.js           # tests del engine con canal simulado
```

## Modelo de datos (Supabase)

| Tabla | Campos clave |
|---|---|
| `organizations` | id, name, whatsapp_phone_id (único), whatsapp_token, verify_token, advisor_phone, advisor_name, status |
| `properties` | id, org_id, ref (único por org), titulo, tipo, precio, zona, ciudad, area, habitaciones, banos, garaje, estrato, administracion, descripcion, caracteristicas, link, disponible |
| `leads` | id, org_id, phone (único por org), nombre, presupuesto, zona_interes, tipo_interes, urgencia, score, estado (`nuevo → en_conversacion → calificado → transferido / descartado`), property_ref_origen, source |
| `conversations` | id, org_id, lead_id, estado, last_activity_at |
| `messages` | id, conversation_id, role (`user/assistant`), content, created_at |

**Flujo del lead:** click en ad → wa.me con texto prellenado que incluye la ref (`"Hola, me interesa la propiedad AP001"`) → webhook resuelve org por `phone_number_id` → crea/carga lead y conversación → engine responde con ficha → conversa, captura presupuesto/zona/urgencia vía tools → cuando `qualification.js` marca calificado (o el cliente lo pide) → estado `transferido` + notificación al asesor con resumen y datos capturados.

## Trade-offs aceptados

- **Sin cola de mensajes (Redis/SQS):** el webhook responde 200 y procesa en el mismo proceso. Si el proceso muere a mitad de un mensaje, se pierde esa respuesta (WhatsApp reintenta el webhook). Aceptable a esta escala; revisar si se superan ~miles de mensajes/día.
- **Tokens de WhatsApp por tenant guardados en la BD** (cifrado a nivel de Supabase): suficiente para demo/primeros clientes; un vault dedicado queda diferido.
- **Sin dashboard propio en la fase demo:** el inventario se administra en Supabase Studio. Se sacrifica pulido comercial por velocidad de salida.
- **Historial acotado (últimos N mensajes) al llamar a Claude:** se sacrifica memoria larga por costo y latencia; los datos duros del lead viven en la tabla, no en el prompt.

## Camino de evolución

- **Mes 1–2:** dashboard Next.js (mismo Supabase) para que la inmobiliaria gestione propiedades, vea leads y conversaciones — reutiliza patrones de WorkPilot/AdminIA.
- **Mes 3+:** si un cliente exige Sheets, conector de sincronización Sheets → Supabase (job programado). Fotos de propiedades vía WhatsApp media API. Métricas de conversión por publicación (`source` del lead).
- **Si el volumen crece (>5k msgs/día):** introducir cola (BullMQ + Redis en Railway) entre webhook y engine, sin cambiar módulos.
- **Si se agregan canales:** Instagram DM / web chat como nuevos archivos en `channels/`, mismo engine.

## Decisiones diferidas

- Cifrado dedicado de tokens por tenant (vault) — cuando haya >3 tenants reales.
- Búsqueda semántica de propiedades (embeddings/pgvector) — el filtrado estructurado basta para inventarios <500 propiedades.
- Onboarding self-service de inmobiliarias — el alta de tenants es manual (SQL/Studio) durante la fase demo.
- Envío de fotos/carruseles por WhatsApp — requiere media handling; la ficha con link cubre el demo.
